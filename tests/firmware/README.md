# Pruebas del firmware de monitoreo — 2026-10-16

Ejecutar desde la raíz: `py tests/firmware/run_checks.py`.

- 13 verificaciones estáticas: barreras, calibración, rutas, ausencia de escrituras del relé/secretos, aislamiento Wokwi, TLS antes de bytes, procedencia de configuración y representación inválida/recibo.
- 72 static_assert C++ evaluados por Xtensa: 50 previos de sensor/protocolo/reconexión/sesión y simulación, más22 sobre causas concretas, rangos físicos reportados y validación de recibos/descartes. No ejecutan tareas ni drivers ESP32. Los9 escenarios del controlador histórico solo acreditan lógica de simulación, no controlador API ni NVS.
- 11 pruebas HTTPS del fixture con cliente Python: salud sin token, autenticación, calibración, ACK OFF inmutable, monitoreo, CA/host/fecha inválidos, ADC inválido con porcentaje null, reintento deduplicado y descarte explícito de sensor desconocido. Datos sintéticos marcados PRUEBA_SINTETICA y enviados solo al fixture, nunca backend real. No se ejecuta el transporte ESP32. Fecha vencida usa cryptography si está disponible; skipped se muestra en unittest. Sin instalaciones globales.
- Comprobación sintáctica de la suite histórica de45 aserciones. **No se ejecutaron esas45 aserciones.** Con g++/clang++ nativo puede ejecutarse run.ps1; requiere C++17.

Resultados en build/summary.json y los archivos TXT de cada grupo. Build está ignorado y contiene certificados efímeros de ensayo, no credenciales reales de infraestructura. Estos resultados no equivalen a conformidad completa F-1..F-34 ni a ensayos físicos de NVS, hotspot o relé.

## Fixture HTTPS opcional para el ESP32

mock_api.py está bajo tests/firmware y separado del backend de Claude. Solo admite telemetría con hardware_confirmado=false y bomba APAGADA. Por defecto entrega una orden OFF. La opción --negative-on entrega un ON deliberadamente para comprobar su rechazo: es un caso adversarial, no comportamiento conforme del backend de producción.

Necesita certificado PEM y clave de prueba para el nombre/IP accesible desde la tablet. Los certificados automáticos solo sirven para localhost/127.0.0.1, **no para la IP LAN del portátil**. Generar un certificado SAN adecuado y aprovisionar su CA pública. Mantener claves/tokens fuera de código y versionado.

Configurar AGRO_TEST_DEVICE_TOKEN solo en el entorno local, sin incorporarlo a scripts ni capturas, y ejecutar:

```powershell
py tests/firmware/mock_api.py --cert <certificado-de-prueba.pem> --key <clave-de-prueba.pem> --bind <IP-LAN-del-portatil> --port 8443
# URL NVS: https://<nombre-o-IP-con-SAN>:8443/api/v1
```

No exponer el fixture fuera de la red de ensayo; cerrarlo al terminar. Los casos de429/Retry-After, fragmentación HTTP, error NVS/corte de alimentación y el cliente TLS real requieren ampliar inyección y ejecutar la placa: no están acreditados por este banco de escritorio.

La suite histórica y simulator.cpp conservan semánticas previas del controlador y no se despliegan en el sketch de monitoreo. Su adaptación completa al riego queda pendiente en INTEGRACION_API.md.
