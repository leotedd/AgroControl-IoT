#include <Arduino.h>
#include <Preferences.h>

// Physical USB provisioning only. No GPIO26, no Wi-Fi AP, no secret echo.
String line,certificate;
bool receivingCa=false,overflow=false;
void status() {
  Preferences p;
  bool url=false,token=false,ca=false;
  if (p.begin("agro-api",true)) {
    url=p.getString("url","").length()>0; token=p.getString("token","").length()>0;
    ca=p.getString("ca","").length()>0; p.end();
  }
  Serial.printf("API_KEYS_PRESENT url=%d token=%d ca=%d; values hidden; TLS not tested\n",url,token,ca);
}
void store(const char* space,const char* key,const String& value) {
  Preferences p;
  if (!p.begin(space,false)) { Serial.println("NVS_OPEN_FAILED"); return; }
  bool ok=p.putString(key,value)==value.length() && p.getString(key,"")==value;
  p.end(); Serial.println(ok?"STORED":"NVS_VERIFY_FAILED");
}
void command() {
  if (receivingCa) {
    if (line=="END_CA") {
      if (certificate.startsWith("-----BEGIN CERTIFICATE-----") && certificate.indexOf("-----END CERTIFICATE-----")>=0)
        store("agro-api","ca",certificate);
      else Serial.println("INVALID_CA");
      receivingCa=false; certificate=String();
    } else {
      if (certificate.length()+line.length()+1>8192) { receivingCa=false; certificate=String(); Serial.println("CA_TOO_LONG"); }
      else certificate+=line+"\n";
    }
    return;
  }
  if (line=="BEGIN_CA") { receivingCa=true; certificate=String(); Serial.println("SEND_PEM_THEN_END_CA"); return; }
  if (line=="REBOOT") { Serial.println("REBOOTING"); delay(100); ESP.restart(); return; }
  if (line=="STATUS") { status(); return; }
  struct Field { const char* prefix; const char* space; const char* key; size_t max; };
  const Field fields[]={
    {"SSID ","agro-wifi","ssid",32},{"PASSWORD ","agro-wifi","password",63},
    {"URL ","agro-api","url",240},{"TOKEN ","agro-api","token",51}
  };
  for (const Field& f:fields) if (line.startsWith(f.prefix)) {
    String value=line.substring(strlen(f.prefix));
    if (String(f.key)=="token") for (size_t i=8;i<value.length();++i) {
      const char c=value[i];
      if (!((c>='A'&&c<='Z') || (c>='a'&&c<='z') || (c>='0'&&c<='9') || c=='_' || c=='-')) {
        Serial.println("INVALID_VALUE"); return;
      }
    }
    if (!value.length() || value.length()>f.max ||
        (String(f.key)=="url" && !value.startsWith("https://")) ||
        (String(f.key)=="token" && (value.length()!=51 || !value.startsWith("agc_dev_")))) {
      Serial.println("INVALID_VALUE"); return;
    }
    store(f.space,f.key,value); return;
  }
  Serial.println("Commands: SSID value | PASSWORD value | URL https://host/api/v1 | TOKEN value | BEGIN_CA | STATUS | REBOOT");
}
void setup() { Serial.begin(115200); Serial.println("USB_PROVISIONING_NO_ECHO; pump circuit must be disconnected"); }
void loop() {
  while (Serial.available()) {
    char c=Serial.read();
    if (c=='\r') continue;
    if (c=='\n') {
      if (!overflow) command();
      else Serial.println("LINE_TOO_LONG");
      line=String(); overflow=false;
    } else if (line.length()<256 && !overflow) line+=c;
    else { overflow=true; line=String(); }
  }
  delay(1);
}
