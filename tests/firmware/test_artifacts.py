"""Checks artifact safety defaults; does NOT execute or validate the C++ logic."""
from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
FW = ROOT / "firmware-esp32"


class ArtifactChecks(unittest.TestCase):
    def test_safety_gates_default_false(self):
        text = (FW / "AgroControl/Settings.h").read_text()
        for name in ("hardwareConfirmed", "enableAutomaticAtBoot"):
            self.assertRegex(text, rf"constexpr bool {name} = false;")
        self.assertIn("relayPolarity = RelayPolarity::ActiveLow;", text)
        self.assertIn("constexpr bool calibrationConfirmed = true;", text)

    def test_no_insecure_tls(self):
        for path in (FW / "AgroControl").glob("*"):
            if path.suffix in (".h", ".ino", ".cpp"):
                self.assertNotIn("setInsecure(", path.read_text(), str(path))

    def test_no_literal_wifi_credentials(self):
        text = (FW / "AgroControl/MonitorRuntime.h").read_text()
        self.assertRegex(text, r'getString\("password",\s*""\)')
        self.assertNotRegex(text, r'WiFi\.begin\(\s*"[^\"]+"')

    def test_core_hardware_independent(self):
        text = (FW / "AgroControl/Control.h").read_text()
        self.assertNotRegex(text, r"#include\s*[<\"](?:Arduino|WiFi|Preferences)")

    def test_only_contract_routes(self):
        text = (FW / "AgroControl/MonitorRuntime.h").read_text()
        for route in ("/iot/configuracion", "/iot/telemetria", "/iot/ordenes", "/iot/eventos"):
            self.assertIn(route, text)
        transport = (FW / "AgroControl/SecureTransport.h").read_text()
        self.assertIn('"/salud"', transport)
        self.assertIn('"/api/v1"', transport)

    def test_no_relay_gpio_calls(self):
        for name in ("AgroControl.ino", "MonitorRuntime.h", "MonitorState.h", "SecureTransport.h"):
            self.assertNotRegex((FW / "AgroControl" / name).read_text(), r"\b(?:digitalWrite|gpio_set_level)\s*\(")
            self.assertNotRegex((FW / "AgroControl" / name).read_text(), r"\bpinMode\s*\(\s*(?:settings::relayPin|26)\s*,")

    def test_wokwi_isolated_and_shared_filter_current(self):
        sim = FW / "WokwiSim"
        self.assertEqual((sim / "Control.h").read_bytes(), (FW / "AgroControl/Control.h").read_bytes())
        text = (sim / "WokwiSim.ino").read_text()
        self.assertNotRegex(text, r"\b(?:digitalWrite|gpio_set_level|WiFi\.begin|Preferences)\s*\(")
        self.assertNotIn("MonitorRuntime.h", text)
        diagram = json.loads((sim / "diagram.json").read_text())
        self.assertTrue(any("esp:34" in row for row in diagram["connections"]))
        self.assertFalse(any("esp:26" in row for row in diagram["connections"]))

    def test_monitor_on_always_rejected_and_link_refreshed(self):
        text = (FW / "AgroControl/MonitorRuntime.h").read_text()
        self.assertIn("else if (isOn) result=Code::Hardware;", text)
        self.assertLess(text.index("net.refreshLink();"), text.index("if (!net.provisioned"))
        self.assertIn("WiFi.setAutoReconnect(false)", text)

    def test_calibration_and_identity(self):
        text = (FW / "AgroControl/Settings.h").read_text()
        self.assertIn('contractVersion[] = "1.0.2"', text)
        self.assertIn("dryAdc = 2600", text)
        self.assertIn("wetAdc = 1535", text)
        self.assertIn("sensorConfirmed = true", text)

    def test_diagnostic_provenance_and_invalid_display(self):
        sketch = (FW / "AgroControl/AgroControl.ino").read_text()
        self.assertIn('snprintf(percent,sizeof(percent),"N/A")', sketch)
        self.assertIn("calibration_source=%s config_version=%lu relay=UNTOUCHED", sketch)
        runtime = (FW / "AgroControl/MonitorRuntime.h").read_text()
        self.assertIn("state.loadedFromNvs?CalibrationSource::Nvs:CalibrationSource::Local", runtime)
        self.assertIn("configure(candidate,CalibrationSource::Backend)", runtime)
        self.assertIn("if (s.configVersion!=configVersion_)", runtime)

    def test_invalid_telemetry_and_receipt_gate(self):
        text = (FW / "AgroControl/MonitorRuntime.h").read_text()
        self.assertIn('else cJSON_AddNullToObject(o,"valor_pct")', text)
        self.assertIn('cJSON_AddNumberToObject(o,"valor_raw",s.reading.raw)', text)
        telemetry = text[text.index("void telemetry()") : text.index("void envelope(")]
        self.assertIn("agro::receiptCounts(count,received,duplicate,rejected)", telemetry)
        self.assertLess(telemetry.index("if (valid) {\n        if (count) samples.delivered"), telemetry.index("receipt=%s"))
        self.assertNotIn("code==400 || code==422", telemetry)

    def test_peer_dates_before_application_data(self):
        text = (FW / "AgroControl/SecureTransport.h").read_text()
        self.assertLess(text.index("!certificateDates()"), text.index('exchange("GET","/salud"'))
        self.assertIn("cert->valid_from", text)
        self.assertIn("cert->valid_to", text)

    def test_scenario_contains_offline_fault_and_manual(self):
        lines = (ROOT / "tests/firmware/scenario.txt").read_text().splitlines()
        rows = [line.split() for line in lines]
        self.assertTrue(any(row[2] == "0" for row in rows))
        self.assertTrue(any(row[1] == "-1" for row in rows))
        self.assertTrue(any(row[3] == "on" for row in rows))
        self.assertTrue(all(len(row) == 4 for row in rows))


if __name__ == "__main__":
    unittest.main(verbosity=2)
