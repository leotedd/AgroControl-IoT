"""Local HTTPS fixture for the ESP32 monitoring build. Not the production backend.

Token comes from AGRO_TEST_DEVICE_TOKEN. All actuators remain logically OFF.
Use --negative-on to deliberately deliver an ON despite hardware_confirmado=false.
"""
import argparse
import json
import os
import ssl
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def utc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Fixture:
    def __init__(self, token, negative_on=False):
        self.token = token
        self.acks = {}
        self.telemetry = []
        self.readings = {}
        self.events = []
        self.lock = threading.Lock()
        self.orders = [{"id": 1, "tipo": "BOMBA_ENCENDER" if negative_on else "BOMBA_APAGAR",
                        "actuador": "BOMBA1", "parametros": {"duracion_s": 5} if negative_on else {}}]

    def handler(self):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass  # Do not echo request bodies or Authorization.

            def reply(self, code, data):
                payload = json.dumps({"data": {**data, "hora_servidor": utc()}}).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)

            def authenticated(self):
                return (self.headers.get("Authorization") == "Bearer " + fixture.token
                        and len(self.headers.get("X-Id-Arranque", "")) == 8)

            def do_GET(self):
                if self.path == "/api/v1/salud":
                    self.reply(200, {"estado": "OK"})
                    return
                if not self.authenticated():
                    self.reply(401, {"codigo": "TOKEN_DISPOSITIVO_INVALIDO"})
                    return
                if self.path == "/api/v1/iot/configuracion":
                    self.reply(200, {"config_version": 1, "intervalo_telemetria_s": 5,
                                    "intervalo_ordenes_s": 3,
                                    "sensores": [{"sensor": "HUM1", "tipo": "HUMEDAD_SUELO",
                                                  "raw_seco": 2600, "raw_humedo": 1535,
                                                  "calibracion_confirmada": True}],
                                    "control": [{"actuador": "BOMBA1", "sensor": "HUM1", "modo": "MANUAL",
                                                 "umbral_inicio_pct": 30.0, "umbral_parada_pct": 55.0,
                                                 "riego_max_s": 15, "descanso_min_s": 60}]})
                elif self.path == "/api/v1/iot/ordenes":
                    with fixture.lock:
                        orders = [o.copy() for o in fixture.orders if o["id"] not in fixture.acks][:1]
                    from datetime import timedelta
                    for order in orders:
                        # Immutable timestamps, also on redelivery.
                        original = next(o for o in fixture.orders if o["id"] == order["id"])
                        original.setdefault("creada_en", utc())
                        original.setdefault("expira_en", (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat().replace("+00:00", "Z"))
                        order.update(creada_en=original["creada_en"], expira_en=original["expira_en"])
                    self.reply(200, {"ordenes": orders, "config_version": 1})
                else:
                    self.reply(404, {})

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                if length > 16384:
                    self.close_connection = True
                    self.reply(413, {})
                    return
                try:
                    body = json.loads(self.rfile.read(length))
                except (ValueError, UnicodeError):
                    self.reply(400, {})
                    return
                if not self.authenticated():
                    self.reply(401, {})
                    return
                if self.path == "/api/v1/iot/telemetria":
                    if (body.get("version_contrato") != "1.0.2"
                            or body.get("seguridad", {}).get("hardware_confirmado") is not False
                            or any(a.get("estado_bomba") != "APAGADA" for a in body.get("actuadores", []))):
                        self.reply(422, {})
                        return
                    received, duplicate, discarded = 0, 0, []
                    with fixture.lock:
                        fixture.telemetry.append(body)
                        for reading in body.get("lecturas", []):
                            seq = reading.get("seq")
                            if reading.get("sensor") != "HUM1":
                                discarded.append({"seq": seq, "codigo": "SENSOR_DESCONOCIDO"})
                                continue
                            key = (reading["sensor"], body.get("id_arranque"), seq)
                            if key in fixture.readings:
                                duplicate += 1
                                continue
                            stored = reading.copy()
                            if stored.get("estado") != "OK":
                                stored["valor_pct"] = None
                            fixture.readings[key] = stored
                            received += 1
                    self.reply(200, {"recibidas": received, "duplicadas": duplicate,
                                     "descartadas": discarded, "config_version": 1, "ordenes_pendientes": len(fixture.orders)-len(fixture.acks)})
                elif self.path == "/api/v1/iot/eventos":
                    fixture.events.extend(body.get("eventos", []))
                    self.reply(200, {"recibidos": len(body.get("eventos", [])), "duplicados": 0})
                elif self.path == "/api/v1/iot/configuracion/confirmacion":
                    self.reply(200, {"config_version_aplicada": body.get("config_version")})
                elif self.path.startswith("/api/v1/iot/ordenes/") and self.path.endswith("/confirmacion"):
                    try:
                        order_id = int(self.path.split("/")[-2])
                    except ValueError:
                        self.reply(422, {})
                        return
                    if not any(o["id"] == order_id for o in fixture.orders):
                        self.reply(404, {})
                        return
                    previous = fixture.acks.get(order_id)
                    fields = ("resultado", "codigo_motivo", "duracion_aplicada_s")
                    off = next(o for o in fixture.orders if o["id"] == order_id)["tipo"] == "BOMBA_APAGAR"
                    equal = not previous or all(previous.get(k) == body.get(k) for k in fields)
                    equal |= bool(off and previous and previous.get("resultado") == body.get("resultado") == "EJECUTADA")
                    if not equal:
                        self.reply(409, {})
                        return
                    fixture.acks.setdefault(order_id, body)
                    self.reply(200, {"id": order_id, "estado": fixture.acks[order_id]["resultado"], "confirmacion_tardia": False})
                else:
                    self.reply(404, {})

        return Handler


def server(fixture, cert, key, host="127.0.0.1", port=8443):
    httpd = ThreadingHTTPServer((host, port), fixture.handler())
    httpd.daemon_threads = True
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(cert, key)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    return httpd


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8443)
    parser.add_argument("--negative-on", action="store_true")
    args = parser.parse_args()
    token = os.environ.get("AGRO_TEST_DEVICE_TOKEN", "")
    if len(token) != 51 or not token.startswith("agc_dev_"):
        parser.error("Set AGRO_TEST_DEVICE_TOKEN locally; never commit it")
    print("HTTPS fixture; synthetic responses only; pump must remain disconnected")
    server(Fixture(token, args.negative_on), args.cert, args.key, args.bind, args.port).serve_forever()
