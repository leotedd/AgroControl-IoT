# Integración API IoT v1.0.2 — firmware de monitoreo

## Preparación0.3.0-trial: banco manual≤5s, aún sin habilitación física

Ver `PRUEBA_MANUAL_5S.md`. GPIO26 activo LOW preparado con precarga HIGH, control fuera de red, temporizador de respaldo, gates eléctricos cerrados y prohibición de AUTOMATICO. NVS manual-v3 migra monitor-v2 sin borrar marcas/ACK/bloqueos/credenciales; INTENCION precede a LOW y FINAL conserva duración/estado histórico. No se abrió COM4 ni se cargó una imagen.

**Coordinación pendiente con Claude:** una nueva versión de configuración debe limitar riego_max_s a5, conservar modo DESHABILITADO inicialmente y confirmar calibración solo con mediciones validadas. Los bloqueos anteriores se conservan. El permiso del backend para ON manual debe revisarse en una ventana expresamente autorizada; no se modificó PERMITIR_ENCENDIDO ni el backend. El hardware seguirá reportándose no confirmado mientras no estén aprobadas las cuatro barreras.

**Política de banco solicitada, más restrictiva que1.0.2:** se detiene manual al perder comunicación, al vencer la orden o cambiar la hora, en vez de completar necesariamente su duración (§9.6/§7.2). Una reconexión no restaura modo; exige transición nueva DESHABILITADO→MANUAL. Incertidumbre tras reset/control obliga revisión local y no admite rearme remoto preventivo general. No se declara conformidad completa del controlador agrícola ni se modifica unilateralmente el contrato. El respaldo por esp_timer no es un corte eléctrico independiente del MCU; no certifica máximo físico ante cuelgue/contacto soldado.

## Actualización0.2.2: coordinación para demostración física

Ver `DEMOSTRACION_ESP32_API.md` (aprovisionamiento, endpoints, JSON, verificación MySQL/React, bloqueos) y `CALIBRACION_SUELO.md` (diagnóstico y referencia pendiente). Los apartados de entregas anteriores debajo conservan su alcance histórico; esta actualización los complementa.

**Cambios compatibles del firmware:** N/A y causa de invalidez, extremos/fuente/versión efectivos; diagnostico libre con origen SENSOR_FISICO y calibración; validación de recibo telemétrico antes de retirar lote RAM; STATUS sin secretos. Los campos obligatorios del contrato no cambian. Calibración2600/1535 conservada, sin afirmar su validez experimental actual. NVS monitor-v2 no cambia de layout y no se borra.

**Comprobación real limitada:** GET de solo lectura a salud3000 devolvió estado/base_datos OK; frontend5174 respondió200. No hubo autenticación de dispositivo, inserciones de prueba en backend real, acceso COM4 ni carga. El fixture HTTPS ampliado sigue siendo independiente del backend/MySQL de Claude.

**Acciones para Claude/operador antes de la demostración:**

1. Preparar URL pública HTTPS y cadena CA, con proxy local de confianza que preserve HTTPS al backend. No HTTP remoto ni bypass TLS. Rotar token posiblemente expuesto con gracia0 usando script existente; no compartirlo en documentos/chat. No se ejecutó rotación desde firmware.
2. Verificar dispositivo físico/HUM1/BOMBA1, modo DESHABILITADO, PERMITIR_ENCENDIDO=false, máximo≤15s y versión de configuración. El perfil solo admite un sensor/control. Considerar calibracion_confirmada=false hasta medir suelo seco/húmedo; así ADC sigue almacenándose sin porcentaje inventado.
3. Separar el simulador HTTP: modo real del frontend solo garantiza API/MySQL, no origen físico de todas las filas. El simulador usa0.0.0-sim y diagnostico.simulador; el firmware0.2.2 declara diagnostico.origen_datos=SENSOR_FISICO. Esos diagnósticos de dispositivo no son procedencia durable por medición. Definir aislamiento y trazabilidad histórica/etiqueta visible; coordinar contrato si añade campos. Para demo, UID/token exclusivos y verificar arranque real.
4. Revisar selección de dispositivo: FuenteApi.localizarDispositivo devuelve el primero disponible. Si hay varios, añadir selección o asegurar que la sesión tenga visible el UID físico objetivo. No interpretar éxito HTTP200 como todas las lecturas aceptadas: revisar recibidas/duplicadas/descartadas.

**Pendientes:** URL/CA y token nuevo, compilación BIN/carga en equipo local, cliente TLS real y recorrido completo ESP32→API→MySQL→React. El firmware principal mantiene hardwareConfirmed=false, enableAutomaticAtBoot=false, todas las órdenes ON rechazadas y GPIO26 intacto. No se solicita habilitar bomba.

Actualización0.2.1-monitor: ver `AUDITORIA_MONITOREO_0.2.1.md` para correcciones de diagnóstico/reconexión, invalidación por Wi-Fi/hora y pruebas ampliadas. El usuario reportó wifi=1/sntp=1 con la versión anterior; HTTPS/backend y nueva versión siguen pendientes de ensayo físico. No cambia contrato ni habilita potencia.

Revisión y entrega: 2026-10-16. Sustituye el diagnóstico de1.0.0 de este archivo; `ENTREGA_FASE_1.md` queda como registro histórico. El usuario autorizó continuar firmware con sensor conectado y sin habilitar físicamente la bomba.

## Dictamen y alcance

**APROBADO CON OBSERVACIONES para desarrollar/probar comunicación de monitoreo.** La especificación1.0.2 incorpora las correcciones de las cinco observaciones de1.0.1: cerrojo común, buzón OFF independiente de cola, contador preventivo unificado, validaciones separadas de RESTABLECER y protección de identidad en BD. No se modifica el contrato ni se declara conformidad integral del sistema de riego.

**Firmware entregado:** perfil de monitoreo, versión0.2.0-monitor, protocolo de red1.0.2. ADC34 activo y calibrado con seco2600/húmedo1535. GPIO26 permanece sin configurar/escribir; no se conoce la polaridad del módulo. `hardwareConfirmed=false`, bloqueo de compilación y ausencia de driver impiden un ON físico. No se instancia el Controller de riego histórico en el sketch.

Placa confirmada por el usuario: ESP32-WROOM-32 DevKit, puerto COM4, sensor3pines a3V3/GND/GPIO34. SONGLE SRD-05VDC-SL-C identifica la bobina de5V, no prueba niveles/polaridad/aislamiento de la entrada del módulo. Falta validar corriente de arranque de bomba3–6V, interfaz del relé, circuito y fuente5V/2.5A. Se mantiene desconectada la potencia.

## Implementación de esta fase

| Área | Implementado | Límite de la evidencia |
|---|---|---|
| Sensor | Ventana de5 muestras cada500ms, mediana, calibración2600/1535, rieles/ruido/margen; preservación de mediana incluso al rechazar por riel | Sin lectura ejecutada en la placa por el agente; porcentaje relativo, no absoluto |
| Conectividad | SSID/password NVS, reconexión; muestreo separado de tarea de red en core0 | Hotspot real pendiente |
| Aprovisionamiento | Sketch USB sin eco; namespaces agro-wifi y agro-api; URL/token/CA, sin secretos en fuente | Requiere intervención física local; no se cifró NVS |
| Hora | SNTP previo, resincronización1h, año>=2026, cotejo<=30s, plazo desde envío, reloj monotónico64bits | SNTP no autenticado, riesgo residual del contrato; pruebas físicas pendientes |
| TLS | CA explícita/hostname del cliente seguro, fechas de cada certificado presentado antes de bytes HTTP; sin redirects ni bypass; salud sin token en cada conexión | Core3.3.12 instalado: CONFIG_MBEDTLS_HAVE_TIME_DATE ausente, KEEP_PEER_CERTIFICATE activo; vía VERIFICADOR. No se ensayó ese cliente en el ESP32 |
| API | Salud y seis endpoints de §7, Bearer/X-Id-Arranque, configuración atómica y versión, telemetría/ACK/eventos, cuerpos<=16KB | Backend real no contactado; URL/token/CA aún deben aprovisionarse |
| Errores | Backoff2..60s+jitter, Retry-After numérico/HTTP-date, pausa60s401/403, límites JSON/HTTP, contadores | Framing HTTP acepta Content-Length o chunked simple, sin compresión ni extensiones de chunk; inyección de todos los fallos pendiente |
| Estado | Bomba lógica APAGADA; modo inicial DESHABILITADO; una config Manual puede habilitar solo el modo lógico de ensayo | No existe modo automático ejecutable en este perfil |
| Órdenes | ID seguro1..2^53−1, contenido conocido con huellaSHA256, duplicados y marca de agua, rechazo de ON con HARDWARE_NO_CONFIRMADO, OFF con ACK lógico SIN_CAMBIO, rearme de sensor tras10s de lectura válida | No se simula un ON exitoso. El backend puede rechazar ON antes de entregarlo; fixture negativo aislado para probar el rechazo del dispositivo |
| Persistencia | Un blob NVS versionado conCRC y lectura de verificación, config/bloqueo/contador de bloqueo/marca/ACK;16 entradas y8 ACK de OFF separados | Esquema local monitor-v2, no reemplaza el protocolo INTENCION/FINAL de una actuación física. No se ensayaron cortes reales durante NVS |
| Historial |100 lecturas y20 eventos RAM, secuencia compartida, descartes y ACK históricos con arranque/config originales | RAM se pierde al reiniciar; no confundir con ACK persistidos |

Todos los ON se rechazan antes de cualquier efecto. El resultado rechazado y su marca se guardan juntos. Para el rearme de sensor, liberación y ACK se persisten juntos, quedando DESHABILITADO; no se actúa sobre GPIO. OFF no tiene dependencia de reloj ni de espacio en el diario ON y mantiene APAGADA la representación lógica. El anillo OFF puede reciclar el más antiguo sin confirmar contando el descarte, como permite1.0.2.

ACK200/404/409 cierran reintentos;400/422 se conservan en cuarentena sin reciclarse como confirmados. No hay orden de borrado del diario ni reparación automática que rebaje la marca. Corrupción/fallo de persistencia impide recuperación remota y requiere diagnóstico local. Una futura versión con potencia debe migrar los datos y conservar marcas/ACK.

## Correspondencia pendiente con el contrato completo

1. **Driver de potencia:** el usuario confirma ahora polaridad activa LOW; se registra en Settings.h sin incorporar un driver. Siguen pendientes compatibilidad3.3V, driver, protección, GPIO en reset y alimentación. La bomba no se ha probado y su diodo de protección aún no está instalado. No energizar potencia; ver PRIMERA_PRUEBA_SEGURA.md. No se cambió unilateralmente el contrato.
2. **Actuación real:** Controller histórico conserva semánticas previas (OFF→Disabled, timeout manual bloqueante, IDs RAM). No se usa en la compilación de monitoreo. Hay que adaptar duración por orden, estados de bomba, causas/episodio, cerrojo GPIO, buzón OFF y corte/TWDT antes de incorporarlo al sketch.
3. **Persistencia de actuación:** INTENCION durable antes de GPIO, FINAL posterior, recuperación incierta, contador de episodios PREVENTIVO_REPETIDO y ensayos de fallo/migración. El perfil actual no crea INTENCION que pueda activar una bomba.
4. **Tiempo real:** el sensor corre separado de red, pero persistencia de diagnóstico/órdenes se coordina en la tarea de red de monitoreo; no se promete la garantía temporal del controlador físico. Falta tarea de control certificada<=100ms, TWDT/corte/brownout ensayados. Un esp_timer no sustituye un corte eléctrico independiente del MCU.
5. **Recuperación:** solo se expone rearme de FALLA_SENSOR/SENSOR_CADUCADO, comprobando sensor fresco y continuo10s. Fallos de almacenamiento requieren intervención local; no se implementa una orden USB para borrarlos sin preservar seguridad. La política completa de recuperación local/preventiva pertenece a la fase de potencia.
6. **Aceptación:** F-1..F-34/B-1..B-24 no están certificados. F-4 usa una configuración superior al tope que §7.4 ordena rechazar: separar fixture defensivo de configuración válida. F-25 debe inyectar ausencia de lecturas válidas; una desconexión analógica flotante puede parecer válida.
7. **Código/nombres:** esta fase usa cJSON incluido en ESP-IDF, no requiere ArduinoJson7. El protocolo JSON sigue las rutas y campos1.0.2; no se asumen endpoints nuevos.

## Verificación realizada

- Core real3.3.12 y compilador Xtensa2601 identificados. Compilación/enlace ELF del sketch de monitoreo con FQBN esp32:esp32:esp32.
-26 static_assert C++ evaluados por ese compilador y comprobación sintáctica de la suite histórica45; no se ejecutaron las45 aserciones históricas.
-9 pruebas estáticas aprobadas.
-8 pruebas HTTPS del fixture con cliente de escritorio aprobadas, incluyendo rechazo por CA, hostname y certificado vencido; no acreditan el transporte del ESP32.
-Resultados reproducibles: `tests/firmware/build/summary.json`, archivosTXT asociados y logs de compilación en `firmware-esp32/build/`.
-La compilación normal de imagen se detuvo por permisos al extraer VCRUNTIME140.dll desde herramienta PyInstaller. La alternativa ElfOnly compila y enlaza código real y omite empaquetado: no genera BIN cargable. No se declara carga Arduino completada.
-No se cargó firmware en COM4, no se contactó backend real, no se probó NVS/cortes reales y no se energizó el relé ni la bomba.

## Para integrar el ESP32 físico

Necesitamos URLHTTPS base terminada en/api/v1, CA pública validada y token individual aprovisionado localmente; no enviar secretos por chat. Claude debe publicar salud con hora y configurar HUM1 con2600/1535 y calibracion_confirmada=true si se quieren porcentajes tras sincronizar configuración. El servidor debe aceptar hardware_confirmado=false y mostrar las restricciones del dispositivo.

Seguir README para Arduino IDE/COM4 y PRUEBAS_FISICAS.md para el banco sin potencia. Primero compilar/generar imagen y cargar desde el entorno local, verificar sensor/HTTPS/ACK y reinicios. Cualquier fase de control físico requiere nueva validación del circuito y desarrollo del controlador completo; este perfil no se desbloquea cambiando un booleano.

Solo se modifican firmware-esp32/ y tests/firmware/. No se modifica backend/, frontend/, database/, documentacion/ ni el contrato; no se realizaron operaciones Git.
