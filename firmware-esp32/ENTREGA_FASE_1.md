# Entrega de fase 1 — 2026-10-15

## Implementado

Controlador C++11 independiente del hardware con calibración confirmada, mediana, validación analógica y porcentual, histéresis, tres modos, cooldown desde arranque, tiempo máximo automático/manual, sensor caducado, bloqueo enclavado y recuperación explícita. Orden OFF deshabilita control para impedir rearranque automático. IDs duplicados se rechazan durante la sesión; vencimiento exige UTC cuando la orden lo especifica. Capacidad de IDs limitada con rechazo seguro de ON.

Adaptador Arduino con GPIO y polaridad configurables, salida deshabilitada por defecto, muestreo incremental, reporte serial, eventos acotados y reconexión Wi-Fi sin bucle de espera. Simulador de consola y suite C++ para los diez requisitos y casos adicionales. Documentación de carga, riesgos, pruebas físicas y coordinación API.

## Archivos creados

- `firmware-esp32/AgroControl/`: `AgroControl.ino`, `Control.h`, `Settings.h`.
- `firmware-esp32/`: `.gitignore`, `simulator.cpp`, `README.md`, `PRUEBAS_FISICAS.md`, `INTEGRACION_API.md`, este informe.
- `tests/firmware/`: `.gitignore`, `test_control.cpp`, `test_artifacts.py`, `scenario.txt`, `run.ps1`, `README.md`, `artifact-results.txt`.

## Verificación ejecutada y limitaciones

- `py tests/firmware/test_artifacts.py`: **6 pruebas estáticas aprobadas**. Registro en `tests/firmware/artifact-results.txt`.
- Se buscó compilador C++ nativo y Arduino CLI/PlatformIO: no disponibles en PATH ni en las rutas comunes inspeccionadas. WSL no está instalado.
- Se intentó obtener Zig localmente bajo `firmware-esp32/.tools` mediante pip: no se encontró distribución accesible. La consulta HTTPS directa al distribuidor devolvió rechazo de conexión. No se instaló ninguna dependencia global ni se alteró la red.
- Suite C++, ejecutable del simulador y compilación Arduino **no ejecutados** por falta de toolchain. No se afirma que hayan aprobado; se entregan fuentes y comandos reproducibles. No se generó binario ESP32.
- Ninguna prueba física, medición ADC real, prueba de potencia ni conexión al hotspot ha sido ejecutada.

## Problemas y pendientes

En revisión se corrigieron el reporte de ADC mediano sin calibración, la duplicación de eventos de fallo y la escritura de logs dentro de la transición crítica de apagado. Estas correcciones solo tienen revisión de código, pendientes de compilación C++.

El contrato `documentacion/CONTRATO_API_IOT.md` apareció durante el trabajo; se revisó la versión **1.0.0-rc1**, marcada borrador para aprobación. No hay aprobación comprobable. Se documentaron observaciones sobre ON bajo bloqueo, excepciones TLS, reconciliación de órdenes/ACK, arranque de UTC y diferencias de semántica en `INTEGRACION_API.md`, sin modificar el contrato. HTTPS, autenticación de dispositivo, telemetría REST, órdenes remotas, ACK, configuración remota, UTC y pruebas con la web están pendientes. El registro de IDs es volátil; resolver persistencia/replay antes de integrar control remoto. El aprovisionamiento Wi-Fi NVS tampoco se incluye.

Necesitamos modelo/revisión del ESP32, especificaciones de tensión y corriente nominal/de arranque de H13, modelo/esquema y compatibilidad 3.3 V del relé, alimentación/salida del D43 y características verificadas de la fuente de 5 V/2.5 A. Las referencias comerciales no bastan. **No energizar la bomba mientras falten estos datos y la validación del circuito.**

## Siguiente secuencia

1. Disponer de g++/clang++ y ejecutar `tests/firmware/run.ps1`; resolver cualquier fallo antes de cargar.
2. Identificar placa e instalar/seleccionar core Arduino ESP32; compilar el sketch, registrar versiones y cargar por USB con potencia desconectada.
3. Confirmar componentes eléctricos, validar interfaz y apagado al reset, calibrar sensor y ejecutar procedimiento de banco supervisado.
4. Cuando Claude entregue contrato completo y aprobado, revisar requisitos de `INTEGRACION_API.md` y recién entonces implementar REST/TLS y pruebas de plataforma.

Solo se crearon/modificaron archivos bajo las dos carpetas autorizadas. No se realizaron operaciones Git ni modificaciones a archivos de Claude o al consolidado académico.
