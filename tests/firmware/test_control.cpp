#include "Control.h"
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
using namespace agro;
int checks = 0;
void check(bool condition, const char* message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}
Reading humidity(float p) { Reading r; r.valid = true; r.percent = p; return r; }
Config config() { Config c; c.cooldownMs = 1000; c.maximumMs = 2000; c.staleMs = 3000; return c; }
void event(Event e, uint32_t t) { std::cout << "event," << t << ',' << int(e) << '\n'; }
Controller ready(Mode mode = Mode::Automatic, uint32_t now = 0) {
  Controller c(config(), event); c.begin(now); c.setMode(mode, now); return c;
}
Command command(uint64_t id, Action action = Action::On) {
  Command c; c.id = id; c.action = action; c.authorized = true; return c;
}
int main() {
 try {
  Calibration cal; cal.confirmed = true;
  int dry[] = {2600,2601,2599,2600,2600}, wet[] = {1535,1536,1534,1535,1535};
  check(measure(dry,5,cal).valid && measure(dry,5,cal).percent == 0,"dry calibration");
  check(measure(wet,5,cal).percent == 100,"wet calibration");
  cal.confirmed = false; check(!measure(dry,5,cal).valid,"uncalibrated");
  cal.confirmed = true; cal.wet = cal.dry; check(!measure(dry,5,cal).valid,"zero span");
  cal.dry = 1535; cal.wet = 2600; check(measure(dry,5,cal).percent == 100,"reversed sensor");
  int bad[] = {0,2000,2000,2000,2000}; check(!measure(bad,5,cal).valid,"rail");
  int noisy[] = {1400,2000,2100,2200,2800}; check(!measure(noisy,5,cal).valid,"noise");
  auto c = ready(); check(!c.pump(),"safe boot");
  c.sample(humidity(10),0); c.tick(999); check(!c.pump(),"boot cooldown");
  c.tick(1000); check(c.pump(),"low starts");
  c.sample(humidity(40),1100); c.tick(1100); check(c.pump(),"hysteresis holds");
  c.sample(humidity(55),1200); c.tick(1200); check(!c.pump(),"upper stops");
  c.sample(humidity(10),1300); c.tick(1300); check(!c.pump(),"rapid cycle blocked");
  c.tick(2200); check(c.pump(),"cooldown completes");
  c.sample(humidity(10),4100); c.tick(4200); check(!c.pump() && c.locked(),"timeout locks");
  c.tick(4300); check(!c.pump(),"timeout cannot restart");
  c = ready(); c.sample(humidity(10),1000); c.tick(1000);
  c.sample(Reading(),1100); check(!c.pump() && c.locked(),"fault immediate off");
  c.sample(humidity(10),1200); c.tick(1200); check(!c.pump(),"fault latches");
  check(c.clearFault(1200) && c.mode() == Mode::Disabled,"explicit recovery disabled");
  c = ready(); c.sample(humidity(10),1000); c.tick(1000); c.tick(4000);
  check(c.locked() && !c.pump(),"stale stops");
  c = ready(); c.sample(humidity(std::numeric_limits<float>::quiet_NaN()),1000);
  check(c.locked(),"NaN invalid");
  c = ready(Mode::Manual); c.sample(humidity(10),1000);
  auto on = command(1); check(c.command(on,1000,0) == Result::Applied && c.pump(),"manual on");
  check(c.command(on,1100,0) == Result::Duplicate,"duplicate");
  c.sample(humidity(10),2900); c.tick(3000);
  check(!c.pump() && c.locked(),"manual maximum timeout");
  c = ready(Mode::Manual); c.sample(humidity(10),1000);
  check(c.command(on,1000,0) == Result::Applied,"manual restart new instance");
  check(c.command(command(2,Action::Off),1200,0) == Result::Applied && !c.pump(),"manual off");
  c.tick(2200); check(!c.pump(),"off disables automatic");
  auto denied = command(3); denied.authorized = false;
  check(c.command(denied,2200,0) == Result::Unauthorized,"authorization");
  auto expiry = command(4); expiry.expiresUnix = 100;
  check(c.command(expiry,2200,0) == Result::ClockUnknown,"unknown clock");
  check(c.command(expiry,2200,100) == Result::Expired,"expiry equality");
  c = ready(); c.sample(humidity(10),1000);
  check(c.command(command(1),1000,0) == Result::WrongMode,"manual requires manual mode");
  c.setMode(Mode::Manual,1000);
  check(c.command(command(1),1000,0) == Result::Duplicate,"rejected command cannot later activate");
  c.setMode(Mode::Automatic,1000);
  ReconnectSchedule wifi;
  check(wifi.due(0,false) && !wifi.due(9999,false) && wifi.due(10000,false),"wifi retry bounded");
  c.tick(1000); check(c.pump(),"offline automatic");
  check(!wifi.due(10001,true),"wifi connected");
  c.sample(humidity(60),1100); c.tick(1100); check(!c.pump(),"offline upper stops");
  wifi.due(1101,false); wifi.due(1102,true); c.tick(1102);
  check(!c.pump(),"reconnect no activation");
  c = ready(Mode::Automatic,0xffffff00UL); c.sample(humidity(10),744); c.tick(744);
  check(c.pump(),"millis wrap cooldown");
  c.sample(humidity(10),2744); c.tick(2744); check(c.locked(),"millis wrap timeout");
  check(!relayLevel(false,true) && relayLevel(false,false),"safe relay polarities");
  check(relayLevel(true,true) && !relayLevel(true,false),"on relay polarities");
  Config invalid = config(); invalid.stop = invalid.start;
  Controller broken(invalid); broken.begin(0); check(broken.locked(),"invalid config lock");
  c = ready(Mode::Manual); c.sample(humidity(10),1000);
  for (uint64_t i=1;i<=64;++i) c.command(command(i,Action::Off),1000,0);
  c.setMode(Mode::Manual,1000);
  check(c.command(command(65),2000,0)==Result::Capacity,"ledger fail closed");
  check(c.command(command(66,Action::Off),2000,0)==Result::Applied,"off at capacity");
  c.criticalFault(2000); check(c.locked() && !c.pump(),"critical fault");
  std::cout << "PASS " << checks << " assertions; simulation only\n";
  return 0;
 } catch (const std::exception& e) { std::cerr << "FAIL: " << e.what() << '\n'; return 1; }
}
