// Compile-time execution of production policy/migration. NEVER upload to a board.
#include "ManualSafety.h"
#include "MonitorState.h"
using namespace manual_trial;
constexpr Inputs good() {
  Inputs in; in.now=10000; in.utc=20000; in.lastApi=9900; in.sampled=9900;
  in.wifi=true; in.api=true; in.clock=true; in.manual=true; in.blocked=false;
  in.persistent=true; in.calibrated=true; in.valid=true; in.moisture=10; return in;
}
constexpr Start attempt(Inputs in,bool hardware=true,uint32_t seconds=5,uint64_t until=0,uint64_t expiry=30000,uint64_t monoExpiry=20000) {
  Policy p; return p.start(in,hardware,42,seconds,expiry,monoExpiry,until);
}
constexpr Inputs changed(unsigned field) {
  auto in=good();
  switch(field) {
    case 0:in.manual=false;break; case 1:in.blocked=true;break;
    case 2:in.persistent=false;break; case 3:in.calibrated=false;break;
    case 4:in.valid=false;break; case 5:in.sampled=7000;break;
    case 6:in.moisture=55;break; case 7:in.clock=false;break;
    case 8:in.wifi=false;break; case 9:in.api=false;break;
    case 10:in.lastApi=6000;break;
  }
  return in;
}
static_assert(!settings::hardwareConfirmed && !settings::manualBenchEnabled,"physical gates stay closed");
static_assert(!settings::relay3v3Compatible && !settings::relayBootOffVerified,"electrical/reset proof pending");
static_assert(!settings::enableAutomaticAtBoot && settings::absoluteMaximumSeconds==5,"no auto; five-second compiled ceiling");
static_assert(settings::relayPin==26 && settings::relayPolarity==settings::RelayPolarity::ActiveLow,"GPIO26 active LOW");
static_assert(attempt(good())==Start::Applied,"logical manual start");
static_assert(attempt(good(),false)==Start::Hardware,"unconfirmed hardware denies ON");
static_assert(attempt(changed(0))==Start::Mode,"disabled/automatic modes deny ON");
static_assert(attempt(changed(1))==Start::Block,"critical block denies ON");
static_assert(attempt(changed(2))==Start::Persistence,"storage failure denies ON");
static_assert(attempt(changed(3))==Start::Sensor,"uncalibrated sensor denies ON");
static_assert(attempt(changed(4))==Start::Sensor,"faulty sensor denies ON");
static_assert(attempt(changed(5))==Start::Sensor,"3000 ms stale equality denies ON");
static_assert(attempt(changed(6))==Start::Wet,"upper threshold denies ON");
static_assert(attempt(changed(7))==Start::Clock,"untrusted clock denies ON");
static_assert(attempt(changed(8))==Start::Network,"offline denies ON");
static_assert(attempt(changed(9))==Start::Network,"failed API denies ON");
static_assert(attempt(changed(10))==Start::Network,"4000 ms lease equality denies ON");
static_assert(attempt(good(),true,5,10001)==Start::Cooldown,"cooldown denies rapid ON");
static_assert(attempt(good(),true,6)==Start::Expired,"duration beyond compiled ceiling never starts");
static_assert(attempt(good(),true,0)==Start::Expired,"zero duration never starts");
static_assert(attempt(good(),true,5,0,20000)==Start::Expired,"expired UTC equality denies ON");
static_assert(attempt(good(),true,5,0,30000,10000)==Start::Expired,"expired monotonic equality denies ON");
constexpr bool stops(unsigned field,Stop reason) {
  Policy p; auto in=good();
  if (p.start(in,true,42,5,30000,20000,0)!=Start::Applied) return false;
  in=changed(field); return p.tick(in)==reason && !p.active();
}
static_assert(stops(0,Stop::Config),"mode change shuts down");
static_assert(stops(1,Stop::Block),"block shuts down");
static_assert(stops(2,Stop::Block),"storage failure shuts down");
static_assert(stops(3,Stop::Sensor),"loss of calibration shuts down");
static_assert(stops(4,Stop::Sensor),"sensor fault shuts down");
static_assert(stops(5,Stop::Sensor),"stale sensor shuts down");
static_assert(stops(6,Stop::Wet),"upper moisture threshold shuts down even in manual");
static_assert(stops(7,Stop::Clock),"clock loss shuts down");
static_assert(stops(8,Stop::Wifi),"WiFi loss shuts down");
static_assert(stops(9,Stop::Api),"API failure shuts down");
static_assert(stops(10,Stop::Api),"lease loss shuts down independent of network task");
constexpr bool timeout() {
  Policy p; auto in=good(); p.start(in,true,42,5,30000,20000,0);
  in.now=14949; in.utc=24949; in.sampled=in.now; in.lastApi=in.now;
  if (p.tick(in)!=Stop::None) return false;
  in.now=14950; return p.tick(in)==Stop::Duration && !p.active();
}
static_assert(timeout(),"conservative 4.95 s deadline for five-second request");
constexpr bool expiry(bool forward) {
  Policy p; auto in=good(); p.start(in,true,42,5,20100,10100,0);
  in.now=forward?10001:10100; in.utc=forward?20100:19000;
  return p.tick(in)==Stop::Expiry && !p.active();
}
static_assert(expiry(true),"forward UTC step cannot extend order");
static_assert(expiry(false),"backward UTC step cannot extend monotonic expiry");
constexpr bool busy() {
  Policy p; auto in=good(); p.start(in,true,42,5,30000,20000,0); const auto end=p.end();
  return p.start(in,true,43,5,30000,20000,0)==Start::Busy && p.id()==42 && p.end()==end;
}
static_assert(busy(),"another ON never extends a run");
constexpr bool off() { Policy p; auto in=good(); p.start(in,true,42,5,30000,20000,0); return p.off(Stop::Off)==Stop::Off && !p.active(); }
static_assert(off(),"OFF is immediate in policy, independent of clock/auth/ledger space");
constexpr bool reconnect() {
  Policy p; auto in=good(); p.start(in,true,42,5,30000,20000,0);
  in.wifi=false; p.tick(in); in=good();
  return !p.active() && p.tick(in)==Stop::None && p.start(in,true,43,5,30000,20000,0)==Start::Block;
}
static_assert(reconnect(),"recovery never resumes a faulted pump");
constexpr bool reboot() { Policy p; return !p.active() && !p.id(); }
static_assert(reboot(),"fresh controller boots OFF with no action");
constexpr monitor::LegacyPersistent oldState() {
  monitor::LegacyPersistent old; old.config.version=7; old.config.calibrated=false;
  old.config.maximumSeconds=15; old.watermark=99; old.offBarrier=88; old.blockCounter=7;
  old.block.id=7; old.block.cause=monitor::Cause::Sensor; old.offDropped=3;
  old.journal[0].id=99; old.journal[0].digest[31]=123; old.journal[0].ack.id=99;
  old.journal[0].ack.code=monitor::Code::Hardware; old.journal[0].quarantined=true;
  old.offAcks[7].id=88; old.offAcks[7].confirmed=true; return old;
}
constexpr auto migrated=monitor::migrateLegacy(oldState());
static_assert(migrated.schema==3 && migrated.runningId==0,"migration creates no actuation intent");
static_assert(migrated.watermark==99 && migrated.offBarrier==88,"migration preserves replay protection");
static_assert(migrated.block.id==7 && migrated.block.cause==monitor::Cause::Sensor && migrated.blockCounter==7,"migration preserves critical lock identity");
static_assert(migrated.config.version==7 && !migrated.config.calibrated && migrated.config.maximumSeconds==15,"migration preserves historical configuration without falsely arming");
static_assert(migrated.journal[0].id==99 && migrated.journal[0].digest[31]==123 && migrated.journal[0].quarantined,"migration preserves IDs, hashes and ACK quarantine");
static_assert(migrated.journal[0].phase==monitor::Phase::Final && migrated.journal[0].ack.code==monitor::Code::Hardware,"historical monitor rejection is FINAL");
static_assert(migrated.offAcks[7].id==88 && migrated.offAcks[7].confirmed && migrated.offDropped==3,"migration preserves OFF acknowledgments");
constexpr monitor::Persistent recovery(unsigned kind) {
  monitor::Persistent p;
  if (kind==0) p.runningId=42;
  if (kind==1) { p.journal[0].id=42; p.journal[0].phase=monitor::Phase::Intention; }
  if (kind==2) { p.journal[0].id=42; p.journal[0].ack.applied=true; p.journal[0].ack.pumpOn=true; }
  return p;
}
static_assert(monitor::requiresRecovery(recovery(0)),"persisted running identity blocks restart");
static_assert(monitor::requiresRecovery(recovery(1)),"unfinished intent blocks restart");
static_assert(!monitor::requiresRecovery(recovery(2)),"historical FINAL ON ACK alone is not a pending effect");
void setup() {}
void loop() {}
