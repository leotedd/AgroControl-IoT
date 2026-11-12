#pragma once
#include "SecureTransport.h"
#include "ManualRelay.h"
#include <algorithm>

namespace monitor {
enum class CalibrationSource { Local, Nvs, Backend };
inline const char* calibrationSource(CalibrationSource source) {
  return source==CalibrationSource::Backend?"BACKEND":source==CalibrationSource::Nvs?"NVS":"LOCAL";
}
struct CalibrationSnapshot {
  agro::Calibration calibration;
  uint32_t version=0;
  CalibrationSource source=CalibrationSource::Local;
};
struct Sample {
  agro::Reading reading;
  uint64_t uptime=0,utc=0;
  uint32_t seq=0;
  bool calibrated=true;
  uint32_t configVersion=0;
};
class Samples {
 public:
  void configure(const Config& config,CalibrationSource source=CalibrationSource::Local) {
    portENTER_CRITICAL(&mux_);
    calibration_.dry=config.dry; calibration_.wet=config.wet; calibration_.confirmed=config.calibrated;
    configVersion_=config.version; source_=source;
    validSince_=0; lastSample_=0;
    portEXIT_CRITICAL(&mux_);
  }
  agro::Calibration calibration() {
    portENTER_CRITICAL(&mux_); auto c=calibration_; portEXIT_CRITICAL(&mux_); return c;
  }
  CalibrationSnapshot configuration() {
    portENTER_CRITICAL(&mux_);
    CalibrationSnapshot result{calibration_,configVersion_,source_};
    portEXIT_CRITICAL(&mux_); return result;
  }
  uint32_t sequence() {
    portENTER_CRITICAL(&mux_); if (seq_!=UINT32_MAX) ++seq_; uint32_t s=seq_; portEXIT_CRITICAL(&mux_); return s;
  }
  void add(Sample s) {
    s.seq=sequence(); portENTER_CRITICAL(&mux_);
    // A configuration can change while the ADC task computes its previous window.
    if (s.configVersion!=configVersion_) { ++dropped_; portEXIT_CRITICAL(&mux_); return; }
    latest_=s;
    if (!s.reading.valid) validSince_=0;
    else if (!validSince_ || (lastSample_ && s.uptime-lastSample_>=3000)) validSince_=s.uptime;
    lastSample_=s.uptime;
    if (count_==100) { head_=(head_+1)%100; --count_; ++dropped_; }
    items_[(head_+count_)%100]=s; ++count_;
    portEXIT_CRITICAL(&mux_);
  }
  Sample latest() { portENTER_CRITICAL(&mux_); Sample s=latest_; portEXIT_CRITICAL(&mux_); return s; }
  size_t batch(Sample* out) {
    portENTER_CRITICAL(&mux_); size_t count=count_>30?30:count_;
    for (size_t i=0;i<count;++i) out[i]=items_[(head_+i)%100];
    portEXIT_CRITICAL(&mux_); return count;
  }
  void delivered(uint32_t lastSeq) {
    portENTER_CRITICAL(&mux_);
    while (count_ && items_[head_].seq<=lastSeq) { head_=(head_+1)%100; --count_; }
    portEXIT_CRITICAL(&mux_);
  }
  uint32_t dropped() { portENTER_CRITICAL(&mux_); uint32_t n=dropped_; portEXIT_CRITICAL(&mux_); return n; }
  uint64_t validSince() { portENTER_CRITICAL(&mux_); uint64_t n=validSince_; portEXIT_CRITICAL(&mux_); return n; }
 private:
  portMUX_TYPE mux_=portMUX_INITIALIZER_UNLOCKED;
  agro::Calibration calibration_;
  uint32_t configVersion_=0;
  CalibrationSource source_=CalibrationSource::Local;
  Sample latest_,items_[100];
  size_t head_=0,count_=0;
  uint32_t seq_=0,dropped_=0;
  uint64_t validSince_=0,lastSample_=0;
};

class Runtime {
 public:
  Samples samples;
  Transport net;
  State state;
  manual_trial::Relay relay;
  std::atomic<bool> timeReady{false};
  void controlCycle() {
    const bool alive=net.apiHealthy.load();
    if (wasHealthyControl_ && !alive) apiLost();
    wasHealthyControl_=alive;
    relay.tick(controlInputs());
  }
  void networkLost() { needsManualTransition_=true; controlMode_=0; relay.stop(manual_trial::Stop::Wifi); }
  void apiLost() { needsManualTransition_=true; controlMode_=0; relay.stop(manual_trial::Stop::Api); }
  void clockChanged() { needsManualTransition_=true; controlMode_=0; relay.stop(manual_trial::Stop::Clock); }
  void begin() {
    state.begin(); samples.configure(state.data.config,state.loadedFromNvs?CalibrationSource::Nvs:CalibrationSource::Local);
    net.setBoot(state.boot); net.begin();
    publishControl();
    if (manual_trial::Relay::enabled() && !relay.ready()) state.activateBlock(Cause::Control,false);
    String ssid,password;
    Preferences p;
    if (p.begin("agro-wifi",true)) {
      ssid=p.getString("ssid",""); password=p.getString("password",""); p.end();
    }
    ssid_=ssid; password_=password;
    // One owner for retries; driver auto-reconnect would bypass our schedule.
    WiFi.persistent(false); WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(false);
    event("ARRANQUE",nullptr);
    Serial.printf("monitor boot=%s contract=%s persist=%d bytes=%u relay=UNTOUCHED\n",
      state.boot,settings::contractVersion,state.persistenceOk,unsigned(sizeof(Persistent)));
  }
  void cycle() {
    struct PublishOnExit { Runtime& r; ~PublishOnExit(){r.publishControl();} } publication{*this};
    finishStoppedRun();
    uint64_t now=monoMs();
    if (ssid_.length() && reconnect_.due(uint32_t(now),WiFi.status()==WL_CONNECTED))
      WiFi.begin(ssid_.c_str(),password_.c_str());
    net.refreshLink();
    timeReady=net.clockReady();
    sensorSafety();
    connectionEvents();
    if (now-lastStatus_>=5000 && Serial.availableForWrite()>=140) {
      lastStatus_=now;
      Serial.printf("wifi=%d sntp=%d api_provisioned=%d api_config=%s state=%s persist=%d relay=%s\n",
        WiFi.status()==WL_CONNECTED,timeReady.load(),net.provisioned,net.provisioningStatus,net.status.c_str(),state.persistenceOk,relay.status());
    }
    if (!net.provisioned || !ssid_.length() || !password_.length() || WiFi.status()!=WL_CONNECTED ||
        !timeReady || now<net.nextAttempt) return;
    if (now>=nextConfigAck_) {
      if (configAck_.length()) {
        String response; int code=net.request("POST","/iot/configuracion/confirmacion",configAck_,response);
        if (code==200 || code==400 || code==404 || code==409 || code==422) configAck_=String();
        nextConfigAck_=monoMs()+3000; return;
      }
    }
    if (sendAck()) return;
    if (!configFetched_ || now>=nextConfig_) {
      String response; int code=net.request("GET","/iot/configuracion",String(),response);
      if (code==200) applyConfig(response);
      configFetched_=code==200 || code==304;
      nextConfig_=monoMs()+60000; return;
    }
    if (now>=nextCommands_) {
      String response; int code=net.request("GET","/iot/ordenes",String(),response);
      const uint64_t sent=net.sentAt,server=net.serverTime;
      if (code==200) commands(response,sent,server);
      nextCommands_=monoMs()+uint64_t(state.data.config.commandSeconds)*1000; return;
    }
    if (now>=nextTelemetry_) {
      telemetry(); nextTelemetry_=monoMs()+uint64_t(state.data.config.telemetrySeconds)*1000; return;
    }
    if (eventCount_ && now>=nextEvents_) { sendEvents(); nextEvents_=monoMs()+1000; }
  }
 private:
  String ssid_,password_,configAck_;
  agro::ReconnectSchedule reconnect_;
  bool configFetched_=false,wasApiConnected_=false,previousSensorValid_=false;
  uint64_t disconnectedSince_=0;
  uint32_t reportedReadingDrops_=0,reportedEventDrops_=0;
  uint64_t nextConfig_=0,nextConfigAck_=0,nextCommands_=0,nextTelemetry_=0,nextEvents_=0;
  uint64_t lastStatus_=0;
  uint64_t validSince_=0;
  String events_[20]; unsigned eventHead_=0,eventCount_=0,eventDropped_=0;
  Record transientAck_; bool transientPending_=false;
  uint64_t receivedReadings_=0,duplicateReadings_=0,rejectedReadings_=0;
  uint32_t invalidReceipts_=0;
  std::atomic<bool> controlBlocked_{true},controlPersistent_{false};
  std::atomic<uint8_t> controlMode_{0};
  std::atomic<uint32_t> controlVersion_{0};
  std::atomic<float> controlUpper_{55};
  std::atomic<bool> needsManualTransition_{false};
  bool wasHealthyControl_=false; // Owned only by Arduino loop, not by network task.

  void publishControl() {
    if (needsManualTransition_) state.effectiveMode=0;
    controlBlocked_=state.data.block.cause!=Cause::None;
    controlPersistent_=state.persistenceOk; controlMode_=state.effectiveMode;
    controlVersion_=state.data.config.version; controlUpper_=state.data.config.stop;
  }
  manual_trial::Inputs controlInputs() {
    manual_trial::Inputs in; const Sample s=samples.latest();
    in.now=monoMs(); in.utc=utcMs(); in.sampled=s.uptime;
    in.wifi=WiFi.status()==WL_CONNECTED; in.clock=net.clockReady();
    in.api=net.apiHealthy.load(); in.lastApi=net.lastApiResponse.load();
    in.manual=controlMode_.load()==1; in.blocked=controlBlocked_.load();
    in.persistent=controlPersistent_.load(); in.calibrated=s.calibrated;
    in.valid=s.reading.valid && s.configVersion==controlVersion_.load();
    in.moisture=s.reading.percent; in.upper=controlUpper_.load(); return in;
  }
  Ack currentAck(uint64_t id,Code code,bool applied) {
    Ack result=state.ack(id,code,applied,net.trusted); const auto run=relay.snapshot();
    const uint64_t now=monoMs();
    result.pumpOn=run.active; result.activeId=run.active?run.id:0;
    if (run.active) {
      result.runElapsed=uint32_t((now-run.started)/1000);
      result.runRemaining=now>=run.end?0:uint32_t((run.end-now+999)/1000);
    }
    return result;
  }
  void finishStoppedRun() {
    const auto run=relay.snapshot(); if (run.pending==manual_trial::Stop::None) return;
    state.restFrom=run.stopped; state.data.runningId=0;
    const bool fault=run.latched;
    if (fault) {
      state.effectiveMode=0;
      if (state.activateBlock(Cause::Control,net.trusted)) {
        cJSON* b=cJSON_CreateObject();
        cJSON_AddNumberToObject(b,"id_bloqueo",double(state.data.block.id));
        cJSON_AddStringToObject(b,"tipo","CRITICO"); cJSON_AddStringToObject(b,"causa",causeName(state.data.block.cause));
        cJSON_AddBoolToObject(b,"liberable_remotamente",false); cJSON_AddNumberToObject(b,"rearmes_remotos_episodio",0);
        event("BLOQUEO_ACTIVADO",b);
      }
    }
    if (!state.save()) relay.stop(manual_trial::Stop::Block);
    cJSON* d=cJSON_CreateObject();
    cJSON_AddStringToObject(d,"origen","MANUAL");
    const char* why=run.pending==manual_trial::Stop::Duration?"DURACION_CUMPLIDA":
      run.pending==manual_trial::Stop::Config?"CONFIG_ACTUALIZADA":
      run.pending==manual_trial::Stop::Wet?"UMBRAL_ALCANZADO":
      run.pending==manual_trial::Stop::Off?"ORDEN_APAGAR":"CORTE_SEGURIDAD";
    cJSON_AddStringToObject(d,"motivo_fin",why);
    cJSON_AddNumberToObject(d,"duracion_s",double(run.stopped-run.started)/1000);
    cJSON_AddNumberToObject(d,"id_orden",double(run.id));
    cJSON_AddNumberToObject(d,"humedad_inicio_pct",run.startingMoisture);
    const auto last=samples.latest();
    if (last.reading.valid) cJSON_AddNumberToObject(d,"humedad_fin_pct",last.reading.percent);
    else cJSON_AddNullToObject(d,"humedad_fin_pct");
    const char* local=run.pending==manual_trial::Stop::Wifi?"SIN_WIFI":
      run.pending==manual_trial::Stop::Api?"SIN_API":run.pending==manual_trial::Stop::Clock?"SIN_HORA":
      run.pending==manual_trial::Stop::Sensor?"SENSOR_INVALIDO":run.pending==manual_trial::Stop::Expiry?"ORDEN_CADUCADA":
      run.pending==manual_trial::Stop::Backup?"CORTE_RESPALDO":why;
    cJSON_AddStringToObject(d,"causa_local_banco",local);
    event("RIEGO_FINALIZADO",d); relay.acknowledgedStop(run.id);
    if (run.pending==manual_trial::Stop::Backup) {
      cJSON* backup=cJSON_CreateObject(); cJSON_AddNumberToObject(backup,"duracion_aplicada_s",run.seconds);
      cJSON_AddNumberToObject(backup,"retraso_ms",run.stopped>run.end?double(run.stopped-run.end):0);
      event("CORTE_RESPALDO",backup);
    }
    nextTelemetry_=0; nextEvents_=0;
  }

  void event(const char* type,cJSON* details) {
    cJSON* o=cJSON_CreateObject(); cJSON_AddNumberToObject(o,"seq",samples.sequence());
    cJSON_AddStringToObject(o,"tipo",type);
    cJSON_AddStringToObject(o,"actuador","BOMBA1");
    cJSON_AddNumberToObject(o,"uptime_ms",double(monoMs())); timestamp(o,"ts",net.clockReady()?utcMs():0);
    if (!details) {
      details=cJSON_CreateObject();
      if (same(type,"ARRANQUE")) {
        cJSON_AddStringToObject(details,"motivo_reinicio",resetReason());
        cJSON_AddStringToObject(details,"version_firmware",settings::firmwareVersion);
        cJSON_AddStringToObject(details,"modo_inicial","DESHABILITADO");
        cJSON_AddArrayToObject(details,"ordenes_inciertas");
      }
    }
    cJSON_AddItemToObject(o,"datos",details);
    if (eventCount_==20) { eventHead_=(eventHead_+1)%20; --eventCount_; ++eventDropped_; }
    events_[(eventHead_+eventCount_)%20]=encoded(o); ++eventCount_; cJSON_Delete(o);
  }
  const char* resetReason() {
    switch (esp_reset_reason()) {
      case ESP_RST_POWERON:return "POWERON"; case ESP_RST_BROWNOUT:return "BROWNOUT";
      case ESP_RST_PANIC:return "PANIC"; case ESP_RST_SW:return "SOFTWARE";
      case ESP_RST_TASK_WDT:case ESP_RST_INT_WDT:case ESP_RST_WDT:return "WATCHDOG";
      default:return "OTRO";
    }
  }
  void sensorSafety() {
    const Sample s=samples.latest(); const uint64_t now=monoMs();
    const bool fresh=s.uptime && s.reading.valid && now-s.uptime<3000;
    if (s.uptime && fresh!=previousSensorValid_) {
      cJSON* detail=cJSON_CreateObject(); cJSON_AddStringToObject(detail,"sensor","HUM1");
      cJSON_AddNumberToObject(detail,"valor_raw",s.reading.raw);
      cJSON_AddStringToObject(detail,"estado",fresh?"OK":s.calibrated?"ERROR_SENSOR":"SIN_CALIBRAR");
      event(fresh?"SENSOR_RECUPERADO":"FALLA_SENSOR",detail);
    }
    previousSensorValid_=fresh;
    if (fresh) validSince_=samples.validSince();
    else {
      validSince_=0;
      if (s.uptime || now>=10000) {
        Cause cause=s.uptime && now-s.uptime>=3000?Cause::Stale:Cause::Sensor;
        if (state.activateBlock(cause,net.trusted)) {
          state.effectiveMode=0;
          cJSON* d=cJSON_CreateObject(); cJSON_AddNumberToObject(d,"id_bloqueo",double(state.data.block.id));
          cJSON_AddStringToObject(d,"tipo","CRITICO"); cJSON_AddStringToObject(d,"causa",causeName(state.data.block.cause));
          cJSON_AddBoolToObject(d,"liberable_remotamente",state.data.block.cause!=Cause::Persistence);
          event("BLOQUEO_ACTIVADO",d);
        }
      }
    }
  }
  void connectionEvents() {
    const bool connected=WiFi.status()==WL_CONNECTED && net.clockReady() && net.trusted && net.status=="CONECTADO";
    if (connected && !wasApiConnected_) {
      cJSON* detail=cJSON_CreateObject();
      cJSON_AddNumberToObject(detail,"sin_conexion_s",double((monoMs()-disconnectedSince_)/1000));
      cJSON_AddStringToObject(detail,"causa","SIN_API"); event("CONEXION_RECUPERADA",detail);
    } else if (!connected && wasApiConnected_) disconnectedSince_=monoMs();
    wasApiConnected_=connected;
    const uint32_t readings=samples.dropped();
    if (connected && (readings!=reportedReadingDrops_ || eventDropped_!=reportedEventDrops_)) {
      cJSON* detail=cJSON_CreateObject();
      cJSON_AddNumberToObject(detail,"lecturas",readings-reportedReadingDrops_);
      cJSON_AddNumberToObject(detail,"eventos",eventDropped_-reportedEventDrops_);
      event("DATOS_DESCARTADOS",detail); reportedReadingDrops_=readings; reportedEventDrops_=eventDropped_;
    }
  }
  void configResult(uint32_t version,bool applied,const char* field=nullptr,const char* code=nullptr) {
    cJSON* o=cJSON_CreateObject(); cJSON_AddNumberToObject(o,"config_version",version);
    cJSON_AddStringToObject(o,"resultado",applied?"APLICADA":"RECHAZADA");
    cJSON* errors=cJSON_AddArrayToObject(o,"errores");
    if (!applied) {
      cJSON* e=cJSON_CreateObject(); cJSON_AddStringToObject(e,"campo",field?field:"config_version");
      cJSON_AddStringToObject(e,"codigo",code?code:"FUERA_DE_RANGO"); cJSON_AddItemToArray(errors,e);
    }
    cJSON* actuators=cJSON_AddArrayToObject(o,"actuadores");
    cJSON_AddItemToArray(actuators,actuator(currentAck(0,Code::None,false)));
    configAck_=encoded(o); cJSON_Delete(o);
  }
  void applyConfig(const String& response) {
    cJSON* root=parse(response); if (!root) { apiLost(); net.invalidate(); return; }
    cJSON* d=cJSON_GetObjectItemCaseSensitive(root,"data"); uint64_t version=0;
    if (!number(d,"config_version",version,true) || version>UINT32_MAX) { apiLost(); net.invalidate(); cJSON_Delete(root); return; }
    if (version<state.data.config.version) { apiLost(); configResult(version,false,"config_version","VERSION_REGRESIVA"); cJSON_Delete(root); return; }
    if (version==state.data.config.version) { configResult(version,true); cJSON_Delete(root); return; }
    Config candidate; candidate.version=version;
    const char* errorField="control"; const char* errorCode="FUERA_DE_RANGO";
    bool valid=true; uint64_t v=0;
    cJSON* sensors=cJSON_GetObjectItemCaseSensitive(d,"sensores"); cJSON* controls=cJSON_GetObjectItemCaseSensitive(d,"control");
    valid=cJSON_IsArray(sensors) && cJSON_GetArraySize(sensors)==1 && cJSON_IsArray(controls) && cJSON_GetArraySize(controls)==1;
    cJSON* sensor=cJSON_GetArrayItem(sensors,0); cJSON* control=cJSON_GetArrayItem(controls,0);
    if (!same(string(sensor,"sensor"),"HUM1") || !same(string(control,"sensor"),"HUM1")) {
      valid=false; errorField="sensores"; errorCode="SENSOR_DESCONOCIDO";
    }
    if (!same(string(control,"actuador"),"BOMBA1")) { valid=false; errorField="control"; errorCode="ACTUADOR_DESCONOCIDO"; }
    if (!same(string(sensor,"tipo"),"HUMEDAD_SUELO")) valid=false;
    auto integer=[&](cJSON* obj,const char* key,uint64_t low,uint64_t high) {
      if (!number(obj,key,v) || v<low || v>high) { valid=false; return false; } return true;
    };
    if (integer(sensor,"raw_seco",21,4074)) candidate.dry=v;
    if (integer(sensor,"raw_humedo",21,4074)) candidate.wet=v;
    if (abs(candidate.dry-candidate.wet)<200) valid=false;
    cJSON* confirmed=cJSON_GetObjectItemCaseSensitive(sensor,"calibracion_confirmada");
    if (!cJSON_IsBool(confirmed)) valid=false;
    candidate.calibrated=cJSON_IsTrue(confirmed) && settings::calibrationConfirmed;
    if (integer(d,"intervalo_telemetria_s",5,3600)) candidate.telemetrySeconds=v;
    if (integer(d,"intervalo_ordenes_s",2,60)) candidate.commandSeconds=v;
    if (integer(control,"riego_max_s",5,600)) {
      candidate.maximumSeconds=v;
      if (v>settings::absoluteMaximumSeconds) { valid=false; errorField="control[0].riego_max_s"; errorCode="FUERA_DE_CAPACIDAD"; }
    }
    if (integer(control,"descanso_min_s",5,86400)) candidate.cooldownSeconds=v;
    cJSON* start=cJSON_GetObjectItemCaseSensitive(control,"umbral_inicio_pct");
    cJSON* stop=cJSON_GetObjectItemCaseSensitive(control,"umbral_parada_pct");
    if (!cJSON_IsNumber(start) || !cJSON_IsNumber(stop) || !isfinite(start->valuedouble) || !isfinite(stop->valuedouble) ||
        start->valuedouble<0 || start->valuedouble>95 || stop->valuedouble>100 || stop->valuedouble<5 ||
        stop->valuedouble-start->valuedouble<5) valid=false;
    else { candidate.start=start->valuedouble; candidate.stop=stop->valuedouble; }
    const char* mode=string(control,"modo");
    if (same(mode,"MANUAL")) candidate.desiredMode=1;
    else if (same(mode,"AUTOMATICO")) { valid=false; errorField="control[0].modo"; errorCode="MODO_NO_SOPORTADO"; }
    else if (!same(mode,"DESHABILITADO")) valid=false;
    if (!valid) { apiLost(); configResult(version,false,errorField,errorCode); }
    else if (!state.persistenceOk) configResult(version,false,"config_version","PERSISTENCIA_NO_DISPONIBLE");
    else {
      relay.stop(manual_trial::Stop::Config); finishStoppedRun();
      const Config previous=state.data.config;
      state.data.config=candidate;
      if (!state.save()) { state.data.config=previous; configResult(version,false,"config_version","PERSISTENCIA_NO_DISPONIBLE"); }
      else {
        // MANUAL is allowed for protocol testing; hardware gate rejects every ON.
        // Automatic is never enabled in a monitor build, regardless of server input.
        const bool explicitManual=candidate.desiredMode==1 && previous.desiredMode==0;
        if (explicitManual && state.data.block.cause==Cause::None) needsManualTransition_=false;
        state.effectiveMode=state.data.block.cause==Cause::None && candidate.desiredMode==1 &&
          !needsManualTransition_ && (explicitManual || state.effectiveMode==1)?1:0;
        state.restFrom=monoMs(); samples.configure(candidate,CalibrationSource::Backend); validSince_=0;
        configResult(version,true);
        cJSON* details=cJSON_CreateObject(); cJSON_AddNumberToObject(details,"config_version",version); event("CONFIG_APLICADA",details);
      }
    }
    cJSON_Delete(root);
  }
  bool digest(cJSON* command,uint8_t out[32]) {
    // Canonical known fields only; extension fields are ignored per contract.
    cJSON* obj=cJSON_CreateObject();
    for (const char* key:{"tipo","actuador","creada_en","expira_en"}) {
      const char* v=string(command,key); if (v) cJSON_AddStringToObject(obj,key,v);
    }
    cJSON* params=cJSON_GetObjectItemCaseSensitive(command,"parametros");
    cJSON* p=cJSON_AddObjectToObject(obj,"parametros");
    for (const char* key:{"duracion_s","id_bloqueo","causa","inspeccion_confirmada"}) {
      cJSON* item=cJSON_GetObjectItemCaseSensitive(params,key);
      if (item) cJSON_AddItemToObject(p,key,cJSON_Duplicate(item,true));
    }
    String text=encoded(obj); cJSON_Delete(obj);
    return text.length() && mbedtls_sha256(reinterpret_cast<const unsigned char*>(text.c_str()),text.length(),out,0)==0;
  }
  void commands(const String& response,uint64_t sent,uint64_t server) {
    cJSON* root=parse(response); if (!root) { apiLost(); net.invalidate(); return; }
    cJSON* data=cJSON_GetObjectItemCaseSensitive(root,"data");
    uint64_t configVersion=0;
    const bool versionKnown=number(data,"config_version",configVersion,true) && configVersion<=UINT32_MAX;
    cJSON* orders=cJSON_GetObjectItemCaseSensitive(data,"ordenes");
    if (!cJSON_IsArray(orders)) { apiLost(); net.invalidate(); cJSON_Delete(root); return; }
    uint64_t highestOff=0;
    cJSON* order=nullptr;
    cJSON_ArrayForEach(order,orders) {
      uint64_t id=0;
      if (same(string(order,"tipo"),"BOMBA_APAGAR") && same(string(order,"actuador"),"BOMBA1") && number(order,"id",id,true)) {
        if (id>highestOff) highestOff=id;
        off(id);
      }
    }
    // Always honor OFF first, but never start/rearm using a different configuration version.
    if (!versionKnown || configVersion!=state.data.config.version || cJSON_GetArraySize(orders)>5) {
      nextConfig_=0; apiLost(); cJSON_Delete(root); return;
    }
    // Orders from other batches cannot overlap: one sequential network coordinator.
    uint64_t previous=0;
    cJSON_ArrayForEach(order,orders) {
      if (same(string(order,"tipo"),"BOMBA_APAGAR") && same(string(order,"actuador"),"BOMBA1")) continue;
      uint64_t id=0; if (!number(order,"id",id,true)) continue;
      if (id<previous) continue; previous=id;
      process(order,id,sent,server,highestOff>0);
    }
    cJSON_Delete(root);
  }
  void off(uint64_t id) {
    // Physical OFF (when electrically enabled) BEFORE any allocation or persistence.
    relay.stop(manual_trial::Stop::Off); finishStoppedRun();
    state.effectiveMode=state.effectiveMode==2?1:state.effectiveMode;
    state.data.offBarrier=id>state.data.offBarrier?id:state.data.offBarrier;
    for (auto& existing:state.data.offAcks) if (existing.id==id) {
      existing.confirmed=false; state.save(); return;
    }
    Record* record=state.reserve(true); *record=Record(); record->id=id;
    record->ack=currentAck(id,Code::NoChange,true);
    if (!state.save()) { transientAck_=*record; transientPending_=true; }
  }
  bool stableSensor() {
    const Sample sample=samples.latest(); const uint64_t since=samples.validSince(),now=monoMs();
    return sample.uptime && sample.reading.valid && sample.calibrated && now-sample.uptime<3000 &&
           since && now-since>=10000;
  }
  void process(cJSON* order,uint64_t id,uint64_t sent,uint64_t server,bool offInBatch) {
    uint8_t hash[32]; if (!digest(order,hash)) return;
    Record* existing=state.find(id);
    if (existing) {
      if (memcmp(hash,existing->digest,32)!=0) {
        transientAck_=Record(); transientAck_.id=id; transientAck_.ack=state.ack(id,Code::Reused,false,net.trusted); transientPending_=true;
      } else { existing->confirmed=false; state.save(); }
      return;
    }
    Code result=Code::Hardware; bool applied=false;
    const char* type=string(order,"tipo"); const char* target=string(order,"actuador");
    const bool isOn=same(type,"BOMBA_ENCENDER"),reset=same(type,"RESTABLECER_BLOQUEO");
    uint64_t expiry=0,created=0;
    cJSON* params=cJSON_GetObjectItemCaseSensitive(order,"parametros");
    uint64_t duration=0,blockId=0;
    if (!same(target,"BOMBA1")) result=Code::UnknownActuator;
    else if (!isOn && !reset) result=Code::UnknownType;
    else if (!cJSON_IsObject(params) || !agro::parseUtc(string(order,"expira_en"),expiry) ||
             !agro::parseUtc(string(order,"creada_en"),created) || created>=expiry ||
             (isOn && (!number(params,"duracion_s",duration,true) || duration>600)) ||
             (reset && (!number(params,"id_bloqueo",blockId,true) || !string(params,"causa") ||
                        !cJSON_IsBool(cJSON_GetObjectItemCaseSensitive(params,"inspeccion_confirmada"))))) result=Code::Invalid;
    else if (id<=state.data.watermark) result=Code::Duplicate;
    else if (offInBatch) result=Code::BatchOff;
    else if (id<state.data.offBarrier) result=Code::Cancelled;
    else if (!net.trusted) result=Code::Clock;
    else if (!agro::liveOrder(net.trusted,utcMs(),monoMs(),expiry,agro::deadline(sent,expiry,server))) result=Code::Expired;
    else if (!state.persistenceOk) result=Code::Persistence;
    else if (isOn && manual_trial::Relay::enabled()) { executeOn(id,hash,duration,expiry,sent,server); return; }
    else if (isOn) result=Code::Hardware; // Compile-time monitor gate: no ON execution path.
    else if (state.data.block.cause==Cause::None || blockId!=state.data.block.id ||
             !same(string(params,"causa"),causeName(state.data.block.cause))) result=Code::NotMatching;
    else if ((state.data.block.cause!=Cause::Sensor && state.data.block.cause!=Cause::Stale) ||
             !stableSensor()) result=Code::NotReleasable;
    else { result=Code::None; applied=true; }
    Record* record=state.reserve(false);
    if (!record || !state.persistenceOk) {
      transientAck_=Record(); transientAck_.id=id; transientAck_.ack=state.ack(id,Code::Persistence,false,net.trusted);
      transientPending_=true; return;
    }
    *record=Record(); record->id=id; memcpy(record->digest,hash,32);
    const Block oldBlock=state.data.block;
    if (applied && (!stableSensor() || !agro::liveOrder(net.trusted,utcMs(),monoMs(),expiry,agro::deadline(sent,expiry,server)))) {
      applied=false; result=stableSensor()?Code::Expired:Code::NotReleasable;
    }
    if (applied) { state.data.block=Block(); state.effectiveMode=0; state.restFrom=monoMs(); }
    record->ack=state.ack(id,result,applied,net.trusted);
    if (id>state.data.watermark) state.data.watermark=id;
    // All ONs are rejected, so there can be no GPIO effect between INTENCION/FINAL.
    // The monitoring result, recovery state and watermark are one atomic blob.
    if (!state.save()) {
      if (applied) state.data.block=oldBlock;
      record->ack=state.ack(id,Code::Persistence,false,net.trusted);
      transientAck_=*record; transientPending_=true;
    } else if (applied) {
      cJSON* details=cJSON_CreateObject(); cJSON_AddNumberToObject(details,"id_bloqueo",double(oldBlock.id));
      cJSON_AddStringToObject(details,"por","ORDEN"); cJSON_AddNumberToObject(details,"id_orden",double(id));
      event("BLOQUEO_LIBERADO",details);
    }
  }
  Code startCode(manual_trial::Start result) {
    using S=manual_trial::Start;
    switch(result) {
      case S::Applied:return Code::None; case S::Hardware:return Code::Hardware;
      case S::Mode:return Code::Mode; case S::Block:return Code::Blocked;
      case S::Sensor:return Code::SensorInvalid; case S::Wet:return Code::Wet;
      case S::Cooldown:return Code::Cooldown; case S::Busy:return Code::Busy;
      case S::Clock:return Code::Clock; case S::Expired:return Code::Expired;
      case S::Network:return Code::Clock; case S::Persistence:return Code::Persistence;
    }
    return Code::Invalid;
  }
  void executeOn(uint64_t id,const uint8_t hash[32],uint64_t requested,uint64_t expiry,uint64_t sent,uint64_t server) {
    finishStoppedRun();
    publishControl();
    Record* record=state.reserve(false);
    if (!record) {
      transientAck_=Record(); transientAck_.id=id; transientAck_.ack=currentAck(id,Code::Persistence,false); transientPending_=true; return;
    }
    *record=Record(); record->id=id; memcpy(record->digest,hash,32);
    const uint32_t seconds=uint32_t(std::min(requested,std::min(uint64_t(state.data.config.maximumSeconds),uint64_t(settings::absoluteMaximumSeconds))));
    auto input=controlInputs();
    manual_trial::Policy preview;
    const uint64_t until=state.restFrom+uint64_t(state.data.config.cooldownSeconds)*1000;
    const uint64_t limit=agro::deadline(sent,expiry,server);
    const auto previous=relay.snapshot();
    auto decision=previous.active?manual_trial::Start::Busy:previous.latched?manual_trial::Start::Block:
      preview.start(input,relay.ready(),id,seconds,expiry,limit,until);
    if (decision!=manual_trial::Start::Applied) {
      record->ack=currentAck(id,startCode(decision),false); state.data.watermark=id;
      if (!state.save()) relay.stop(manual_trial::Stop::Block);
      return;
    }
    // One atomic blob: INTENCION, watermark and running identity before any LOW.
    record->phase=Phase::Intention; state.data.watermark=id; state.data.runningId=id;
    record->ack=currentAck(id,Code::Uncertain,false);
    if (!state.save()) { relay.stop(manual_trial::Stop::Block); return; }
    input=controlInputs(); // Sensor, API lease, clock and expiry checked again after slow NVS.
    decision=relay.start(input,id,seconds,expiry,limit,until,previous.generation);
    record->phase=Phase::Final;
    if (decision==manual_trial::Start::Applied) {
      record->ack=currentAck(id,requested>seconds?Code::Clipped:Code::None,true);
      record->ack.durationApplied=seconds;
    } else {
      state.data.runningId=0; record->ack=currentAck(id,startCode(decision),false);
    }
    if (!state.save()) { relay.stop(manual_trial::Stop::Block); return; }
    if (decision==manual_trial::Start::Applied) {
      cJSON* d=cJSON_CreateObject(); cJSON_AddStringToObject(d,"origen","MANUAL");
      cJSON_AddNumberToObject(d,"id_orden",double(id)); cJSON_AddNumberToObject(d,"duracion_programada_s",seconds);
      cJSON_AddNumberToObject(d,"humedad_pct",input.moisture); event("RIEGO_INICIADO",d);
      nextTelemetry_=0; nextEvents_=0;
    }
  }
  bool sendAck() {
    // Never advertise an actuation result that failed durable verification.
    // Telemetry still reports persistencia_ok=false; operator must stop the trial.
    if (!state.persistenceOk) { relay.stop(manual_trial::Stop::Block); return false; }
    Record* pending=transientPending_?&transientAck_:nullptr;
    if (!pending) for (auto& r:state.data.offAcks) if (r.id && !r.confirmed && !r.quarantined) { pending=&r; break; }
    if (!pending) for (auto& r:state.data.journal) if (r.id && r.phase==Phase::Final && !r.confirmed && !r.quarantined) { pending=&r; break; }
    if (!pending) return false;
    String response; String path="/iot/ordenes/"+String((unsigned long long)pending->id)+"/confirmacion";
    String payload=ackJson(pending->ack); if (!payload.length()) return true;
    const int code=net.request("POST",path,payload,response);
    if (code==200 || code==404 || code==409) {
      if (pending==&transientAck_) transientPending_=false;
      else { pending->confirmed=true; state.save(); }
    } else if (code==400 || code==422) {
      // Invalid ACK retained for inspection, but do not send the same invalid body again.
      Serial.printf("ACK rejected HTTP %d; retained locally\n",code);
      if (pending==&transientAck_) transientPending_=false;
      else { pending->quarantined=true; state.save(); }
    }
    return true;
  }
  void telemetry() {
    Sample batch[30]; const size_t count=samples.batch(batch);
    cJSON* root=cJSON_CreateObject(); envelope(root);
    cJSON_AddStringToObject(root,"version_firmware",settings::firmwareVersion);
    cJSON_AddStringToObject(root,"version_contrato",settings::contractVersion);
    cJSON_AddNumberToObject(root,"config_version",state.data.config.version);
    cJSON* security=cJSON_AddObjectToObject(root,"seguridad");
    cJSON_AddBoolToObject(security,"hardware_confirmado",relay.ready());
    cJSON_AddBoolToObject(security,"calibracion_confirmada",state.data.config.calibrated);
    cJSON_AddNumberToObject(security,"tope_riego_s",settings::absoluteMaximumSeconds);
    cJSON_AddNumberToObject(security,"max_id_orden_procesada",double(state.data.watermark));
    cJSON_AddBoolToObject(security,"reloj_confiable",net.trusted);
    cJSON_AddBoolToObject(security,"persistencia_ok",state.persistenceOk);
    cJSON_AddStringToObject(security,"tls_vigencia",net.tlsMode());
    cJSON* network=cJSON_AddObjectToObject(root,"red"); cJSON_AddNumberToObject(network,"rssi_dbm",WiFi.RSSI());
    cJSON* diagnostic=cJSON_AddObjectToObject(root,"diagnostico");
    cJSON_AddNumberToObject(diagnostic,"lecturas_descartadas",samples.dropped());
    cJSON_AddNumberToObject(diagnostic,"eventos_descartados",eventDropped_);
    cJSON_AddNumberToObject(diagnostic,"acks_apagado_descartados",state.data.offDropped);
    cJSON_AddNumberToObject(diagnostic,"errores_tls",net.tlsErrors);
    cJSON_AddNumberToObject(diagnostic,"errores_http",net.httpErrors);
    cJSON_AddBoolToObject(diagnostic,"solo_monitoreo",!relay.ready());
    // Free-form diagnostico is explicitly allowed by API 1.0.2; readings keep their exact schema.
    cJSON_AddStringToObject(diagnostic,"origen_datos","SENSOR_FISICO");
    cJSON_AddNumberToObject(diagnostic,"lecturas_recibidas_api",double(receivedReadings_));
    cJSON_AddNumberToObject(diagnostic,"lecturas_duplicadas_api",double(duplicateReadings_));
    cJSON_AddNumberToObject(diagnostic,"lecturas_rechazadas_api",double(rejectedReadings_));
    cJSON_AddNumberToObject(diagnostic,"recibos_invalidos",invalidReceipts_);
    const auto effective=samples.configuration();
    cJSON* calibration=cJSON_AddObjectToObject(diagnostic,"calibracion_efectiva");
    cJSON_AddNumberToObject(calibration,"raw_seco",effective.calibration.dry);
    cJSON_AddNumberToObject(calibration,"raw_humedo",effective.calibration.wet);
    cJSON_AddBoolToObject(calibration,"confirmada",effective.calibration.confirmed);
    cJSON_AddNumberToObject(calibration,"config_version",effective.version);
    cJSON_AddStringToObject(calibration,"fuente",calibrationSource(effective.source));
    const Sample latest=samples.latest();
    cJSON* last=cJSON_AddObjectToObject(diagnostic,"ultima_muestra");
    cJSON_AddNumberToObject(last,"seq",latest.seq);
    cJSON_AddNumberToObject(last,"valor_raw",latest.reading.raw);
    cJSON_AddBoolToObject(last,"valida",latest.reading.valid);
    cJSON_AddStringToObject(last,"causa",agro::readingReason(latest.reading.reason));
    cJSON_AddNumberToObject(last,"config_version",latest.configVersion);
    cJSON* readings=cJSON_AddArrayToObject(root,"lecturas");
    for (size_t i=0;i<count;++i) {
      cJSON* o=cJSON_CreateObject(); const Sample& s=batch[i];
      cJSON_AddNumberToObject(o,"seq",s.seq); cJSON_AddStringToObject(o,"sensor","HUM1");
      cJSON_AddStringToObject(o,"tipo","HUMEDAD_SUELO");
      cJSON_AddStringToObject(o,"estado",!s.calibrated?"SIN_CALIBRAR":s.reading.valid?"OK":"ERROR_SENSOR");
      if (s.reading.valid) cJSON_AddNumberToObject(o,"valor_pct",round(s.reading.percent*10)/10);
      else cJSON_AddNullToObject(o,"valor_pct");
      cJSON_AddNumberToObject(o,"valor_raw",s.reading.raw);
      timestamp(o,"ts",s.utc); cJSON_AddNumberToObject(o,"uptime_ms",double(s.uptime));
      cJSON_AddItemToArray(readings,o);
    }
    cJSON* actuators=cJSON_AddArrayToObject(root,"actuadores"); cJSON_AddItemToArray(actuators,actuator(currentAck(0,Code::None,false)));
    String payload=encoded(root); cJSON_Delete(root); if (!payload.length()) return;
    String response; const int code=net.request("POST","/iot/telemetria",payload,response);
    if (code==200) {
      cJSON* o=parse(response); cJSON* d=cJSON_GetObjectItemCaseSensitive(o,"data"); uint64_t v=0;
      if (number(d,"config_version",v) && v>state.data.config.version) nextConfig_=0;
      if (number(d,"ordenes_pendientes",v) && v) nextCommands_=0;
      uint64_t received=0,duplicate=0;
      cJSON* discarded=cJSON_GetObjectItemCaseSensitive(d,"descartadas");
      const size_t rejected=cJSON_IsArray(discarded)?size_t(cJSON_GetArraySize(discarded)):31;
      bool valid=number(d,"recibidas",received) && number(d,"duplicadas",duplicate) &&
                 agro::receiptCounts(count,received,duplicate,rejected);
      uint32_t sentSeq[30]={},rejectedSeq[30]={};
      for (size_t i=0;i<count;++i) sentSeq[i]=batch[i].seq;
      for (size_t i=0;valid && i<rejected;++i) {
        cJSON* entry=cJSON_GetArrayItem(discarded,i); uint64_t seq=0;
        const char* reason=string(entry,"codigo");
        valid=number(entry,"seq",seq) && seq<=UINT32_MAX && reason && *reason && strlen(reason)<=64;
        if (valid) { for (const char* c=reason;*c;++c) if (!(*c=='_' || (*c>='A'&&*c<='Z') || (*c>='0'&&*c<='9'))) valid=false; }
        if (valid) rejectedSeq[i]=uint32_t(seq);
      }
      valid=valid && agro::receiptDiscardSequences(sentSeq,count,rejectedSeq,rejected);
      if (valid) {
        if (count) samples.delivered(batch[count-1].seq);
        receivedReadings_+=received; duplicateReadings_+=duplicate; rejectedReadings_+=rejected;
        Serial.printf("telemetry receipt=%s boot=%s sent=%u received=%u duplicate=%u rejected=%u first_seq=%lu last_seq=%lu relay=UNTOUCHED\n",
          rejected?"PARTIAL":"CONFIRMED",state.boot,unsigned(count),unsigned(received),unsigned(duplicate),unsigned(rejected),
          (unsigned long)(count?batch[0].seq:0),(unsigned long)(count?batch[count-1].seq:0));
        for (size_t i=0;i<rejected;++i)
          Serial.printf("telemetry rejected_seq=%lu code=%s\n",(unsigned long)rejectedSeq[i],string(cJSON_GetArrayItem(discarded,i),"codigo"));
      } else {
        ++invalidReceipts_;
        Serial.println("telemetry receipt=INVALID; RAM batch retained; bounded buffer may overflow");
      }
      cJSON_Delete(o);
    } else if (code>0) Serial.printf("telemetry receipt=NOT_CONFIRMED HTTP=%d; RAM batch retained\n",code);
  }
  void envelope(cJSON* o) {
    cJSON_AddStringToObject(o,"id_arranque",state.boot);
    cJSON_AddNumberToObject(o,"uptime_ms",double(monoMs())); timestamp(o,"ts",utcMs());
  }
  void sendEvents() {
    cJSON* root=cJSON_CreateObject(); envelope(root);
    cJSON* array=cJSON_AddArrayToObject(root,"eventos"); unsigned count=eventCount_;
    for (unsigned i=0;i<count;++i) cJSON_AddItemToArray(array,parse(events_[(eventHead_+i)%20]));
    String payload=encoded(root); cJSON_Delete(root); if (!payload.length()) return;
    String response; int code=net.request("POST","/iot/eventos",payload,response);
    if (code==200 || code==400 || code==422) {
      for (unsigned i=0;i<count;++i) events_[(eventHead_+i)%20]=String();
      eventHead_=(eventHead_+count)%20; eventCount_-=count;
    }
  }
};
} // namespace monitor
