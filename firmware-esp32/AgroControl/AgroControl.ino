#include <Arduino.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <esp_sntp.h>
#include "MonitorRuntime.h"

// Manual driver is compiled but all physical gates default false: GPIO26 stays untouched.
monitor::Runtime runtime;
void onTimeSync(struct timeval*) { runtime.net.synced(); runtime.clockChanged(); }
void networkTask(void*) {
  runtime.begin();
  sntp_set_time_sync_notification_cb(onTimeSync);
  configTime(0,0,"pool.ntp.org","time.google.com","time.cloudflare.com");
  sntp_set_sync_interval(3600000);
  while (true) { runtime.cycle(); vTaskDelay(pdMS_TO_TICKS(20)); }
}
void setup() {
  runtime.relay.begin(); // Verified profile only: preload interface-specific OFF before output/Serial/Wi-Fi.
  WiFi.onEvent([](WiFiEvent_t event) {
    if (event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED || event==ARDUINO_EVENT_WIFI_STA_LOST_IP)
      runtime.networkLost();
  });
  Serial.setTxBufferSize(512);
  Serial.begin(115200);
  if (settings::sensorConfirmed) {
    analogReadResolution(12);
    analogSetPinAttenuation(settings::sensorPin,ADC_11db);
    pinMode(settings::sensorPin,INPUT);
  }
  // Initialize sampling before networking starts. ADC sampling remains independent.
  monitor::Config initial; runtime.samples.configure(initial);
  if (xTaskCreatePinnedToCore(networkTask,"agro-network",24576,nullptr,1,nullptr,0)!=pdPASS)
    Serial.println("NETWORK_TASK_ALLOCATION_FAILED; manual ON unavailable; local sensor still active");
}
void loop() {
  runtime.controlCycle(); // Independent of blocking HTTPS/NVS work on the network task.
  static int raw[5]; static unsigned count=0;
  static uint64_t lastRead=0,lastLog=0;
  const uint64_t now=monitor::monoMs();
  if (settings::sensorConfirmed && now-lastRead>=settings::samplePeriodMs/5) {
    lastRead=now; raw[count++]=analogRead(settings::sensorPin);
    if (count==5) {
      count=0;
      const auto effective=runtime.samples.configuration();
      const agro::Calibration c=effective.calibration;
      monitor::Sample s; s.reading=agro::measure(raw,5,c); s.uptime=now;
      s.utc=runtime.timeReady?monitor::utcMs():0; s.calibrated=c.confirmed;
      s.configVersion=effective.version;
      runtime.samples.add(s);
      if (now-lastLog>=settings::reportPeriodMs && Serial.availableForWrite()>=320) {
        lastLog=now;
        char percent[16];
        if (s.reading.valid) snprintf(percent,sizeof(percent),"%.1f",s.reading.percent);
        else snprintf(percent,sizeof(percent),"N/A");
        Serial.printf("adc_median=%d moisture_estimated_pct=%s valid=%d calibrated=%d reason=%s dry=%d wet=%d calibration_source=%s config_version=%lu relay=%s\n",
          s.reading.raw,percent,s.reading.valid,s.calibrated,agro::readingReason(s.reading.reason),
          c.dry,c.wet,monitor::calibrationSource(effective.source),(unsigned long)effective.version,runtime.relay.status());
      }
    }
  }
  delay(1);
}
