"""Read-only safety artifact checks; no serial, device credentials or backend requests."""
from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
FW = ROOT / "AgroControl"

class SafetyArtifacts(unittest.TestCase):
    def test_all_physical_gates_closed(self):
        text = (FW / "Settings.h").read_text()
        for name in ("hardwareConfirmed", "manualBenchEnabled", "relay3v3Compatible", "relayBootOffVerified", "enableAutomaticAtBoot", "relayOffOnlyAtBoot"):
            self.assertIn(f"constexpr bool {name} = false;", text)
        self.assertIn("absoluteMaximumSeconds = 5;", text)

    def test_preload_off_before_output_and_backup_before_low(self):
        text = (FW / "ManualRelay.h").read_text()
        self.assertLess(text.index("gpio_set_level(GPIO_NUM_26,offLevel())"), text.index("gpio_set_direction(GPIO_NUM_26,GPIO_MODE_OUTPUT)"))
        self.assertLess(text.index("esp_timer_start_once"), text.index("gpio_set_level(GPIO_NUM_26,onLevel())"))
        self.assertIn("if constexpr (!enabled()) return Start::Hardware", text)
        self.assertIn("previous.active) return Start::Busy", text)

    def test_off_only_is_separate_from_on_permission(self):
        text = (FW / "ManualRelay.h").read_text()
        enabled = text[text.index("static constexpr bool enabled()"):text.index("void begin()")]
        self.assertNotIn("relayOffOnlyAtBoot", enabled)
        self.assertIn('return Start::Hardware', text)
        self.assertIn('"OFF_ONLY"', text)
        self.assertIn('settings::relayDriveActiveLow?1:0', text)
        self.assertIn('settings::relayDriveActiveLow?0:1', text)

    def test_durable_intent_before_start_and_final_after(self):
        text = (FW / "MonitorRuntime.h").read_text()
        text = text[text.index("void executeOn("):text.index("bool sendAck()")]
        intent = text.index("record->phase=Phase::Intention")
        durable = text.index("if (!state.save())", intent)
        self.assertLess(intent, durable)
        self.assertLess(durable, text.index("decision=relay.start"))
        self.assertLess(text.index("decision=relay.start"), text.index("record->phase=Phase::Final"))

    def test_off_precedes_off_persistence(self):
        text = (FW / "MonitorRuntime.h").read_text()
        text = text[text.index("void off("):text.index("bool stableSensor()")]
        self.assertLess(text.index("relay.stop"), text.index("state.save()"))

    def test_off_precedes_configuration_version_barrier(self):
        text = (FW / "MonitorRuntime.h").read_text()
        text = text[text.index("void commands("):text.index("void off(")]
        self.assertLess(text.index("off(id);"), text.index("if (!versionKnown"))
        self.assertLess(text.index("if (!versionKnown"), text.index("process(order"))

    def test_no_automatic_mode_and_no_secret_or_namespace_erasure(self):
        text = (FW / "MonitorRuntime.h").read_text()
        self.assertIn('same(mode,"AUTOMATICO")) { valid=false;', text)
        for path in FW.glob("*"):
            if path.suffix in (".h", ".ino"):
                source = path.read_text()
                self.assertNotRegex(source, r"\b(?:setInsecure|nvs_flash_erase|nvs_erase_all)\s*\(")

    def test_migration_keeps_old_key_and_new_state_is_crc_verified(self):
        text = (FW / "MonitorState.h").read_text()
        self.assertIn('prefs.getBytes("monitor-v2"', text)
        self.assertIn('prefs.putBytes("manual-v3"', text)
        self.assertNotIn('prefs.putBytes("monitor-v2"', text)
        self.assertIn("memcmp(verify.get(),&data,sizeof(data))==0", text)
        self.assertIn("requiresRecovery(data)", text)

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SafetyArtifacts)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    build = ROOT / "build" / "verification"
    build.mkdir(parents=True, exist_ok=True)
    count = (ROOT / "verification/TrialChecks/TrialChecks.ino").read_text().count("static_assert(")
    (build / "summary.json").write_text(json.dumps({"static_tests_run":result.testsRun,"static_pass":result.wasSuccessful(),
        "cpp_assertions_defined":count,"cpp_execution":"evaluated only when TrialChecks is compiled",
        "physical_tests":"NOT RUN","COM4":"NOT ACCESSED","hardware_gates":"CLOSED"}, indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)
