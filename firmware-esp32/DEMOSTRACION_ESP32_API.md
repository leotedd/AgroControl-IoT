# Integración física de monitoreo0.2.2 — API1.0.2

## Dictamen inicial

Compatible para monitoreo, pendiente de aprovisionamiento y prueba física autorizada. Ya existían cliente HTTPS, seis endpoints, Bearer, salud sin token, SNTP, búfer y ACK/NVS. El bloqueo inmediato reportado es api_provisioned=0. No se inventó una API ni se habilita potencia.

Auditoría de solo lectura: GET http://127.0.0.1:3000/api/v1/salud respondió estado=OK, base_datos=OK, hora_servidor=2026-10-17T00:37:55.590Z (16 de octubre local). GET http://127.0.0.1:5174 respondió200. Esto acredita disponibilidad puntual y SELECT1 del backend, NO inserción de mediciones ni sesión del navegador. No se accedió a MySQL directamente ni se usó token de dispositivo.

## Cambios de esta entrega

- Monitor: N/A para inválidos, razón concreta, extremos efectivos, fuente LOCAL/NVS/BACKEND y versión aplicada. Se mantiene ADC mediano. No cambia calibración2600/1535 ni el margen. Ver CALIBRACION_SUELO.md.
- Telemetría: conserva esquema exacto de lecturas; agrega información al diagnostico libre admitido por contrato. Reporta calibración efectiva, causa y versión de última muestra, contadores de recibidas/duplicadas/descartadas y origen_datos=SENSOR_FISICO. Es una declaración de este firmware, no prueba criptográfica de procedencia.
- HTTP200 ya no equivale por sí solo a lectura aceptada. Se validan recibidas+duplicadas+descartadas contra el lote; cada descarte debe referirse a una secuencia enviada y no repetida. CONFIRMED implica todas contabilizadas sin descartes; PARTIAL muestra secuencias/códigos rechazados. Un recibo inválido, timeout o HTTP de error conserva el lote disponible en RAM para reintento.
- Configuración y muestreo usan instantáneas; una ventana calculada con versión anterior se descarta si entretanto se aplicó otra versión.
- Aprovisionamiento: STATUS informa presencia de URL/token/CA sin revelarlos. Cliente muestra api_config con causa de configuración incompleta, sin URL, token ni PEM.

## Contrato, autenticación y datos

URL base exacta: https://HOST/api/v1, sin barra final. Se admite puerto TLS explícito, hostname o IPv4; no IPv6 literal. No HTTP, redirecciones ni certificados ignorados. Cada conexión nueva valida CA/host/fechas y GET /api/v1/salud sin token; el desfase debe ser≤30s. SNTP previo y vigente<1h; no se establece la hora desde la respuesta HTTP. Se mantiene comprobación de generación SNTP de0.2.1.

| Método y ruta relativa a /api/v1 | Uso |
|---|---|
| GET /salud | Salud/hora, sin Authorization |
| GET /iot/configuracion | Configuración versionada |
| POST /iot/configuracion/confirmacion | Aplicación o rechazo |
| GET /iot/ordenes | Órdenes; ON siempre rechazado |
| POST /iot/ordenes/{id}/confirmacion | ACK persistido |
| POST /iot/telemetria | Hasta30 lecturas reales por lote |
| POST /iot/eventos | Eventos locales |

Las rutas /iot usan Authorization: Bearer con token individual y X-Id-Arranque de8hex minúscula. El token identifica el dispositivo en backend; no se envía un UID inventado en el cuerpo. id_arranque del JSON coincide con la cabecera. Cada lectura lleva seq, sensor=HUM1, tipo=HUMEDAD_SUELO, valor_raw, valor_pct, estado, ts y uptime_ms. La raíz incluye UTC, versiones, seguridad y estado APAGADA. Antes de SNTP, ts de una muestra guardada puede ser null; backend reconstruye hora con uptime y marca hora_estimada.

Ejemplo ILUSTRATIVO de una entrada, no captura ni dato a inyectar en producción:

```json
{"seq":1,"sensor":"HUM1","tipo":"HUMEDAD_SUELO","valor_raw":2818,"valor_pct":null,"estado":"ERROR_SENSOR","ts":null,"uptime_ms":500}
```

Cuando válida, valor_pct es numérico redondeado a una décima. Cuando inválida, null con ERROR_SENSOR o SIN_CALIBRAR. ADC sigue disponible aunque el porcentaje no lo sea. MySQL guarda valor=NULL y valor_raw; React ya contempla porcentaje ausente y muestra ADC. No prometer un porcentaje válido hasta calibrar suelo.

Backend deduplica con UNIQUE(sensor_id,id_arranque,seq) e INSERT IGNORE. Los reintentos conservan identidad de muestra. El búfer100 es RAM, puede sobrescribir muestras durante desconexiones y se pierde al reiniciar; los contadores muestran descartes. No es una cola durable de lecturas. El diario NVS de órdenes es distinto y no se borra.

Tiempo de conexión5s y respuesta8s, red en tarea separada del ADC. Reintentos API2–60s con jitter, Retry-After, pausa≥60s en401/403. Wi-Fi usa10/20/40/60s. Los ACK históricos mantienen identidad. ON permanece rechazado, sin controlador GPIO26.

## Preparación a cargo de Claude u operador

1. Mantener PERMITIR_ENCENDIDO=false y configuración deseada DESHABILITADO. Asociar HUM1/BOMBA1 al UID físico; un sensor desconocido produce descartes aun con HTTP200. Perfil actual admite exactamente un sensor/control, riego_max_s≤15, intervalos telemetría5–3600s y órdenes2–60s. El seed actual anuncia15s; comprobar configuración real, no asumirla del seed.
2. Detener el simulador HTTP para ese UID. No compartir token/UID activo con un simulador: ambos alteran id_arranque_actual y mezclan mediciones. Usar un dispositivo separado si se requieren ensayos sintéticos.
3. Sustituir token posiblemente expuesto antes de aprovisionar. El script existente admite, en consola local privada:

```powershell
npm --prefix backend run token:rotar -- UID_DEL_DISPOSITIVO --gracia 0
```

Sustituir UID, no ejecutar literalmente el marcador. Esto cambia la BD y lo debe ejecutar Claude/operador; el agente no lo ejecutó. El script imprime el token nuevo una sola vez: no redirigirlo a archivos, capturas o chat. Gracia0 revoca inmediatamente el anterior.

4. Publicar backend3000 mediante HTTPS. No apuntar ESP32 a localhost, React5174 ni HTTP3000. Una opción temporal, si cloudflared ya está instalado, es:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

No se instaló ni inició túnel. Quick Tunnel genera URL temporal; comprobar la URL publicada y añadir /api/v1 para NVS. Fuente: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). Mantener proxy local y trust proxy loopback del backend; no habilitar HTTP remoto ni ampliar confianza a cabeceras arbitrarias. El ESP32 valida TLS hasta el proxy público; el tramo proxy→Node es loopback HTTP, no TLS terminado dentro de Node.

5. Confirmar GET público /api/v1/salud en JSON200 sin login/intersticial, y hora correcta. Mantener URL estable durante demo. Si cambia, hay que reprovisionar URL y revisar CA.
6. Obtener CA pública adecuada de fuente confiable para la cadena real. En Windows puede inspeccionarse la cadena de la URL con navegador confiable y exportar la CA en Base64 X.509/PEM, verificando procedencia con el emisor. No copiar clave privada ni fijar arbitrariamente el certificado hoja. No se elige una CA concreta sin conocer el host. El core3.3.12 usa setCACert y verificador explícito de fechas por carecer de MBEDTLS_HAVE_TIME_DATE.

## Aprovisionamiento futuro por Arduino IDE/Windows

Estos pasos utilizan COM4 y quedan PENDIENTES de autorización. Antes de USB/carga, desconectar IN/GPIO26, relé y potencia: UNTOUCHED no garantiza reposo eléctrico de un módulo LOW flotante.

1. Abrir firmware-esp32/ProvisionWifi/ProvisionWifi.ino. Placa ESP32 Dev Module, core esp32 by Espressif3.3.12, COM4. Mantener borrado completo de flash deshabilitado. Verificar y Subir.
2. Monitor115200, terminador Nueva línea. No necesita repetir Wi-Fi si ya está guardado. Enviar una línea cada vez:

```text
URL https://HOST_PUBLICO/api/v1
TOKEN TOKEN_NUEVO_DEL_DISPOSITIVO
BEGIN_CA
-----BEGIN CERTIFICATE-----
CONTENIDO_BASE64_COMPLETO_DE_LA_CA
-----END CERTIFICATE-----
END_CA
STATUS
```

Todos los textos de HOST/TOKEN/CONTENIDO son marcadores a sustituir localmente. No incluirlos en código. Esperar STORED para URL, token y CA; STATUS solo confirma presencia, no autenticación ni TLS. Token debe tener51 caracteres, prefijo agc_dev_, resto Base64URL. CA puede contener varios PEM hasta8192bytes, con líneas≤256bytes.

3. Se guardan strings en NVS namespace agro-api: url,token,ca. Wi-Fi conserva agro-wifi/ssid,password. NVS no está cifrada; no protege frente a lectura física. Monitor no hace eco desde el dispositivo, pero el campo de entrada/historial del PC muestra texto. Usar PC confiable y no exportar sesión. Ninguna clave privada es necesaria.
4. Cerrar monitor, abrir AgroControl/AgroControl.ino con todos sus .h, Verificar y Subir, sin borrar flash. REBOOT reinicia el sketch de aprovisionamiento; no restaura el principal. No cargar WokwiSim.
5. Monitor115200: wifi=1, sntp=1, api_provisioned=1, api_config=OK y state=CONECTADO. Confirmar relay=UNTOUCHED y hardware_confirmado=false. Si falla, corregir causa, no desactivar TLS.

## Compilación local sin puerto

Desde raíz PowerShell, comandos ejecutables SIN cargar placa:

```powershell
py tests/firmware/run_checks.py
./firmware-esp32/build.ps1 -ElfOnly
./firmware-esp32/build.ps1 -ElfOnly -Provisioning
./firmware-esp32/build.ps1 -ElfOnly -Wokwi
```

Compilación normal de imagen: `./firmware-esp32/build.ps1` (sin ElfOnly). En este entorno falla extrayendo VCRUNTIME140.dll de PyInstaller. ELF pasa, pero no constituye BIN cargable; Verificar/Subir en IDE del equipo local aún debe completarse. No hay comando de carga ejecutado ni autorización para usar COM4 en esta entrega.

## Resultado y archivos de esta entrega

-13 comprobaciones estáticas y11 pruebas HTTPS de escritorio aprobadas;72 static_assert evaluados por Xtensa aprobados; suite histórica45 solo comprobada por sintaxis. Reporte tests/firmware/build/summary.json. Su backend_real=NOT_CONTACTED se refiere a la suite, que no usa servidor real; las consultas GET de salud/frontend de esta auditoría se describen separadamente arriba.
-AgroControl principal0.2.2 compila/enlaza ELF: flash1079192bytes (82%) y RAM estática58752bytes (17%). ProvisionWifi: flash281200bytes, RAM22172bytes. WokwiSim: flash282548bytes, RAM22852bytes. Core3.3.12, FQBN esp32:esp32:esp32. Sin BIN ni ejecución física.
-Firmware modificado: AgroControl/AgroControl.ino, Control.h, Protocol.h, Settings.h, MonitorState.h, MonitorRuntime.h, SecureTransport.h; ProvisionWifi/ProvisionWifi.ino. WokwiSim/Control.h sincronizado y WokwiSim.ino actualizado para N/A/causas, sin controlador físico.
-Pruebas modificadas: tests/firmware/CompileChecks/CompileChecks.ino, test_artifacts.py, mock_api.py, test_https_fixture.py y README.md. Fixture sintético aislado, sin inserciones en producción.
-Documentación: creados DEMOSTRACION_ESP32_API.md y CALIBRACION_SUELO.md; actualizados firmware-esp32/README.md e INTEGRACION_API.md. Sin cambios en carpetas de Claude ni operaciones Git.

## Verificar lectura real de extremo a extremo

1. Con hardware autorizado y potencia desconectada, registrar boot, dry/wet/source/version y ADC local. Cambiar contacto con suelo, sin fabricar lecturas ni sumergir electrónica.
2. Observar POST /iot/telemetria HTTP200 seguido de receipt=CONFIRMED con boot/first_seq/last_seq, received o duplicate. PARTIAL indica descarte; INVALID o NOT_CONFIRMED no acreditan recepción completa.
3. Backend debe registrar UID y arranque correctos, POST con200, sin token. CONFIRMED acredita respuesta del servidor según contrato; confirmar almacenamiento separadamente.
4. En cliente MySQL local, con usuario autorizado y sin poner contraseña en comandos, seleccionar la base real y ejecutar solo lectura (reemplazar UID y ARRANQUE por datos no secretos observados):

```sql
SELECT d.uid,s.codigo,m.id_arranque,m.seq,m.valor_raw,m.valor,m.estado,m.medido_en,m.hora_estimada
FROM mediciones m JOIN sensores s ON s.id=m.sensor_id
JOIN dispositivos d ON d.id=s.dispositivo_id
WHERE d.uid='UID_DEL_DISPOSITIVO' AND m.id_arranque='ARRANQUE_8HEX'
ORDER BY m.id DESC LIMIT 30;

SELECT d.uid,d.version_firmware,d.config_version_aplicada,d.hardware_confirmado,d.diagnostico
FROM dispositivos d WHERE d.uid='UID_DEL_DISPOSITIVO';
```

Comparar seq y ADC contra la serie; inválidas deben existir con valor=NULL, no0 artificial. Verificar registro único por sensor/arranque/seq tras reintento. No ejecutar escrituras ni consultar hashes/tokens para esta comprobación.
5. Frontend real: operador ejecuta `npm --prefix frontend run dev:real`, abre http://127.0.0.1:5174 e inicia sesión con usuario autorizado. En DevTools→Network revisar GET /api/v1/dispositivos/ID/estado y que id/UID/HUM1 correspondan al físico. No usar modo demo5173.
6. Comprobar ADC variable y, mientras inválida/no calibrada, porcentaje ausente y estado de error. Una lectura inválida almacenada demuestra transmisión, no calibración correcta. Tras calibración real se podrá comprobar porcentaje. Frontend sondea aproximadamente cada3s; telemetría por defecto10s más tránsito/búfer, no actualiza instantáneamente.
7. Apagar/reanudar hotspot: sensor sigue local, red se recupera sin ON. Ensayar reinicio y persistencia solo con autorización; no borrar NVS para reparar conexión.

## Pendientes de Claude y bloqueos de demostración

- Falta URL pública HTTPS/CA y token nuevo. No hay prueba ESP32→API real ni inserción de telemetría realizada por este agente.
- Frontend localiza primer dispositivo disponible, no selecciona por UID físico explícito. Si hay varios terrenos/dispositivos, Claude debe añadir selección o garantizar que la sesión visualice el objetivo.
- Modo real significa API/MySQL y también puede contener simulador HTTP. BD mediciones no conserva origen físico/simulado por fila; diagnostico actual se sobrescribe y no certifica historia. Claude debe definir procedencia durable/visible y aislamiento de simulador coordinando contrato si añade campos. Para demo, UID físico exclusivo, token rotado y filtrar arranque real; no presentar histórico mezclado como físico. El firmware ya declara SENSOR_FISICO dentro de diagnostico permitido.
- Calibración definitiva pendiente de suelo seco/húmedo. Recomendar calibracion_confirmada=false mientras tanto; no asignar aire/agua a extremos definitivos.
- Compilación BIN local, carga, TLS real, respuesta/ACK, NVS bajo cortes y recorrido navegador/MySQL aún por ensayar. Las pruebas Python son fixture independiente, no backend real ni cliente TLS ESP32 ejecutado.
- GPIO26 sigue intacto; módulo LOW no garantiza OFF durante reset. No hay driver, prueba de potencia ni aprobación eléctrica. Mantener PERMITIR_ENCENDIDO=false.
