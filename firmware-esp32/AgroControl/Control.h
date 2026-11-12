#pragma once
#include <stdint.h>
#include <stddef.h>
#include <math.h>

namespace agro {
inline constexpr uint32_t elapsed(uint32_t now, uint32_t then) { return now - then; }
struct Calibration {
  int dry = 2600, wet = 1535;
  bool confirmed = false;
  constexpr bool valid() const {
    return confirmed && dry > 20 && dry < 4075 && wet > 20 && wet < 4075 &&
           (dry > wet ? dry - wet : wet - dry) >= 200;
  }
};
enum class ReadingReason { None, NoSamples, SampleCount, Rail, NotCalibrated, InvalidCalibration, Noise, OutsideCalibration };
inline constexpr const char* readingReason(ReadingReason reason) {
  switch (reason) {
    case ReadingReason::None:return "OK";
    case ReadingReason::NoSamples:return "SIN_MUESTRAS";
    case ReadingReason::SampleCount:return "VENTANA_INCOMPLETA";
    case ReadingReason::Rail:return "ADC_EN_RIEL";
    case ReadingReason::NotCalibrated:return "SIN_CALIBRAR";
    case ReadingReason::InvalidCalibration:return "CALIBRACION_INVALIDA";
    case ReadingReason::Noise:return "DISPERSION_EXCESIVA";
    case ReadingReason::OutsideCalibration:return "FUERA_RANGO_CALIBRADO";
  }
  return "DESCONOCIDO";
}
struct Reading { bool valid = false; float percent = 0; int raw = 0; ReadingReason reason=ReadingReason::NoSamples; };
// Five-sample median; reject rails and excessive dispersion even if median looks valid.
inline constexpr Reading measure(const int* samples, size_t count, const Calibration& c) {
  Reading r;
  if (!samples || count != 5) { r.reason=ReadingReason::SampleCount; return r; }
  int sorted[5]={};
  bool rail=false;
  for (size_t i = 0; i < 5; ++i) {
    if (samples[i] <= 20 || samples[i] >= 4075) rail=true;
    sorted[i] = samples[i];
  }
  for (int i = 1; i < 5; ++i) {
    int v = sorted[i], j = i - 1;
    while (j >= 0 && sorted[j] > v) { sorted[j + 1] = sorted[j]; --j; }
    sorted[j + 1] = v;
  }
  r.raw = sorted[2];
  if (rail) { r.reason=ReadingReason::Rail; return r; }
  if (!c.confirmed) { r.reason=ReadingReason::NotCalibrated; return r; }
  if (!c.valid()) { r.reason=ReadingReason::InvalidCalibration; return r; }
  if (sorted[4] - sorted[0] > 500) { r.reason=ReadingReason::Noise; return r; }
  const int lo = c.dry < c.wet ? c.dry : c.wet;
  const int hi = c.dry > c.wet ? c.dry : c.wet;
  if (r.raw < lo - 200 || r.raw > hi + 200) { r.reason=ReadingReason::OutsideCalibration; return r; }
  r.percent = 100.0f * (r.raw - c.dry) / (c.wet - c.dry);
  if (r.percent < 0) r.percent = 0;
  if (r.percent > 100) r.percent = 100;
  r.valid = true; r.reason=ReadingReason::None;
  return r;
}
struct Config {
  float start = 30, stop = 55;
  uint32_t maximumMs = 15000, cooldownMs = 60000, staleMs = 3000;
  constexpr bool valid() const {
    return isfinite(start) && isfinite(stop) && start >= 0 && stop <= 100 &&
           start < stop && maximumMs > 0 && maximumMs <= 600000 &&
           cooldownMs >= 1000 && cooldownMs < 0x80000000UL &&
           staleMs > 0 && staleMs <= 60000;
  }
};
enum class Mode { Disabled, Automatic, Manual };
enum class Event { Boot, Started, Wet, Timeout, SensorFault, StaleSensor,
                   ManualOff, Disabled, CriticalFault, ModeChanged };
enum class Action { On, Off };
enum class Result { Applied, Duplicate, Unauthorized, Expired, ClockUnknown,
                    InvalidId, Unsafe, WrongMode, Capacity };
struct Command {
  uint64_t id = 0;
  Action action = Action::Off;
  bool authorized = false;
  uint64_t expiresUnix = 0;
};
typedef void (*EventSink)(Event, uint32_t);
class Controller {
 public:
  explicit constexpr Controller(Config c = Config(), EventSink sink = nullptr)
      : config_(c), sink_(sink) {}
  constexpr void begin(uint32_t now) {
    pump_ = false; mode_ = Mode::Disabled; locked_ = !config_.valid();
    hasReading_ = false; reading_ = Reading(); lastStop_ = now;
    emit(Event::Boot, now);
  }
  constexpr bool setMode(Mode m, uint32_t now) {
    if (locked_ && m != Mode::Disabled) return false;
    off(Event::ModeChanged, now); mode_ = m; return true;
  }
  constexpr void sample(Reading r, uint32_t now) {
    r.valid = r.valid && isfinite(r.percent) && r.percent >= 0 && r.percent <= 100;
    reading_ = r; lastReading_ = now; hasReading_ = true;
    if (!r.valid) fault(Event::SensorFault, now);
  }
  constexpr void criticalFault(uint32_t now) { fault(Event::CriticalFault, now); }
  // Recovery is explicit and only possible with a fresh, valid sensor.
  constexpr bool clearFault(uint32_t now) {
    if (!config_.valid() || !fresh(now) || pump_) return false;
    locked_ = false; mode_ = Mode::Disabled; lastStop_ = now; return true;
  }
  constexpr void tick(uint32_t now) {
    if (!hasReading_ || !fresh(now)) {
      if (pump_ || (hasReading_ && !locked_)) fault(Event::StaleSensor, now);
      return;
    }
    if (locked_ || mode_ == Mode::Disabled) { off(Event::Disabled, now); return; }
    if (pump_ && elapsed(now, started_) >= config_.maximumMs) {
      fault(Event::Timeout, now); return;
    }
    if (pump_ && reading_.percent >= config_.stop) { off(Event::Wet, now); return; }
    if (mode_ == Mode::Automatic && !pump_ && reading_.percent < config_.start)
      start(now);
  }
  constexpr Result command(const Command& cmd, uint32_t now, uint64_t unixNow) {
    if (!cmd.authorized) return Result::Unauthorized;
    if (!cmd.id) return Result::InvalidId;
    for (size_t i = 0; i < used_; ++i) if (seen_[i] == cmd.id) return Result::Duplicate;
    if (cmd.expiresUnix && !unixNow) return Result::ClockUnknown;
    if (cmd.expiresUnix && unixNow >= cmd.expiresUnix) return Result::Expired;
    // OFF remains available even after the ON replay ledger fills.
    if (used_ == 64 && cmd.action == Action::On) return Result::Capacity;
    if (used_ < 64) seen_[used_++] = cmd.id;
    if (cmd.action == Action::Off) {
      off(Event::ManualOff, now); mode_ = Mode::Disabled; return Result::Applied;
    }
    if (mode_ != Mode::Manual) return Result::WrongMode;
    tick(now);
    if (pump_ || locked_ || !fresh(now) || reading_.percent >= config_.stop)
      return Result::Unsafe;
    return start(now) ? Result::Applied : Result::Unsafe;
  }
  constexpr bool pump() const { return pump_; }
  constexpr bool locked() const { return locked_; }
  constexpr Mode mode() const { return mode_; }
 private:
  constexpr bool fresh(uint32_t now) const {
    return hasReading_ && reading_.valid && elapsed(now, lastReading_) < config_.staleMs;
  }
  constexpr bool start(uint32_t now) {
    if (locked_ || !fresh(now) || elapsed(now, lastStop_) < config_.cooldownMs) return false;
    pump_ = true; started_ = now; emit(Event::Started, now); return true;
  }
  constexpr void emit(Event e, uint32_t now) { if (sink_) sink_(e, now); }
  constexpr void off(Event e, uint32_t now) {
    if (pump_) { pump_ = false; lastStop_ = now; emit(e, now); }
  }
  constexpr void fault(Event e, uint32_t now) {
    const bool wasOn = pump_;
    off(e, now); if (!locked_ && !wasOn) emit(e, now);
    locked_ = true; mode_ = Mode::Disabled;
  }
  Config config_; EventSink sink_;
  Reading reading_;
  bool pump_ = false, locked_ = false, hasReading_ = false;
  Mode mode_ = Mode::Disabled;
  uint32_t lastReading_ = 0, started_ = 0, lastStop_ = 0;
  uint64_t seen_[64] = {}; size_t used_ = 0;
};
// Hardware-independent logical polarity. Power-up electrical bias still required.
inline bool relayLevel(bool pump, bool activeHigh) { return pump == activeHigh; }
class ReconnectSchedule {
 public:
  constexpr bool due(uint32_t now, bool connected) {
    if (connected) { attempted_ = false; interval_ = 10000; return false; }
    if (!attempted_) { attempted_ = true; last_ = now; return true; }
    if (elapsed(now, last_) >= interval_) {
      last_ = now;
      interval_ = interval_ >= 30000 ? 60000 : interval_ * 2;
      return true;
    }
    return false;
  }
 private:
  bool attempted_ = false; uint32_t last_ = 0, interval_ = 10000;
};
} // namespace agro
