# Entrega de monitoreo ESP32 — 2026-10-16

Perfil `0.2.0-monitor`, formato API `1.0.2`, ESP32-WROOM-32 DevKit. Fuentes preparadas para Arduino IDE y puerto COM4 informado por el usuario. No se cargó firmware en la placa.

## Listo en código

- Sensor GPIO34/ADC1 alimentado a3V3, lectura incremental12bits/11dB, mediana y detección de ruido/rango. Calibración experimental2600/1535, configurable y reportada como estimación.
- GPIO26 sin configurar/escribir; polaridad desconocida, hardware de potencia no confirmado y sin driver en esta compilación.
- Wi-Fi NVS, SNTP, verificación TLS de cadena/host/fechas, salud previa sin token, autenticación individual, reintentos/timeouts y tarea de red separada del muestreo.
- Telemetría, eventos, configuración, recepción de órdenes y ACK. ON siempre rechazado; OFF solo confirma estado lógico apagado. Rearme de fallos de sensor sin activar potencia.
- Persistencia NVS conCRC/verificación para configuración, bloqueo, marca de agua y ACK; búferes acotados y cuarentena de ACK inválido.
- Aprovisionamiento USB separado sin eco de claves, servidor HTTPS de ensayo y guías de carga/pruebas sin bomba.

## Archivos principales

`AgroControl/AgroControl.ino`, `Settings.h`, `Control.h`, `Protocol.h`, `MonitorState.h`, `SecureTransport.h`, `MonitorRuntime.h`; `ProvisionWifi/ProvisionWifi.ino`; `build.ps1`; `README.md`, `PRUEBAS_FISICAS.md` e `INTEGRACION_API.md`.

En `tests/firmware/`: `CompileChecks/CompileChecks.ino`, `test_artifacts.py`, `test_control.cpp`, `mock_api.py`, `test_https_fixture.py`, `run_checks.py`, `run.ps1` y README. Los archivos de resultados/certificados de ensayo quedan en build ignorado.

## Resultados comprobados

| Verificación | Resultado |
|---|---|
| Compilación/enlace ESP32 del monitor, core3.3.12, FQBN esp32:esp32:esp32 | PASS ELF:1,076,004bytes de programa;57,888bytes de variables globales |
| Compilación/enlace del aprovisionador con el mismo core | PASS ELF:280,224bytes de programa;22,172bytes de variables globales |
| Expresiones C++ de producción evaluadas en compilación |26 static_assert aprobados |
| Verificaciones estáticas de artefactos |9 aprobadas |
| Fixture HTTPS con cliente Python de escritorio |8 aprobadas, sin omisiones; incluye CA, hostname y certificado vencido |
| Suite histórica45 aserciones |Sintaxis C++ aprobada; no ejecutada |
| Empaquetado normal de imágenes |Bloqueado por permisos al extraer VCRUNTIME140.dll de herramienta PyInstaller |
| Placa COM4 / Wi-Fi real / API de Claude / NVS con cortes / bomba |No ejecutados |

ElfOnly omite empaquetado y verifica C++ y enlace reales; **no crea BIN cargable**. Las pruebas TLS de escritorio no acreditan que el cliente del ESP32 haya aprobado F-16/F-20. Tampoco hay conformidad integral de riego ni pruebas físicas aprobadas.

Evidencia: logs en `build/AgroControl/compile.log`, `build/ProvisionWifi/compile.log` y `../tests/firmware/build/summary.json`. Ejecutar `py tests/firmware/run_checks.py` para repetir los grupos de pruebas.

## Pendiente antes de probar el dispositivo

1. Generar imagen y cargar normalmente desde Arduino IDE en COM4 con potencia desconectada; resolver el empaquetador local si el error se reproduce fuera de este entorno.
2. Aprovisionar SSID/password, URLHTTPS base, token individual y CA confiable solo por USB. La URL y CA finales no fueron proporcionadas; no se guardaron secretos en código.
3. Coordinar configuración HUM1:2600/1535, calibración confirmada, sin falsear hardware_confirmado. Probar lecturas, HTTPS, OFF/ACK, rechazo de ON, pérdida de hotspot y reinicio.
4. Validar módulo del relé y entrada3.3V/polaridad, corriente de arranque de bomba, fuente/protecciones y reposo en reset antes de desarrollar potencia. El modelo SONGLE no resuelve esas características del módulo.
5. Implementar y validar el controlador físico completo de1.0.2 en una fase posterior: cerrojo/buzón, duración de órdenes, INTENCION/FINAL, episodios/rearme, TWDT y respaldo. No habilitar este perfil cambiando un booleano.

No se modificaron backend, frontend, database, documentacion ni contrato. No se realizaron operaciones Git.
