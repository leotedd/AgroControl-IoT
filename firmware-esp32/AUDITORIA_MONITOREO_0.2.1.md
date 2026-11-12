# Auditoría0.2.1-monitor

## Seguridad

Se mantienen hardwareConfirmed=false, enableAutomaticAtBoot=false, arranque lógico deshabilitado, rechazo ON y ausencia de driver/escrituras GPIO26. Solo firmware-esp32/ y tests/firmware/. No se abre COM4 ni se carga firmware; sin cambios backend/frontend/database/contrato ni operaciones Git.

El usuario reportó wifi=1, sntp=1, relay=UNTOUCHED y sensor funcionando con la versión anterior. No acredita TLS/backend, NVS bajo cortes ni esta actualización en placa.

## Hallazgos y correcciones

1. State podía seguir SIN_WIFI al conectar sin configuración API. refreshLink actualiza antes de salidas tempranas: SIN_WIFI sin red, SIN_HORA sin hora vigente y SIN_API con Wi-Fi/hora pero sin API. api_provisioned=0 distingue configuración ausente. Sin cambios JSON ni estados nuevos del contrato.
2. TLS se invalida al observar pérdida Wi-Fi o caducidad de hora aun sin API. La generación SNTP capturada antes de TLS se compara tras salud, antes de petición autenticada y tras respuesta2xx. Un cambio observado exige validar de nuevo. No se promete atomicidad entre callback SNTP y cada byte; persiste riesgo contractual de SNTP no autenticado. Se mantienen CA, hostname y fechas. Un fallo HTTP de salud se clasifica SIN_API sin reiniciar SNTP innecesariamente.
3. Planificador único de reconexión: intento inmediato al iniciar desconexión y esperas10/20/40/60s, máximo60s hasta siguiente intento. Recuperar conexión reinicia intervalo. Auto-reconnect del driver desactivado para evitar propietarios duplicados. No espera en bucle hasta conectar; sensor en otra tarea. Resta modular cubre desbordamiento uint32 de millis. No garantiza asociación dentro de60s.
4. ADC conserva12bits/11dB, mediana5/500ms, calibración2600/1535, rechazo de rieles/ruido/margen. Pruebas nuevas para saturación0/100 dentro del margen, calibración inversa y rechazo sin confirmación. Porcentaje relativo; cable flotante puede parecer válido.
5. API1.0.2: revisadas rutas, Bearer, salud antes de token, IDs seguros, caducidad UTC/monotónica, prioridad OFF, huellas/ACK y marca persistida. Sin cambios de endpoints/semántica. NVS monitor-v2 representa rechazos/OFF lógicos; INTENCION/FINAL de actuación, recuperación incierta y corte físico pendientes. Sin conformidad completa ni integración real declarada.
6. WokwiSim aislado sin salida GPIO26, credenciales o red real. Controlador histórico hecho constexpr sin cambiar política para evaluar escenarios; no se incorpora al sketch principal.

## Verificación

`py tests/firmware/run_checks.py`:11 comprobaciones de artefactos,8 pruebas HTTPS de escritorio y50 static_assert C++ evaluados por Xtensa (26 previos,15 de reconexión/sesión/calibración y9 escenarios históricos de simulación). Las45 aserciones históricas de test_control.cpp siguen verificadas solo por sintaxis, no ejecutadas. Evidencia: tests/firmware/build/summary.json y TXT.

Compilar por separado: `./firmware-esp32/build.ps1 -ElfOnly` y `./firmware-esp32/build.ps1 -ElfOnly -Wokwi`. Ambos perfiles compilan y enlazan con core3.3.12. ELF_ONLY omite empaquetado, no constituye BIN/carga. Persiste limitación del entorno PyInstaller/VCRUNTIME140.dll. Logs por perfil en firmware-esp32/build/. No se ejecutó Wokwi ni se contactó backend real.

## Ensayos pendientes del perfil principal

Siempre potencia/IN desconectados y autorización previa para COM4.

| Caso | Criterio |
|---|---|
| Arranque/reset/USB | OFF lógico, GPIO26 intacto, sensor/tareas recuperan |
| Hotspot apagado/encendido | SIN_WIFI, sensor continúa, reconexión sin ON ni borrar NVS |
| Wi-Fi sin API | wifi=1, sntp según resultado, SIN_API |
| Backend caído/timeout | Backoff sin eco de token ni bloqueo del muestreo |
|401/403/429/5xx | Pausas y Retry-After; ACK conservado |
| SNTP envejecido/cambiado | Invalidar confianza al vencer1h y repetir salud |
| CA/host/fecha inválidos | Rechazar TLS antes del token con cliente ESP32 real |
| OFF/ON/duplicado/reinicio | OFF lógico, ON rechazado, ACK/marca conservados |
| Corte NVS/corrupción | Fallo seguro sin borrar marca ni desbloquear potencia |

## Secuencia futura de potencia

Primero Wokwi y sensor/comunicación. Después identificar esquema del módulo LOW, verificar entrada3.3V sin retorno5V y reposo OFF en reset/apagado. Confirmar corriente nominal/arranque/bloqueo del motor, fuente y protecciones; instalar supresión del motor y verificar aparte la bobina. Revisar COM/NO, cableado y retorno hacia USB. Con circuito revisado, ensayar contactos sin bomba y reset/brownout antes de carga inductiva.

Habilitar bomba requiere desarrollar/revisar controlador físico, persistencia de actuación y corte independiente: no basta cambiar booleano. Hasta entonces relé, IN y bomba desconectados. Wokwi no acredita compatibilidad eléctrica. Ver PRIMERA_PRUEBA_SEGURA.md y WokwiSim/README.md.

Referencia primaria de las funciones Wi-Fi: [API de Espressif](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html). La evidencia de compilación corresponde al core local3.3.12; disponibilidad de la API no acredita recuperación con el hotspot real.
