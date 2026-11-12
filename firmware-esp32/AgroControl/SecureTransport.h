#pragma once
#include <WiFi.h>
#include <NetworkClientSecure.h>
#include <esp_sntp.h>
#include <mbedtls/build_info.h>
#include <atomic>
#include "MonitorState.h"

namespace monitor {
class Transport {
 public:
  String host, prefix, ca, token;
  uint16_t port=443;
  bool trusted=false, provisioned=false;
  std::atomic<bool> apiHealthy{false};
  std::atomic<uint64_t> lastApiResponse{0};
  uint32_t tlsErrors=0;
  uint32_t httpErrors=0;
  uint64_t nextAttempt=0, sentAt=0, serverTime=0;
  String status="SIN_WIFI";
  const char* provisioningStatus="NVS_API_AUSENTE";
  void begin() {
    Preferences p;
    if (!p.begin("agro-api",true)) return;
    String url=p.getString("url",""); token=p.getString("token",""); ca=p.getString("ca","");
    p.end();
    provisioningStatus="URL_INVALIDA";
    if (!url.startsWith("https://") || url.length()>240) return;
    provisioningStatus="CA_AUSENTE_O_FORMATO_INVALIDO";
    if (ca.length()>8192 || !ca.startsWith("-----BEGIN CERTIFICATE-----") || ca.indexOf("-----END CERTIFICATE-----")<0) return;
    provisioningStatus="TOKEN_FORMATO_INVALIDO";
    if (token.length()!=51 || !token.startsWith("agc_dev_")) return;
    for (size_t i=8;i<token.length();++i) {
      char c=token[i];
      if (!(isalnum((unsigned char)c)||c=='_'||c=='-')) return;
    }
    provisioningStatus="URL_INVALIDA";
    int slash=url.indexOf('/',8); if (slash<0) return;
    String authority=url.substring(8,slash); prefix=url.substring(slash);
    if (prefix!="/api/v1") return;
    int colon=authority.indexOf(':');
    host=colon<0?authority:authority.substring(0,colon);
    if (!host.length()) return;
    for (char c:host) if (!(isalnum((unsigned char)c)||c=='.'||c=='-')) return;
    if (colon>=0) {
      String ptext=authority.substring(colon+1);
      if (!ptext.length()||ptext.length()>5) return;
      for (char c:ptext) if (!isdigit((unsigned char)c)) return;
      unsigned long value=ptext.toInt(); if (!value||value>65535) return; port=value;
    }
    client_.setCACert(ca.c_str()); client_.setTimeout(8000); client_.setHandshakeTimeout(5);
    provisioned=true; provisioningStatus="OK";
  }
  const char* tlsMode() const {
#ifdef MBEDTLS_HAVE_TIME_DATE
    return "MBEDTLS";
#else
    return "VERIFICADOR";
#endif
  }
  void invalidate() { trusted=false; apiHealthy=false; client_.stop(); }
  // Called even when API provisioning is absent: status must reflect the live link.
  void refreshLink() {
    const auto link=agro::linkState(WiFi.status()==WL_CONNECTED,clockReady(),provisioned,trusted);
    if (link==agro::LinkState::NoWifi || link==agro::LinkState::NoTime) {
      invalidate(); status=link==agro::LinkState::NoWifi?"SIN_WIFI":"SIN_HORA";
    } else if (link==agro::LinkState::NoApiConfig) status="SIN_API";
    else if (link==agro::LinkState::AwaitingApi &&
             (status=="SIN_WIFI" || status=="SIN_HORA")) status="SIN_API";
  }
  bool clockReady() const {
    portENTER_CRITICAL(&clockMux_); const uint32_t generation=syncGeneration_; const uint64_t last=lastSync_; portEXIT_CRITICAL(&clockMux_);
    return generation && monoMs()-last<3600000 && utcMs()>=1767225600000ULL;
  }
  void synced() {
    portENTER_CRITICAL(&clockMux_); ++syncGeneration_; lastSync_=monoMs(); portEXIT_CRITICAL(&clockMux_);
    apiHealthy=false;
  }
  bool connectVerified() {
    if (WiFi.status()!=WL_CONNECTED) { status="SIN_WIFI"; invalidate(); return false; }
    if (!clockReady()) { status="SIN_HORA"; invalidate(); return false; }
    if (agro::usableSession(client_.connected(),clockReady(),trusted,verifiedGeneration_,syncGeneration_.load())) return true;
    invalidate();
    const uint32_t generation=syncGeneration_.load();
    if (!client_.connect(host.c_str(),port,5000) || !certificateDates()) {
      ++tlsErrors; status="TLS_ERROR"; invalidate(); return false;
    }
    String body; const int code=exchange("GET","/salud",String(),false,body);
    if (code!=200) { ++httpErrors; status="SIN_API"; invalidate(); return false; }
    if (!checkTime(body) || !clockReady() || generation!=syncGeneration_.load()) {
      status="SIN_HORA"; invalidate(); sntp_restart(); return false;
    }
    verifiedGeneration_=generation; status="CONECTADO";
    return true;
  }
  int request(const char* method,const String& path,const String& body,String& response) {
    if (!provisioned || monoMs()<nextAttempt) return -1;
    if (!connectVerified()) { nextAttempt=monoMs()+backoff_.failure(esp_random()); return -1; }
    // Recheck after TLS/health: a concurrent SNTP update invalidates prior verification.
    if (!agro::usableSession(client_.connected(),clockReady(),trusted,verifiedGeneration_,syncGeneration_.load())) {
      invalidate(); status="SIN_HORA"; nextAttempt=monoMs()+2000; return -1;
    }
    const int code=exchange(method,path,body,true,response);
    if (Serial.availableForWrite()>=140)
      Serial.printf("api %s %s HTTP=%d\n",method,path.c_str(),code);
    if (code<0 || code>=300) ++httpErrors;
    if (code>=200 && code<300) {
      if (!checkTime(response) || !clockReady() || verifiedGeneration_!=syncGeneration_.load()) {
        invalidate(); status="SIN_HORA"; sntp_restart(); return -1;
      }
    }
    if (code==401 || code==403) { nextAttempt=monoMs()+60000; invalidate(); status="SIN_API"; }
    else if (code<0 || code>=500 || code==429 || (code>=300 && code!=304)) {
      nextAttempt=monoMs()+backoff_.failure(esp_random());
      if (retryAfter_>0) nextAttempt=nextAttempt>retryAfter_?nextAttempt:retryAfter_;
      invalidate(); status="SIN_API";
    } else { backoff_.success(); status="CONECTADO"; apiHealthy=true; lastApiResponse=monoMs(); }
    return code;
  }
 private:
  NetworkClientSecure client_;
  agro::Backoff backoff_;
  mutable portMUX_TYPE clockMux_=portMUX_INITIALIZER_UNLOCKED;
  std::atomic<uint32_t> syncGeneration_{0};
  uint32_t verifiedGeneration_=0;
  volatile uint64_t lastSync_=0;
  uint64_t end_=0,retryAfter_=0;
  bool certificateDates() {
    // Mandatory even on cores without CONFIG_MBEDTLS_HAVE_TIME_DATE.
    const mbedtls_x509_crt* cert=client_.getPeerCertificate();
    if (!cert) return false;
    time_t now=utcMs()/1000; struct tm t; gmtime_r(&now,&t);
    int current[]={t.tm_year+1900,t.tm_mon+1,t.tm_mday,t.tm_hour,t.tm_min,t.tm_sec};
    auto compare=[&](const mbedtls_x509_time& x) {
      const int other[]={x.year,x.mon,x.day,x.hour,x.min,x.sec};
      for (int i=0;i<6;++i) { if (current[i]<other[i]) return -1; if (current[i]>other[i]) return 1; }
      return 0;
    };
    for (;cert;cert=cert->next)
      if (compare(cert->valid_from)<0 || compare(cert->valid_to)>0) return false;
    return true;
  }
  bool checkTime(const String& body) {
    cJSON* root=parse(body); if (!root) return false;
    cJSON* data=cJSON_GetObjectItemCaseSensitive(root,"data");
    uint64_t server=0;
    bool ok=agro::parseUtc(string(data,"hora_servidor"),server);
    const uint64_t local=utcMs();
    ok=ok && (local>server?local-server:server-local)<=30000;
    cJSON_Delete(root); trusted=ok; if (ok) serverTime=server;
    return ok;
  }
  int byte() {
    while (monoMs()<end_) {
      if (client_.available()) return client_.read();
      if (!client_.connected()) return -1;
      vTaskDelay(pdMS_TO_TICKS(1));
    }
    return -1;
  }
  bool line(String& result,size_t maximum=512) {
    result=String();
    while (result.length()<=maximum) {
      int c=byte(); if (c<0) return false;
      if (c=='\r') return byte()=='\n';
      if (c=='\n' || c==0) return false;
      result+=char(c);
    }
    return false;
  }
  bool writeAll(const String& text) {
    size_t offset=0;
    while (offset<text.length() && monoMs()<end_) {
      size_t n=client_.write(reinterpret_cast<const uint8_t*>(text.c_str())+offset,text.length()-offset);
      if (!n) return false; offset+=n;
    }
    return offset==text.length();
  }
  int exchange(const char* method,const String& path,const String& payload,bool auth,String& body) {
    body=String(); sentAt=monoMs(); end_=sentAt+8000; retryAfter_=0;
    String headers=String(method)+" "+prefix+path+" HTTP/1.1\r\nHost: "+host+":"+String(port)+
      "\r\nConnection: keep-alive\r\nAccept: application/json\r\nAccept-Encoding: identity\r\n";
    if (auth) headers+="Authorization: Bearer "+token+"\r\nX-Id-Arranque: "+boot_+"\r\n";
    if (payload.length()) headers+="Content-Type: application/json\r\n";
    headers+="Content-Length: "+String(payload.length())+"\r\n\r\n";
    if (!writeAll(headers) || !writeAll(payload)) return -1;
    String current;
    if (!line(current) || !current.startsWith("HTTP/1.1 ") || current.length()<12) return -1;
    for (int i=9;i<12;++i) if (!isdigit((unsigned char)current[i])) return -1;
    int code=current.substring(9,12).toInt();
    int length=-1; bool chunked=false,close=false,json=false; size_t headerSize=0;
    while (true) {
      if (!line(current)) return -1;
      headerSize+=current.length()+2; if (headerSize>8192) return -1;
      if (!current.length()) break;
      int colon=current.indexOf(':'); if (colon<1) return -1;
      String key=current.substring(0,colon); key.toLowerCase();
      String value=current.substring(colon+1); value.trim();
      if (key=="content-length") {
        if (length>=0 || value.length()>6 || !value.length()) return -1;
        for (char c:value) if (!isdigit((unsigned char)c)) return -1;
        length=value.toInt(); if (length>16384) return -1;
      } else if (key=="transfer-encoding") { if (value!="chunked") return -1; chunked=true; }
      else if (key=="content-encoding" && value!="identity") return -1;
      else if (key=="content-type") json=value.startsWith("application/json");
      else if (key=="connection") { value.toLowerCase(); close=value=="close"; }
      else if (key=="retry-after") {
        bool numeric=value.length()>0 && value.length()<8;
        for (char c:value) if (!isdigit((unsigned char)c)) numeric=false;
        if (numeric) retryAfter_=monoMs()+uint64_t(value.toInt())*1000;
        else {
          // HTTP-date form, GMT only. Ignore malformed dates; still back off.
          struct tm t={}; char* end=strptime(value.c_str(),"%a, %d %b %Y %H:%M:%S GMT",&t);
          if (end && !*end) {
            char iso[25]; strftime(iso,sizeof(iso),"%Y-%m-%dT%H:%M:%SZ",&t);
            uint64_t target=0;
            if (agro::parseUtc(iso,target) && target>utcMs()) retryAfter_=monoMs()+target-utcMs();
          }
        }
      }
    }
    if (chunked && length>=0) return -1;
    if (code==304 || code==204) { if (close) client_.stop(); return code; }
    if (!json || (!chunked && length<0)) return -1;
    body.reserve(length>0?length:1024);
    if (chunked) {
      while (true) {
        if (!line(current,16) || !current.length()) return -1;
        uint32_t count=0;
        for (char c:current) {
          if (!isxdigit((unsigned char)c) || count>16384/16) return -1;
          count=count*16+(isdigit((unsigned char)c)?c-'0':tolower(c)-'a'+10);
        }
        if (body.length()+count>16384) return -1;
        if (!count) {
          size_t trailers=0;
          do { if (!line(current)) return -1; trailers+=current.length()+2; if (trailers>4096) return -1; } while (current.length());
          break;
        }
        while (count--) { int c=byte(); if (c<0 || !c) return -1; body+=char(c); }
        if (byte()!='\r' || byte()!='\n') return -1;
      }
    } else for (int i=0;i<length;++i) { int c=byte(); if (c<0 || !c) return -1; body+=char(c); }
    if (close) client_.stop();
    return code;
  }
  String boot_;
 public:
  void setBoot(const char* boot) { boot_=boot; }
};
} // namespace monitor
