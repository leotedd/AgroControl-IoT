#pragma once
#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_timer.h>
#include "Settings.h"
#include "ManualSafety.h"

namespace manual_trial {
struct Snapshot {
  bool active=false,latched=false;
  uint64_t id=0,started=0,stopped=0,end=0;
  uint32_t seconds=0,generation=0;
  Stop pending=Stop::None;
  float startingMoisture=0;
};
class Relay {
 public:
  static constexpr int offLevel() { return settings::relayDriveActiveLow?1:0; }
  static constexpr int onLevel() { return settings::relayDriveActiveLow?0:1; }
  static constexpr bool enabled() {
    return settings::hardwareConfirmed && settings::manualBenchEnabled &&
           settings::relay3v3Compatible && settings::relayBootOffVerified;
  }
  void begin() {
    if constexpr (enabled() || settings::relayOffOnlyAtBoot) {
      // Preload OFF before enabling output. Does NOT cover bootloader/reset high impedance.
      if (gpio_set_level(GPIO_NUM_26,offLevel())!=ESP_OK) return;
      if (gpio_set_direction(GPIO_NUM_26,GPIO_MODE_OUTPUT)!=ESP_OK) return;
      outputReady_=true;
    }
    if constexpr (enabled()) {
      if (!outputReady_) return;
      esp_timer_create_args_t args={}; args.callback=timerCallback; args.arg=this; args.name="pump-backup";
      ready_=esp_timer_create(&args,&timer_)==ESP_OK;
    }
  }
  bool ready() const { return enabled() && ready_; }
  const char* status() {
    if constexpr (!enabled() && !settings::relayOffOnlyAtBoot) return "UNTOUCHED";
    if (!outputReady_ || (enabled() && !ready_)) return "DRIVER_FAULT";
    return !enabled()?"OFF_ONLY":snapshot().active?"ON":"OFF";
  }
  Snapshot snapshot() {
    portENTER_CRITICAL(&mux_); Snapshot s;
    s.active=policy_.active(); s.latched=policy_.latched(); s.id=policy_.id(); s.started=policy_.started();
    s.end=policy_.end(); s.seconds=policy_.seconds(); s.pending=pending_; s.stopped=stopped_; s.generation=generation_;
    s.startingMoisture=policy_.startingMoisture();
    portEXIT_CRITICAL(&mux_); return s;
  }
  Start start(const Inputs& input,uint64_t id,uint32_t seconds,uint64_t expiry,uint64_t monoExpiry,uint64_t cooldown,uint32_t ticket) {
    if constexpr (!enabled()) return Start::Hardware;
    if (!ready_ || seconds>5) return Start::Hardware;
    const auto previous=snapshot();
    if (previous.active) return Start::Busy;
    if (previous.latched || previous.pending!=Stop::None) return Start::Block;
    // Timer APIs outside GPIO critical section; arm before ON so timer failure cannot start.
    esp_timer_stop(timer_);
    if (esp_timer_start_once(timer_,MaximumMs*1000ULL)!=ESP_OK) return Start::Hardware;
    portENTER_CRITICAL(&mux_);
    Start result=Start::Block;
    if (ticket==generation_ && pending_==Stop::None) {
      result=policy_.start(input,true,id,seconds,expiry,monoExpiry,cooldown);
      if (result==Start::Applied) {
        if (gpio_set_level(GPIO_NUM_26,onLevel())!=ESP_OK) {
          policy_.off(Stop::Block); stoppedLocked(Stop::Block,input.now); result=Start::Hardware;
        }
      }
    }
    portEXIT_CRITICAL(&mux_);
    if (result!=Start::Applied) esp_timer_stop(timer_);
    return result;
  }
  void tick(const Inputs& input) {
    portENTER_CRITICAL(&mux_);
    const Stop reason=policy_.tick(input);
    if (reason!=Stop::None) stoppedLocked(reason,input.now);
    portEXIT_CRITICAL(&mux_);
  }
  void stop(Stop reason) {
    const uint64_t now=uint64_t(esp_timer_get_time())/1000;
    portENTER_CRITICAL(&mux_); ++generation_;
    if (policy_.off(reason)!=Stop::None) stoppedLocked(reason,now);
    portEXIT_CRITICAL(&mux_);
  }
  void acknowledgedStop(uint64_t id) {
    portENTER_CRITICAL(&mux_); if (!policy_.active() && policy_.id()==id) pending_=Stop::None; portEXIT_CRITICAL(&mux_);
  }
 private:
  portMUX_TYPE mux_=portMUX_INITIALIZER_UNLOCKED;
  Policy policy_;
  esp_timer_handle_t timer_=nullptr;
  bool ready_=false;
  bool outputReady_=false;
  uint32_t generation_=0;
  Stop pending_=Stop::None;
  uint64_t stopped_=0;
  static void timerCallback(void* arg) { static_cast<Relay*>(arg)->stop(Stop::Backup); }
  void stoppedLocked(Stop reason,uint64_t now) {
    if constexpr (enabled() || settings::relayOffOnlyAtBoot) {
      if (outputReady_) gpio_set_level(GPIO_NUM_26,offLevel());
    }
    ++generation_; pending_=reason; stopped_=now;
  }
};
} // namespace manual_trial
