"""Tests the HTTPS fixture using a desktop client, NOT the ESP32 transport."""
import http.client
import json
from pathlib import Path
import secrets
import shutil
import ssl
import subprocess
import threading
import unittest
from mock_api import Fixture, server

ROOT = Path(__file__).resolve().parent


class HttpsFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        openssl = shutil.which("openssl") or r"C:\Program Files\Git\mingw64\bin\openssl.exe"
        if not Path(openssl).is_file():
            raise unittest.SkipTest("OpenSSL unavailable")
        cls.folder = ROOT / "build" / "fixture"
        cls.folder.mkdir(parents=True, exist_ok=True)
        cls.cert = cls.folder / "cert.pem"
        cls.key = cls.folder / "key.pem"
        subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
                        "-keyout", str(cls.key), "-out", str(cls.cert)], check=True, capture_output=True)
        cls.fixture = Fixture("agc_dev_" + secrets.token_urlsafe(32))
        cls.httpd = server(cls.fixture, cls.cert, cls.key, port=0)
        cls.port = cls.httpd.server_port
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def connection(self, context=None):
        return http.client.HTTPSConnection("127.0.0.1", self.port, timeout=3,
                                          context=context or ssl.create_default_context(cafile=str(self.cert)))

    def request(self, method, path, payload=None, auth=True):
        conn = self.connection()
        headers = {"Content-Type": "application/json"}
        if auth:
            headers.update(Authorization="Bearer " + self.fixture.token, **{"X-Id-Arranque": "1234abcd"})
        conn.request(method, "/api/v1" + path, json.dumps(payload) if payload else None, headers)
        response = conn.getresponse()
        body = json.loads(response.read())
        conn.close()
        return response.status, body["data"]

    def test_health_without_token(self):
        code, data = self.request("GET", "/salud", auth=False)
        self.assertEqual(code, 200)
        self.assertIn("hora_servidor", data)

    def test_authentication_required(self):
        self.assertEqual(self.request("GET", "/iot/ordenes", auth=False)[0], 401)

    def test_experimental_calibration(self):
        code, data = self.request("GET", "/iot/configuracion")
        self.assertEqual(code, 200)
        self.assertEqual((data["sensores"][0]["raw_seco"], data["sensores"][0]["raw_humedo"]), (2600, 1535))

    def test_off_ack_equivalence_and_immutable_first(self):
        first = {"resultado": "EJECUTADA", "codigo_motivo": None, "duracion_aplicada_s": None}
        second = {**first, "codigo_motivo": "SIN_CAMBIO"}
        self.assertEqual(self.request("POST", "/iot/ordenes/1/confirmacion", first)[0], 200)
        self.assertEqual(self.request("POST", "/iot/ordenes/1/confirmacion", second)[0], 200)
        self.assertEqual(self.fixture.acks[1], first)
        self.assertEqual(self.request("POST", "/iot/ordenes/1/confirmacion", {**first, "resultado": "FALLIDA"})[0], 409)

    def test_reject_untrusted_ca(self):
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.connection(ssl.create_default_context()).connect()

    def test_reject_wrong_hostname(self):
        context = ssl.create_default_context(cafile=str(self.cert))
        import socket
        with socket.create_connection(("127.0.0.1", self.port), timeout=3) as sock:
            with self.assertRaises(ssl.SSLCertVerificationError):
                context.wrap_socket(sock, server_hostname="wrong.invalid")

    def test_reject_expired_certificate(self):
        try:
            from cryptography import x509
            from cryptography.hazmat.primitives import hashes, serialization
        except ImportError:
            self.skipTest("Optional cryptography package unavailable; no expiry test performed")
        from datetime import datetime, timedelta, timezone
        original = x509.load_pem_x509_certificate(self.cert.read_bytes())
        private = serialization.load_pem_private_key(self.key.read_bytes(), password=None)
        now = datetime.now(timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(original.subject).issuer_name(original.subject)
                       .public_key(original.public_key()).serial_number(x509.random_serial_number())
                       .not_valid_before(now-timedelta(days=2)).not_valid_after(now-timedelta(days=1))
                       .add_extension(original.extensions.get_extension_for_class(x509.SubjectAlternativeName).value, False)
                       .sign(private, hashes.SHA256()))
        expired = self.folder / "expired.pem"
        expired.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
        endpoint = server(self.fixture, expired, self.key, port=0)
        worker = threading.Thread(target=endpoint.serve_forever, daemon=True)
        worker.start()
        try:
            connection = http.client.HTTPSConnection("127.0.0.1", endpoint.server_port, timeout=3,
                                                    context=ssl.create_default_context(cafile=str(expired)))
            with self.assertRaises(ssl.SSLCertVerificationError) as result:
                connection.connect()
            self.assertEqual(result.exception.verify_code, 10)
        finally:
            endpoint.shutdown()
            endpoint.server_close()
            worker.join(timeout=2)

    def test_only_monitor_telemetry(self):
        good = {"version_contrato": "1.0.2", "seguridad": {"hardware_confirmado": False},
                "lecturas": [], "actuadores": [{"estado_bomba": "APAGADA"}]}
        self.assertEqual(self.request("POST", "/iot/telemetria", good)[0], 200)
        self.assertEqual(self.request("POST", "/iot/telemetria", {**good, "seguridad": {"hardware_confirmado": True}})[0], 422)

    def synthetic_payload(self, readings):
        # Desktop fixture data ONLY; never send to the actual backend as physical observations.
        return {"id_arranque": "1234abcd", "version_contrato": "1.0.2",
                "seguridad": {"hardware_confirmado": False},
                "diagnostico": {"origen_datos": "PRUEBA_SINTETICA"},
                "lecturas": readings, "actuadores": [{"estado_bomba": "APAGADA"}]}

    def test_invalid_adc_retained_with_null_percent(self):
        readings = [{"seq": 9001, "sensor": "HUM1", "valor_raw": 2818,
                     "valor_pct": None, "estado": "ERROR_SENSOR"}]
        code, receipt = self.request("POST", "/iot/telemetria", self.synthetic_payload(readings))
        self.assertEqual((code, receipt["recibidas"], receipt["descartadas"]), (200, 1, []))
        stored = self.fixture.readings[("HUM1", "1234abcd", 9001)]
        self.assertEqual(stored["valor_raw"], 2818)
        self.assertIsNone(stored["valor_pct"])

    def test_telemetry_retry_is_deduplicated(self):
        payload = self.synthetic_payload([{"seq": 9002, "sensor": "HUM1", "valor_raw": 2068,
                                           "valor_pct": 49.9, "estado": "OK"}])
        first = self.request("POST", "/iot/telemetria", payload)[1]
        again = self.request("POST", "/iot/telemetria", payload)[1]
        self.assertEqual((first["recibidas"], first["duplicadas"]), (1, 0))
        self.assertEqual((again["recibidas"], again["duplicadas"]), (0, 1))

    def test_partial_receipt_identifies_unknown_sensor(self):
        payload = self.synthetic_payload([{"seq": 9003, "sensor": "UNKNOWN", "valor_raw": 3238,
                                           "valor_pct": None, "estado": "SIN_CALIBRAR"}])
        code, receipt = self.request("POST", "/iot/telemetria", payload)
        self.assertEqual((code, receipt["recibidas"]), (200, 0))
        self.assertEqual(receipt["descartadas"], [{"seq": 9003, "codigo": "SENSOR_DESCONOCIDO"}])


if __name__ == "__main__":
    unittest.main(verbosity=2)
