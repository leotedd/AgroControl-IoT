#pragma once
#include <stdint.h>
#include <math.h>
#include "Protocol.h"

namespace manual_trial {
constexpr uint32_t MaximumMs=5000, ApiLeaseMs=4000, GuardMarginMs=50;
enum class Stop { None, Off, Duration, Expiry, Wifi, Api, Clock, Sensor, Block, Config, Backup, Wet };
enum class Start { Applied, Hardware, Mode, Block, Sensor, Wet, Cooldown, Busy, Clock, Expired, Network, Persistence };
struct Inputs {
  uint64_t now=0,utc=0,lastApi=0,sampled=0;
  bool wifi=false,api=false,clock=false,manual=false,blocked=true,persistent=false,calibrated=false,valid=false;
  float moisture=0,upper=55;
};
class Policy {
 public:
  constexpr Start start(const Inputs& in,bool hardware,uint64_t id,uint32_t seconds,uint64_t expiry,uint64_t monoExpiry,uint64_t cooldownUntil) {
    if (!hardware) return Start::Hardware;
    if (!in.manual) return Start::Mode;
    if (in.blocked || latched_) return Start::Block;
    if (!in.persistent) return Start::Persistence;
    if (!sensor(in)) return Start::Sensor;
    if (in.moisture>=in.upper) return Start::Wet;
    if (active_) return Start::Busy;
    if (in.now<cooldownUntil) return Start::Cooldown;
    if (!in.clock) return Start::Clock;
    if (!agro::liveOrder(in.clock,in.utc,in.now,expiry,monoExpiry) || !seconds || seconds>5 || !id) return Start::Expired;
    if (!network(in)) return Start::Network;
    active_=true; id_=id; started_=in.now; seconds_=seconds;
    startingMoisture_=in.moisture;
    // Conservative 50 ms scheduling margin; no extension by another command/config.
    end_=in.now+uint64_t(seconds)*1000-GuardMarginMs;
    expiry_=expiry; monoExpiry_=monoExpiry; reason_=Stop::None;
    return Start::Applied;
  }
  constexpr Stop tick(const Inputs& in) {
    if (!active_) return Stop::None;
    if (!in.wifi) return off(Stop::Wifi);
    if (!network(in)) return off(Stop::Api);
    if (!in.clock) return off(Stop::Clock);
    if (!in.persistent || in.blocked) return off(Stop::Block);
    if (!in.manual) return off(Stop::Config);
    if (!sensor(in)) return off(Stop::Sensor);
    if (in.utc>=expiry_ || in.now>=monoExpiry_) return off(Stop::Expiry);
    if (in.now>=end_) return off(Stop::Duration);
    if (in.moisture>=in.upper) return off(Stop::Wet);
    return Stop::None;
  }
  constexpr Stop off(Stop why) {
    if (!active_) return Stop::None;
    active_=false; reason_=why;
    if (why==Stop::Wifi || why==Stop::Api || why==Stop::Clock || why==Stop::Sensor || why==Stop::Block || why==Stop::Backup) latched_=true;
    return why;
  }
  constexpr bool active() const { return active_; }
  constexpr bool latched() const { return latched_; }
  constexpr uint64_t id() const { return id_; }
  constexpr uint64_t started() const { return started_; }
  constexpr uint32_t seconds() const { return seconds_; }
  constexpr uint64_t end() const { return end_; }
  constexpr float startingMoisture() const { return startingMoisture_; }
  static constexpr bool sensor(const Inputs& in) {
    return in.calibrated && in.valid && in.sampled && in.now>=in.sampled && in.now-in.sampled<3000 &&
      isfinite(in.moisture) && in.moisture>=0 && in.moisture<=100;
  }
  static constexpr bool network(const Inputs& in) {
    return in.wifi && in.api && in.lastApi && in.now>=in.lastApi && in.now-in.lastApi<ApiLeaseMs;
  }
 private:
  bool active_=false,latched_=false;
  uint64_t id_=0,started_=0,end_=0,expiry_=0,monoExpiry_=0;
  uint32_t seconds_=0;
  float startingMoisture_=0;
  Stop reason_=Stop::None;
};
} // namespace manual_trial
