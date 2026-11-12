#pragma once
// ESP32-WROOM-32 DevKit, COM4. Trial prepared, physical output still DISABLED by default.
namespace settings {
constexpr int sensorPin = 34;
constexpr int relayPin = 26;
enum class RelayPolarity { Unknown, ActiveHigh, ActiveLow };
// Reported active LOW by the user. This is metadata, NOT permission to drive IN.
// The module's 3.3 V interface, reset bias and suppression remain unverified.
constexpr RelayPolarity relayPolarity = RelayPolarity::ActiveLow;
constexpr bool sensorConfirmed = true;
constexpr bool hardwareConfirmed = false;
// Do NOT change these gates until the module interface AND OFF bias during reset are verified.
constexpr bool manualBenchEnabled = false;
constexpr bool relay3v3Compatible = false;
constexpr bool relayBootOffVerified = false;
// Optional OFF-only bench profile: never authorizes ON. Keep false until the
// interface is verified. Direct active-LOW input: true; inverting NPN: false.
constexpr bool relayOffOnlyAtBoot = false;
constexpr bool relayDriveActiveLow = true;
static_assert(!relayOffOnlyAtBoot || relay3v3Compatible,
              "Even OFF-only requires a verified electrical interface");
constexpr bool calibrationConfirmed = true;
constexpr bool enableAutomaticAtBoot = false;
constexpr int dryAdc = 2600;
constexpr int wetAdc = 1535;
constexpr unsigned samplePeriodMs = 500;
constexpr unsigned reportPeriodMs = 5000;
constexpr unsigned absoluteMaximumSeconds = 5;
constexpr char firmwareVersion[] = "0.3.0-trial";
constexpr char contractVersion[] = "1.0.2";
static_assert(!enableAutomaticAtBoot,"Automatic irrigation is forbidden in this trial");
static_assert(!manualBenchEnabled || (hardwareConfirmed && relay3v3Compatible && relayBootOffVerified),
              "Manual trial requires electrical compatibility and safe reset bias");
static_assert(absoluteMaximumSeconds==5 && relayPin==26 && relayPolarity==RelayPolarity::ActiveLow,
              "First trial is GPIO26 active LOW, five seconds maximum");
}
