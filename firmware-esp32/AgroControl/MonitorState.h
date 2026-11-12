#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <cJSON.h>
#include <mbedtls/sha256.h>
#include <esp_timer.h>
#include <sys/time.h>
#include <memory>
#include "Control.h"
#include "Protocol.h"
#include "Settings.h"

namespace monitor {
inline uint64_t monoMs() { return uint64_t(esp_timer_get_time())/1000; }
inline uint64_t utcMs() { struct timeval t; gettimeofday(&t,nullptr); return uint64_t(t.tv_sec)*1000+t.tv_usec/1000; }
enum class Cause : uint8_t { None, Sensor, Stale, Persistence, InvalidConfig, Uncertain, Control };
inline const char* causeName(Cause c) {
  switch(c) {
    case Cause::Sensor:return "FALLA_SENSOR"; case Cause::Stale:return "SENSOR_CADUCADO";
    case Cause::Persistence:return "PERSISTENCIA_NO_DISPONIBLE";
    case Cause::InvalidConfig:return "CONFIG_INVALIDA"; default:return "";
    case Cause::Uncertain:return "RESULTADO_INCIERTO_REINICIO";
    case Cause::Control:return "FALLA_CRITICA";
  }
}
struct Config {
  uint32_t version=0, telemetrySeconds=10, commandSeconds=3;
  int dry=settings::dryAdc, wet=settings::wetAdc;
  float start=30, stop=55;
  uint32_t maximumSeconds=5, cooldownSeconds=60;
  bool calibrated=true;
  uint8_t desiredMode=0;
};
struct Block {
  uint64_t id=0, sinceMono=0, sinceUtc=0;
  char boot[9]={};
  Cause cause=Cause::None;
};
enum class Code : uint8_t {
  None, NoChange, Hardware, Mode, Clock, Expired, Duplicate, Reused,
  Persistence, UnknownActuator, UnknownType, Invalid, NotMatching,
  NotReleasable, Cancelled, BatchOff, Blocked, SensorInvalid, Wet, Cooldown, Busy, Clipped, Uncertain, HardwareError
};
inline const char* codeName(Code c) {
  switch(c) {
    case Code::NoChange:return "SIN_CAMBIO"; case Code::Hardware:return "HARDWARE_NO_CONFIRMADO";
    case Code::Mode:return "MODO_INCORRECTO"; case Code::Clock:return "RELOJ_NO_CONFIABLE";
    case Code::Expired:return "ORDEN_CADUCADA"; case Code::Duplicate:return "ORDEN_DUPLICADA";
    case Code::Reused:return "ID_REUTILIZADO"; case Code::Persistence:return "PERSISTENCIA_NO_DISPONIBLE";
    case Code::UnknownActuator:return "ACTUADOR_DESCONOCIDO"; case Code::UnknownType:return "TIPO_DESCONOCIDO";
    case Code::Invalid:return "PARAMETROS_INVALIDOS"; case Code::NotMatching:return "BLOQUEO_NO_COINCIDE";
    case Code::NotReleasable:return "BLOQUEO_NO_LIBERABLE"; case Code::Cancelled:return "ANULADA_POR_APAGAR";
    case Code::BatchOff:return "ORDEN_EN_LOTE_CON_APAGAR";
    case Code::Blocked:return "BLOQUEO_SEGURIDAD"; case Code::SensorInvalid:return "SENSOR_INVALIDO";
    case Code::Wet:return "HUMEDAD_SUFICIENTE"; case Code::Cooldown:return "DESCANSO_ACTIVO";
    case Code::Busy:return "ACTUADOR_OCUPADO"; case Code::Clipped:return "DURACION_RECORTADA";
    case Code::Uncertain:return "RESULTADO_INCIERTO_REINICIO"; case Code::HardwareError:return "ERROR_HARDWARE";
    default:return nullptr;
  }
}
// Exact v2 layout retained for migration; do not reorder these fields.
struct LegacyAck {
  uint64_t id=0, uptime=0, utc=0;
  char origin[9]={};
  uint32_t configVersion=0, restSeconds=0;
  Block block;
  Code code=Code::Invalid;
  bool applied=false;
  uint8_t mode=0;
};
struct Ack : LegacyAck {
  uint32_t durationApplied=0,runElapsed=0,runRemaining=0;
  uint64_t activeId=0;
  bool pumpOn=false,failed=false;
};
enum class Phase : uint8_t { Final, Intention };
struct LegacyRecord {
  uint64_t id=0; uint8_t digest[32]={}; LegacyAck ack; bool confirmed=false,quarantined=false;
};
struct LegacyPersistent {
  uint32_t magic=0x41474332,schema=2;
  Config config; Block block;
  uint64_t blockCounter=0,watermark=0,offBarrier=0;
  LegacyRecord journal[16],offAcks[8];
  uint32_t offDropped=0,crc=0;
};
struct Record {
  uint64_t id=0;
  uint8_t digest[32]={};
  Ack ack;
  bool confirmed=false;
  bool quarantined=false;
  Phase phase=Phase::Final;
};
struct Persistent {
  uint32_t magic=0x41474332, schema=3;
  Config config;
  Block block;
  uint64_t blockCounter=0, watermark=0, offBarrier=0;
  Record journal[16], offAcks[8];
  uint32_t offDropped=0;
  uint64_t runningId=0;
  uint32_t crc=0;
};
static_assert(sizeof(Persistent)<12000,"NVS manual trial state too large");
inline constexpr Persistent migrateLegacy(const LegacyPersistent& old) {
  Persistent result;
  result.config=old.config; result.block=old.block; result.blockCounter=old.blockCounter;
  result.watermark=old.watermark; result.offBarrier=old.offBarrier; result.offDropped=old.offDropped;
  for (unsigned i=0;i<24;++i) {
    auto& to=i<16?result.journal[i]:result.offAcks[i-16];
    const auto& from=i<16?old.journal[i]:old.offAcks[i-16];
    to.id=from.id;
    for (unsigned n=0;n<32;++n) to.digest[n]=from.digest[n];
    static_cast<LegacyAck&>(to.ack)=from.ack;
    to.confirmed=from.confirmed; to.quarantined=from.quarantined; to.phase=Phase::Final;
  }
  return result;
}
inline constexpr bool requiresRecovery(const Persistent& data) {
  if (data.runningId) return true;
  for (const auto& record:data.journal) if (record.id && record.phase==Phase::Intention) return true;
  return false;
}
inline bool number(cJSON* o,const char* key,uint64_t& out,bool positive=false) {
  cJSON* item=cJSON_GetObjectItemCaseSensitive(o,key);
  return cJSON_IsNumber(item) && agro::safeInteger(item->valuedouble,out,positive);
}
inline const char* string(cJSON* o,const char* key) {
  cJSON* item=cJSON_GetObjectItemCaseSensitive(o,key);
  return cJSON_IsString(item)?item->valuestring:nullptr;
}
inline bool same(const char* a,const char* b) { return a && strcmp(a,b)==0; }
// Ambiguous duplicate keys and excessive nesting are not accepted as commands/config.
inline bool uniqueKeys(cJSON* o,unsigned depth=0) {
  if (depth>12) return false;
  for (cJSON* a=o?o->child:nullptr;a;a=a->next) {
    if (cJSON_IsObject(o)) for (cJSON* b=a->next;b;b=b->next)
      if (a->string && b->string && strcmp(a->string,b->string)==0) return false;
    if (!uniqueKeys(a,depth+1)) return false;
  }
  return true;
}
inline cJSON* parse(const String& text) {
  // Bound parser recursion BEFORE cJSON allocates or descends into untrusted input.
  unsigned depth=0; bool quoted=false,escaped=false;
  if (text.length()>16384) return nullptr;
  for (char c:text) {
    if (quoted) {
      if (escaped) escaped=false;
      else if (c=='\\') escaped=true;
      else if (c=='"') quoted=false;
    } else if (c=='"') quoted=true;
    else if (c=='{' || c=='[') { if (++depth>12) return nullptr; }
    else if (c=='}' || c==']') { if (!depth) return nullptr; --depth; }
  }
  if (quoted || depth) return nullptr;
  cJSON* root=cJSON_ParseWithOpts(text.c_str(),nullptr,true);
  if (!root || !cJSON_IsObject(root) || !uniqueKeys(root)) { cJSON_Delete(root); return nullptr; }
  return root;
}
inline String encoded(cJSON* root) {
  char* data=cJSON_PrintUnformatted(root);
  if (!data) return String();
  String result(data); cJSON_free(data); return result;
}
inline void timestamp(cJSON* root,const char* key,uint64_t value) {
  if (!value) { cJSON_AddNullToObject(root,key); return; }
  time_t seconds=value/1000; struct tm t; gmtime_r(&seconds,&t);
  char text[25]; strftime(text,sizeof(text),"%Y-%m-%dT%H:%M:%SZ",&t);
  cJSON_AddStringToObject(root,key,text);
}

class State {
 public:
  Persistent data;
  bool persistenceOk=false;
  // Runtime provenance only; the persistent binary layout remains monitor-v2.
  bool loadedFromNvs=false;
  char boot[9]={};
  uint64_t restFrom=0;
  uint8_t effectiveMode=0;
  bool begin() {
    snprintf(boot,sizeof(boot),"%08lx",(unsigned long)esp_random());
    restFrom=monoMs();
    Preferences prefs;
    if (!prefs.begin("agro-state",false)) { storageFault(); return false; }
    const size_t size=prefs.getBytesLength("manual-v3");
    bool fresh=size==0;
    bool valid=fresh;
    if (!fresh && size==sizeof(data)) {
      prefs.getBytes("manual-v3",&data,sizeof(data));
      const uint32_t crc=data.crc; data.crc=0;
      valid=data.magic==0x41474332 && data.schema==3 && agro::crc32(&data,sizeof(data))==crc;
      data.crc=crc;
    }
    bool migrated=false;
    if (fresh && prefs.getBytesLength("monitor-v2")) {
      auto old=std::unique_ptr<LegacyPersistent>(new(std::nothrow) LegacyPersistent());
      valid=old && prefs.getBytesLength("monitor-v2")==sizeof(LegacyPersistent) &&
        prefs.getBytes("monitor-v2",old.get(),sizeof(LegacyPersistent))==sizeof(LegacyPersistent);
      if (valid) {
        const uint32_t crc=old->crc; old->crc=0;
        valid=old->magic==0x41474332 && old->schema==2 && agro::crc32(old.get(),sizeof(LegacyPersistent))==crc;
      }
      if (valid) { migrate(*old); migrated=true; }
    }
    prefs.end();
    if (!valid) { data=Persistent(); storageFault(); return false; }
    loadedFromNvs=!fresh || migrated;
    persistenceOk=true;
    const bool uncertain=requiresRecovery(data);
    if (uncertain) {
      if (data.blockCounter>=agro::MaxSafeInteger) { storageFault(); return false; }
      // Trial recovery is deliberately local-only; never resume an effect after reset.
      if (data.block.cause==Cause::None || data.block.cause==Cause::Sensor || data.block.cause==Cause::Stale) {
        const bool previousCritical=data.block.cause!=Cause::None;
        data.block=Block(); data.block.id=++data.blockCounter;
        data.block.cause=previousCritical?Cause::Control:Cause::Uncertain;
        memcpy(data.block.boot,boot,sizeof(boot)); data.block.sinceMono=monoMs();
      }
      for (auto& r:data.journal) if (r.id && r.phase==Phase::Intention) {
        r.phase=Phase::Final; r.ack=ack(r.id,Code::Uncertain,false,false); r.ack.failed=true;
        r.confirmed=false; r.quarantined=false;
      }
      data.runningId=0;
    }
    return fresh || uncertain?save():true;
  }
  bool save() {
    // Only the network coordinator owns this state. No write per sample/tick.
    if (!persistenceOk) return false;
    data.crc=0; data.crc=agro::crc32(&data,sizeof(data));
    Preferences prefs;
    if (!prefs.begin("agro-state",false)) { storageFault(); return false; }
    bool ok=prefs.putBytes("manual-v3",&data,sizeof(data))==sizeof(data);
    auto verify=std::unique_ptr<Persistent>(new(std::nothrow) Persistent());
    ok=ok && verify && prefs.getBytes("manual-v3",verify.get(),sizeof(data))==sizeof(data) && memcmp(verify.get(),&data,sizeof(data))==0;
    prefs.end(); persistenceOk=ok;
    if (!ok) storageFault();
    return ok;
  }
  bool activateBlock(Cause cause,bool clockTrusted) {
    if (data.block.cause==Cause::Persistence || data.block.cause==Cause::Control ||
        data.block.cause==Cause::InvalidConfig || data.block.cause==Cause::Uncertain || data.block.cause==cause) return false;
    if (data.blockCounter>=agro::MaxSafeInteger) { persistenceOk=false; return false; }
    data.block=Block(); data.block.cause=cause; data.block.id=++data.blockCounter;
    data.block.sinceMono=monoMs(); data.block.sinceUtc=clockTrusted?utcMs():0;
    memcpy(data.block.boot,boot,sizeof(boot));
    save(); return true;
  }
  void storageFault() {
    persistenceOk=false; effectiveMode=0;
    if (data.block.cause!=Cause::Persistence) {
      data.block=Block(); data.block.cause=Cause::Persistence;
      data.block.id=data.blockCounter<agro::MaxSafeInteger?++data.blockCounter:agro::MaxSafeInteger;
      data.block.sinceMono=monoMs(); memcpy(data.block.boot,boot,sizeof(boot));
    }
  }
  Ack ack(uint64_t id,Code code,bool applied,bool clockTrusted) const {
    Ack result; result.id=id; result.code=code; result.applied=applied;
    result.uptime=monoMs(); result.utc=clockTrusted?utcMs():0;
    result.configVersion=data.config.version; result.block=data.block;
    result.mode=effectiveMode;
    memcpy(result.origin,boot,sizeof(boot));
    const uint64_t rest=uint64_t(data.config.cooldownSeconds)*1000;
    result.restSeconds=monoMs()-restFrom>=rest?0:(rest-(monoMs()-restFrom)+999)/1000;
    return result;
  }
  Record* find(uint64_t id) {
    for (auto& r:data.journal) if (r.id==id) return &r;
    for (auto& r:data.offAcks) if (r.id==id) return &r;
    return nullptr;
  }
  Record* reserve(bool off) {
    if (off) {
      for (auto& r:data.offAcks) if (!r.id || r.confirmed) return &r;
      Record* oldest=&data.offAcks[0];
      for (auto& r:data.offAcks) if (r.id<oldest->id) oldest=&r;
      ++data.offDropped; return oldest;
    }
    for (auto& r:data.journal) if (!r.id || r.confirmed) return &r;
    return nullptr;
  }
 private:
  void migrate(const LegacyPersistent& old) {
    data=migrateLegacy(old);
  }
};

inline cJSON* actuator(const Ack& snapshot) {
  cJSON* obj=cJSON_CreateObject();
  cJSON_AddStringToObject(obj,"actuador","BOMBA1");
  cJSON_AddStringToObject(obj,"modo",snapshot.mode==1?"MANUAL":"DESHABILITADO");
  cJSON_AddStringToObject(obj,"estado_bomba",snapshot.pumpOn?"RIEGO_MANUAL":"APAGADA");
  cJSON_AddNumberToObject(obj,"riego_transcurrido_s",snapshot.pumpOn?snapshot.runElapsed:0);
  cJSON_AddNumberToObject(obj,"riego_restante_s",snapshot.pumpOn?snapshot.runRemaining:0);
  cJSON_AddNumberToObject(obj,"descanso_restante_s",snapshot.restSeconds);
  cJSON_AddNumberToObject(obj,"rearmes_remotos_episodio",0);
  if (snapshot.pumpOn) cJSON_AddNumberToObject(obj,"id_orden_activa",double(snapshot.activeId));
  else cJSON_AddNullToObject(obj,"id_orden_activa");
  cJSON_AddNumberToObject(obj,"uptime_ms",double(snapshot.uptime));
  if (snapshot.block.cause==Cause::None) cJSON_AddNullToObject(obj,"bloqueo");
  else {
    cJSON* b=cJSON_AddObjectToObject(obj,"bloqueo");
    cJSON_AddNumberToObject(b,"id_bloqueo",double(snapshot.block.id));
    cJSON_AddStringToObject(b,"tipo",snapshot.block.cause==Cause::Uncertain?"PREVENTIVO":"CRITICO");
    cJSON_AddStringToObject(b,"causa",causeName(snapshot.block.cause));
    cJSON_AddBoolToObject(b,"liberable_remotamente",snapshot.block.cause==Cause::Sensor || snapshot.block.cause==Cause::Stale);
    cJSON_AddStringToObject(b,"desde_id_arranque",snapshot.block.boot);
    cJSON_AddNumberToObject(b,"desde_uptime_ms",double(snapshot.block.sinceMono));
    timestamp(b,"desde_ts",snapshot.block.sinceUtc);
  }
  return obj;
}
inline String ackJson(const Ack& a) {
  cJSON* obj=cJSON_CreateObject();
  cJSON_AddStringToObject(obj,"resultado",a.failed?"FALLIDA":a.applied?"EJECUTADA":"RECHAZADA");
  if (codeName(a.code)) cJSON_AddStringToObject(obj,"codigo_motivo",codeName(a.code));
  else cJSON_AddNullToObject(obj,"codigo_motivo");
  cJSON_AddNullToObject(obj,"mensaje");
  if (a.applied && a.durationApplied) cJSON_AddNumberToObject(obj,"duracion_aplicada_s",a.durationApplied);
  else cJSON_AddNullToObject(obj,"duracion_aplicada_s");
  timestamp(obj,"ejecutada_en",a.utc);
  cJSON_AddStringToObject(obj,"id_arranque_origen",a.origin);
  cJSON_AddNumberToObject(obj,"uptime_ms",double(a.uptime));
  cJSON_AddNumberToObject(obj,"config_version",a.configVersion);
  cJSON_AddItemToObject(obj,"estado_actuador",actuator(a));
  String result=encoded(obj); cJSON_Delete(obj); return result;
}
} // namespace monitor
