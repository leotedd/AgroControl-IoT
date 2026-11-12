#include "../../../firmware-esp32/AgroControl/Protocol.h"
#include "../../../firmware-esp32/AgroControl/Control.h"
#include "../../../firmware-esp32/AgroControl/Settings.h"

constexpr uint64_t epoch(const char* s) { uint64_t value=0; return agro::parseUtc(s,value)?value:0; }
constexpr bool integer(double n,bool positive=false) { uint64_t value=0; return agro::safeInteger(n,value,positive); }
constexpr agro::Calibration calibration() { agro::Calibration c; c.dry=2600; c.wet=1535; c.confirmed=true; return c; }
constexpr int dry[]={2600,2601,2599,2600,2600};
constexpr int wet[]={1535,1536,1534,1535,1535};
constexpr int noisy[]={1535,2000,2100,2200,2600};
constexpr int rail[]={0,2600,2600,2600,2600};
constexpr int middle[]={2068,2068,2068,2068,2068};
constexpr int outside[]={1000,1000,1000,1000,1000};
static_assert(agro::measure(dry,5,calibration()).valid,"dry valid");
static_assert(agro::measure(dry,5,calibration()).percent==0,"measured dry is 0 percent");
static_assert(agro::measure(wet,5,calibration()).percent==100,"measured wet is 100 percent");
static_assert(!agro::measure(noisy,5,calibration()).valid,"dispersion rejected");
static_assert(!agro::measure(rail,5,calibration()).valid,"rails rejected");
static_assert(agro::measure(rail,5,calibration()).raw==2600,"median preserved on rail fault");
static_assert(!agro::measure(wet,4,calibration()).valid,"window size enforced");
static_assert(agro::measure(middle,5,calibration()).percent>49.9f &&
              agro::measure(middle,5,calibration()).percent<50.0f,"calibration midpoint");
static_assert(!agro::measure(outside,5,calibration()).valid,"outside calibration margin");
static_assert(epoch("2026-01-01T00:00:00Z")==1767225600000ULL,"UTC epoch");
static_assert(epoch("2026-01-01T00:00:00.1Z")==1767225600100ULL,"fraction .1");
static_assert(epoch("2026-01-01T00:00:00.12Z")==1767225600120ULL,"fraction .12");
static_assert(epoch("2026-01-01T00:00:00.123Z")==1767225600123ULL,"fraction .123");
static_assert(epoch("2026-02-29T00:00:00Z")==0,"non-leap date rejected");
static_assert(epoch("2028-02-29T00:00:00Z")>0,"leap date accepted");
static_assert(epoch("2026-01-01T00:00:00+00:00")==0,"UTC Z required");
static_assert(integer(9007199254740991.0,true),"maximum exact ID");
static_assert(!integer(9007199254740992.0,true),"oversized ID rejected");
static_assert(!integer(0,true) && !integer(-1,true) && !integer(1.5,true),"invalid IDs");
static_assert(agro::deadline(1000,20000,15000)==6000,"request-send conservative deadline");
static_assert(!agro::liveOrder(true,20000,5000,20000,6000),"expiry equality rejected");
static_assert(!agro::liveOrder(true,10000,6000,20000,6000),"monotonic equality rejected");
static_assert(!agro::liveOrder(false,10000,5000,20000,6000),"untrusted clock rejected");
static_assert(agro::liveOrder(true,10000,5000,20000,6000),"live order accepted");
static_assert(!settings::hardwareConfirmed && !settings::enableAutomaticAtBoot,"pump gates closed");
static_assert(settings::dryAdc==2600 && settings::wetAdc==1535,"measured settings");
constexpr bool reconnectSequence() {
  agro::ReconnectSchedule s;
  return s.due(0,false) && !s.due(9999,false) && s.due(10000,false) &&
    !s.due(29999,false) && s.due(30000,false) && !s.due(69999,false) &&
    s.due(70000,false) && !s.due(129999,false) && s.due(130000,false) &&
    !s.due(130001,true) && s.due(130002,false) && !s.due(140001,false) && s.due(140002,false);
}
constexpr bool reconnectWrap() {
  agro::ReconnectSchedule s;
  return s.due(0xfffffff0U,false) && !s.due(9983,false) && s.due(9984,false);
}
static_assert(reconnectSequence(),"WiFi retry 10/20/40/60 seconds; recovery resets schedule");
static_assert(reconnectWrap(),"WiFi retries survive uint32 millis wrap");
static_assert(agro::linkState(false,true,true,true)==agro::LinkState::NoWifi,"WiFi loss wins over old trust");
static_assert(agro::linkState(true,false,true,true)==agro::LinkState::NoTime,"stale SNTP invalidates session");
static_assert(agro::linkState(true,true,false,false)==agro::LinkState::NoApiConfig,"WiFi connected without API config");
static_assert(agro::linkState(true,true,true,false)==agro::LinkState::AwaitingApi,"API not yet verified");
static_assert(agro::linkState(true,true,true,true)==agro::LinkState::ApiReady,"API verified");
static_assert(!agro::usableSession(true,true,true,1,2),"new SNTP generation rechecks TLS/health");
static_assert(!agro::usableSession(false,true,true,2,2),"closed socket cannot keep trust");
static_assert(!agro::usableSession(true,false,true,2,2),"aged clock cannot keep trust");
static_assert(agro::usableSession(true,true,true,2,2),"same generation session reusable");
constexpr int clampedDry[]={2700,2700,2700,2700,2700};
constexpr int clampedWet[]={1450,1450,1450,1450,1450};
static_assert(agro::measure(clampedDry,5,calibration()).percent==0,"dry margin clamps to zero");
static_assert(agro::measure(clampedWet,5,calibration()).percent==100,"wet margin clamps to 100");
constexpr agro::Calibration reversed() { auto c=calibration(); c.dry=1535; c.wet=2600; return c; }
static_assert(agro::measure(wet,5,reversed()).percent==0,"reversed calibrated direction supported");
static_assert(!agro::measure(dry,5,agro::Calibration()).valid,"unconfirmed calibration fails closed");

// The following evaluate the legacy controller used ONLY in Wokwi, not the API runtime.
constexpr agro::Controller simulated(agro::Mode mode=agro::Mode::Automatic) {
  agro::Config config; config.maximumMs=2000; config.cooldownMs=1000; config.staleMs=1500;
  agro::Controller c(config); c.begin(0); c.setMode(mode,0); c.sample({true,10,2493},1000); return c;
}
constexpr bool simBoot() { agro::Controller c; c.begin(0); return !c.pump() && c.mode()==agro::Mode::Disabled; }
constexpr bool simHysteresis() {
  auto c=simulated(); c.tick(1000); if (!c.pump()) return false;
  c.sample({true,40,2174},1200); c.tick(1200); if (!c.pump()) return false;
  c.sample({true,55,2014},1300); c.tick(1300); return !c.pump();
}
constexpr bool simTimeout() { auto c=simulated(); c.tick(1000); c.sample({true,10,2493},2900); c.tick(3000); return !c.pump() && c.locked(); }
constexpr bool simFault() { auto c=simulated(); c.tick(1000); c.sample({},1100); return !c.pump() && c.locked() && !c.setMode(agro::Mode::Manual,1100); }
constexpr bool simStale() { auto c=simulated(); c.tick(1000); c.tick(2500); return !c.pump() && c.locked(); }
constexpr bool simCooldown() { auto c=simulated(); c.tick(1000); c.sample({true,60,1961},1100); c.tick(1100); c.sample({true,10,2493},1200); c.tick(1200); return !c.pump(); }
constexpr bool simManualReplay() {
  auto c=simulated(agro::Mode::Manual); agro::Command on; on.id=1; on.authorized=true; on.action=agro::Action::On;
  if (c.command(on,1000,0)!=agro::Result::Applied || !c.pump()) return false;
  agro::Command off; off.id=2; off.authorized=true;
  return c.command(off,1100,0)==agro::Result::Applied && !c.pump() && c.command(on,1200,0)==agro::Result::Duplicate;
}
constexpr bool simExpiry() { auto c=simulated(agro::Mode::Manual); agro::Command on; on.id=1; on.authorized=true; on.action=agro::Action::On; on.expiresUnix=100; return c.command(on,1000,100)==agro::Result::Expired && !c.pump(); }
constexpr bool simRearm() { auto c=simulated(); c.criticalFault(1000); c.sample({true,10,2493},1100); return c.clearFault(1100) && !c.pump() && c.mode()==agro::Mode::Disabled; }
static_assert(simBoot(),"simulation boot OFF/disabled");
static_assert(simHysteresis(),"simulation low starts; middle holds; upper stops");
static_assert(simTimeout(),"simulation maximum duration locks");
static_assert(simFault(),"simulation faulty sensor blocks manual/auto");
static_assert(simStale(),"simulation stale sensor shuts down");
static_assert(simCooldown(),"simulation rapid restart rejected");
static_assert(simManualReplay(),"simulation manual/OFF/duplicate");
static_assert(simExpiry(),"simulation expired ON rejected");
static_assert(simRearm(),"simulation explicit recovery stays disabled");
constexpr int physicalAir[]={3227,3248,3238,3240,3234};
constexpr int physicalSoil[]={2801,2835,2818,2820,2810};
constexpr int physicalWater[]={1136,1139,1138,1137,1138};
constexpr int boundary[]={2800,2800,2800,2800,2800};
constexpr int aboveBoundary[]={2801,2801,2801,2801,2801};
constexpr agro::Calibration invalidCalibration() { auto c=calibration(); c.wet=c.dry; return c; }
static_assert(agro::measure(physicalAir,5,calibration()).reason==agro::ReadingReason::OutsideCalibration,"reported air outside existing calibration");
static_assert(agro::measure(physicalSoil,5,calibration()).reason==agro::ReadingReason::OutsideCalibration,"reported wet soil outside existing calibration");
static_assert(agro::measure(physicalWater,5,calibration()).reason==agro::ReadingReason::OutsideCalibration,"reported water outside existing calibration");
static_assert(agro::measure(physicalSoil,5,calibration()).raw==2818,"invalid median still available for telemetry");
static_assert(agro::measure(boundary,5,calibration()).valid && !agro::measure(aboveBoundary,5,calibration()).valid,"2800 inclusive and 2801 rejected");
static_assert(agro::measure(rail,5,calibration()).reason==agro::ReadingReason::Rail,"specific rail cause");
static_assert(agro::measure(noisy,5,calibration()).reason==agro::ReadingReason::Noise,"specific dispersion cause");
static_assert(agro::measure(dry,5,agro::Calibration()).reason==agro::ReadingReason::NotCalibrated,"specific unconfirmed cause");
static_assert(agro::measure(dry,5,invalidCalibration()).reason==agro::ReadingReason::InvalidCalibration,"invalid endpoints distinguished");
static_assert(agro::measure(dry,4,calibration()).reason==agro::ReadingReason::SampleCount,"incomplete window distinguished");
static_assert(agro::measure(nullptr,5,calibration()).reason==agro::ReadingReason::SampleCount,"null window safely rejected");
static_assert(agro::measure(wet,5,calibration()).reason==agro::ReadingReason::None,"valid zero and 100 are real values");
static_assert(agro::receiptCounts(3,3,0,0),"all readings received");
static_assert(agro::receiptCounts(3,0,3,0),"retry duplicate receipt accepted");
static_assert(agro::receiptCounts(3,1,1,1),"partial receipt explicit");
static_assert(!agro::receiptCounts(3,0,0,0),"200 without accounted readings not success");
static_assert(!agro::receiptCounts(3,3,1,0),"over-counted receipt rejected");
static_assert(agro::receiptCounts(0,0,0,0),"empty heartbeat receipt");
constexpr uint32_t receiptSent[]={101,102,103},receiptRejected[]={102},receiptForeign[]={104},receiptRepeated[]={102,102};
static_assert(agro::receiptDiscardSequences(receiptSent,3,receiptRejected,1),"known rejection sequence");
static_assert(!agro::receiptDiscardSequences(receiptSent,3,receiptForeign,1),"foreign rejection sequence rejected");
static_assert(!agro::receiptDiscardSequences(receiptSent,3,receiptRepeated,2),"repeated rejection sequence rejected");
static_assert(agro::receiptDiscardSequences(nullptr,0,nullptr,0),"empty receipt sequences");
void setup() {}
void loop() {}
