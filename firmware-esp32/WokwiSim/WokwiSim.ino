// SIMULATION ONLY. No relay GPIO, network, API or NVS operations.
// The legacy controller demonstrates irrigation logic, NOT full API 1.0.2 compliance.
#include <Arduino.h>
#include "Control.h"

agro::Config simulationConfig() {
  agro::Config c; c.maximumMs=5000; c.cooldownMs=3000; c.staleMs=1500; return c;
}
agro::Controller controller(simulationConfig());
bool wifiSim=true,apiSim=true,sensorFault=false,pauseSamples=false;
uint64_t nextId=1;
int windowAdc[5]; unsigned windowCount=0;
uint32_t lastSample=0,lastReport=0;
agro::Reading reading;

void help() {
  Serial.println("SIMULATION ONLY; GPIO26 untouched; relay level is VIRTUAL.");
  Serial.println("a=AUTO m=MANUAL d=DISABLED o=ON x=OFF c=clear fault");
  Serial.println("f=toggle sensor fault p=toggle stale sensor w=toggle WiFi b=toggle API r=restart model h=help");
}
void resetModel() {
  controller=agro::Controller(simulationConfig()); controller.begin(millis());
  wifiSim=true; apiSim=true; sensorFault=false; pauseSamples=false;
  windowCount=0; reading=agro::Reading(); lastSample=millis();
  // nextId deliberately stays increasing; this simulator has NO durable journal.
  Serial.println("MODEL_BOOT: DISABLED, virtual pump OFF. No NVS recovery test.");
}
void setup() {
  Serial.begin(115200); analogReadResolution(12);
  analogSetPinAttenuation(34,ADC_11db); pinMode(34,INPUT);
  resetModel(); help();
}
void loop() {
  const uint32_t now=millis();
  while (Serial.available()) {
    const char c=Serial.read();
    if (c=='a') controller.setMode(agro::Mode::Automatic,now);
    else if (c=='m') controller.setMode(agro::Mode::Manual,now);
    else if (c=='d') controller.setMode(agro::Mode::Disabled,now);
    else if (c=='o' || c=='x') {
      agro::Command command; command.id=nextId++; command.authorized=true;
      command.action=c=='o'?agro::Action::On:agro::Action::Off;
      // OFF is available offline in this local model. ON needs simulated API.
      if (c=='o' && (!wifiSim || !apiSim)) Serial.println("SIM_ON_REJECTED: no simulated API");
      else Serial.printf("SIM_COMMAND_RESULT=%u\n",unsigned(controller.command(command,now,0)));
    } else if (c=='f') sensorFault=!sensorFault;
    else if (c=='p') pauseSamples=!pauseSamples;
    else if (c=='w') wifiSim=!wifiSim;
    else if (c=='b') apiSim=!apiSim;
    else if (c=='c') Serial.printf("SIM_REARM=%d; remains disabled\n",controller.clearFault(now));
    else if (c=='r') resetModel();
    else if (c=='h') help();
  }
  if (!pauseSamples && agro::elapsed(now,lastSample)>=100) {
    lastSample=now; windowAdc[windowCount++]=sensorFault?0:analogRead(34);
    if (windowCount==5) {
      windowCount=0; agro::Calibration cal; cal.confirmed=true;
      reading=agro::measure(windowAdc,5,cal); controller.sample(reading,now);
    }
  }
  controller.tick(now);
  if (agro::elapsed(now,lastReport)>=500) {
    lastReport=now;
    char percent[16];
    if (reading.valid) snprintf(percent,sizeof(percent),"%.1f",reading.percent);
    else snprintf(percent,sizeof(percent),"N/A");
    Serial.printf("SIM adc=%d pct=%s valid=%d reason=%s mode=%u locked=%d wifi=%d api=%d virtual_pump=%d virtual_IN=%s GPIO26=UNTOUCHED\n",
      reading.raw,percent,reading.valid,agro::readingReason(reading.reason),unsigned(controller.mode()),controller.locked(),wifiSim,apiSim,
      controller.pump(),agro::relayLevel(controller.pump(),false)?"HIGH":"LOW");
  }
  delay(1);
}
