# AgroControl ESP32 — monitoreo seguro, API 1.0.2

**Preparación actual0.3.0-trial, salida física DESHABILITADA:** consultar `PRUEBA_MANUAL_5S.md` antes de cargar. Añade control manual protegido y migración a agro-state/manual-v3, con máximo5s y sin automático. Las cuatro barreras físicas siguen false; GPIO26 continúa UNTOUCHED con la configuración entregada. Los apartados0.2.x siguientes describen las entregas anteriores y no sustituyen esta guía de banco.

Versión actual **0.2.2-monitor**: procedimiento de integración real y límites en `DEMOSTRACION_ESP32_API.md`; calibración pendiente y causas de rechazo en `CALIBRACION_SUELO.md`. Porcentaje inválido se imprime N/A y viaja como null; ADC se conserva. No se aprovisionó la API ni se cargó esta versión en COM4 por el agente. La consulta local de salud/MySQL respondió OK, pero no acredita inserción ni una lectura física transmitida.

Actualización0.2.1-monitor: ver `AUDITORIA_MONITOREO_0.2.1.md`. Reintentos Wi-Fi10/20/40/60s, diagnóstico actualizado sin API y nueva validación tras cambios SNTP. `WokwiSim/` contiene el sketch separado de ensayos virtuales, sin accionar GPIO26. No se cargó esta actualización en COM4.

Entrega 2026-10-16. Esta versión lee el sensor y prepara comunicación HTTPS/órdenes/ACK. **No controla la bomba.** GPIO26 no se configura ni se escribe. La polaridad activa LOW informada por el usuario queda registrada, pero la compatibilidad eléctrica sigue pendiente. `hardwareConfirmed=false` es inalterable en esta compilación mediante `static_assert`. El circuito de potencia debe permanecer desconectado. **No se ha probado la bomba y falta instalar su protección inductiva.** Ver `PRIMERA_PRUEBA_SEGURA.md`.

## Hardware y calibración

| Elemento | Configuración de esta entrega |
|---|---|
| Placa | ESP32-WROOM-32 DevKit; selección inicial Arduino: ESP32 Dev Module |
| Puerto comunicado por el usuario | COM4; comprobar en el Administrador de dispositivos |
| Sensor VCC / GND / AOUT | 3V3 / GND / GPIO34 (ADC1) |
| Calibración experimental proporcionada | Seco2600; húmedo1535, ADC12 bits |
| ADC | Mediana de5 muestras espaciadas100ms; ventana500ms; atenuación11dB |
| Relé | SONGLE SRD-05VDC-SL-C, bobina5V; activo LOW informado; interfaz de3.3V sin verificar |
| GPIO26 | Propuesto, **sin configurar ni escribir** |
| Potencia | Minibomba3–6V DC; fuente5V/2.5A; corriente de arranque/driver aún sin verificar |

El porcentaje es una estimación relativa calibrada, no humedad volumétrica absoluta. Validar que al usar esta resolución/atenuación los extremos experimentales se reproducen. Se rechazan rieles <=20/>=4075, dispersión>500 y mediana fuera del intervalo de calibración±200. Un cable flotante puede generar valores plausibles: no se promete detectar toda desconexión.

Separé confirmación del sensor y de la potencia: el sensor funciona aunque `hardwareConfirmed=false`. El valor reportado `seguridad.hardware_confirmado=false` corresponde a la barrera del actuador. La calibración local inicial está confirmada con los datos proporcionados; una configuración remota posterior con `calibracion_confirmada=false` produce SIN_CALIBRAR y porcentaje null. Pedir a Claude una configuración de HUM1 con2600/1535 y confirmacióntrue, sin alterar sus archivos.

## Archivos y funcionamiento

- `AgroControl/AgroControl.ino`: muestreo/serie en loop y tarea de red en core0. No incluye un controlador GPIO del relé.
- `Settings.h`: pines, calibración, capacidad máxima de15s y barreras cerradas.
- `Control.h`: lógica portable histórica y filtro reutilizado; el controlador de riego no se instancia en el sketch de monitoreo.
- `Protocol.h`: enteros seguros, ISO UTC, plazo conservador desde envío, CRC32 y backoff.
- `MonitorState.h`: estado versionado, CRC y persistencia NVS verificada;16 registros de órdenes y8 ACK de OFF; snapshots de ACK conservados.
- `SecureTransport.h`: HTTPS manual con CA/host y fechas, sin redirecciones; salud sin token antes de autenticar; framing Content-Length/chunked acotado a16KB.
- `MonitorRuntime.h`: configuración, telemetría, órdenes, eventos, búfer de100 lecturas y20 eventos. ON se rechaza siempre; OFF confirma SIN_CAMBIO lógico. Rearme remoto limitado a fallos de sensor con10s de lecturas válidas y frescas; nunca activa potencia.
- `ProvisionWifi/ProvisionWifi.ino`: aprovisionamiento local sin eco de secretos y sin GPIO del relé.
- `build.ps1`: compilación Arduino CLI; opción explícita ElfOnly para verificación sin empaquetar imagen.
- `../tests/firmware/`: comprobaciones C++, verificaciones estáticas y fixture HTTPS independiente del backend de Claude.

La tarea de red es coordinador único del estado NVS. La tarea de muestreo comparte solo snapshots/ring con cerrojo. No se promete conformidad del controlador de riego: faltan driver validado, estados activos, INTENCION previa a un efecto real, buzón GPIO, corte de respaldo y watchdog de control ensayado. El esquema monitor-v2 no admite activar una bomba con cambiar una constante; futuras versiones deberán migrar estado preservando marca de agua y ACK.

## Arduino IDE: verificar y cargar en COM4

1. Desconectar físicamente bomba, alimentación del relé y su entrada GPIO26. Mantener únicamente USB y sensor3V3/GND/GPIO34. No conectar5V al ADC.
2. Arduino IDE2 → Gestor de placas → **esp32 by Espressif Systems**. Se verificó compilación/enlace con core **3.3.12**, `esp32:esp32:esp32`.
3. Abrir `AgroControl/AgroControl.ino`; conservar sus `.h` en la misma carpeta. Seleccionar **ESP32 Dev Module**, puerto **COM4**, resolución/flash según la placa real. El perfil verificado utiliza la partición por defecto y no presupone una medición del tamaño de flash de tu unidad.
4. Pulsar **Verificar**. No hace falta ArduinoJson: se usa cJSON incluido en el core ESP32. Bibliotecas del core: WiFi, NetworkClientSecure, Preferences, SNTP y mbedTLS.
5. Pulsar **Subir** con el circuito de potencia desconectado. Si no entra al bootloader, mantener BOOT durante el inicio de la carga según la placa. No usar borrado total de flash: perdería aprovisionamiento y estado anti-repetición.
6. Monitor serie115200: comprobar `adc_median`, `moisture_estimated_pct`, `valid`, `calibrated` y `relay=UNTOUCHED`. Esperar valores aproximados2600 en seco y1535 en húmedo, según las condiciones experimentales originales.
7. Completar aprovisionamiento y repetir carga del sketch AgroControl. Cerrar cualquier otro monitor que ocupe COM4.
8. Registrar salida de compilación/carga, versión, placa, puerto, valores ADC y resultado. Esta entrega no fue cargada ni ejecutada en COM4.

Desde PowerShell en la raíz:

```powershell
./firmware-esp32/build.ps1
# Verificación alternativa limitada al ELF:
./firmware-esp32/build.ps1 -ElfOnly
```

En este entorno la generación normal de imágenes falla al extraer `VCRUNTIME140.dll` desde una herramienta PyInstaller. `-ElfOnly` omite exclusivamente empaquetado y genera un ELF real compilado/enlazado; **no genera una imagen BIN cargable**. No se modificó la instalación de Arduino. Ejecutar Verificar/Subir normalmente desde Arduino IDE y conservar su resultado antes de declarar carga lista.

## Aprovisionamiento por USB

Cargar primero `ProvisionWifi/ProvisionWifi.ino` en COM4, siempre con potencia desconectada. Abrir monitor115200 con final de línea Nueva línea. Enviar localmente, una línea cada vez:

```text
SSID <nombre de tu hotspot>
PASSWORD <clave del hotspot>
URL https://<host-del-backend>/api/v1
TOKEN <token individual creado por el backend>
BEGIN_CA
<certificado PEM público de la CA confiable, completo y con sus delimitadores>
END_CA
```

Los textos entre ángulos son marcadores: no enviarlos literalmente. El PEM incluye `-----BEGIN CERTIFICATE-----` y `-----END CERTIFICATE-----`. La herramienta responde STORED tras verificar cada escritura. Puede almacenar varios certificados PEM hasta8KB. No imprime secretos, pero el monitor del ordenador puede conservar el texto introducido: usar un equipo confiable, no compartir capturas y cerrar el monitor al terminar. No es un portal Wi-Fi abierto.

Namespace `agro-wifi`: ssid/password. Namespace `agro-api`: url/token/ca. La CA es pública; verificar su procedencia antes de aprovisionarla. No usar el certificado arbitrario de un host sin validar identidad. NVS no está cifrada en esta fase. Después cargar de nuevo AgroControl: ambos sketches conservan los mismos namespaces. No cambiar ni borrar `agro-state/monitor-v2` para resolver problemas de red: contiene anti-repetición. Si NVS está corrupta se mantiene inhibición y se requiere diagnóstico/migración local; esta entrega no incluye una orden para borrarla.

## Conexión y prueba sin bomba

1. Hotspot compatible2.4GHz, permitiendo SNTP/UDP123 y HTTPS. Falta de conectividad no detiene el muestreo.
2. URL HTTPS de Claude y token individual; falta conocer la URL final y CA. No se contactó un backend real durante esta entrega.
3. Tras SNTP se valida cadena/host y cada certificado presentado por fecha. El core3.3.12 inspeccionado no tiene CONFIG_MBEDTLS_HAVE_TIME_DATE y conserva certificados pares: se usa **VERIFICADOR**, antes de escribir bytes HTTP. Sin certificado disponible o sin UTC no hay sesión API.
4. Cada conexión nueva consulta `/api/v1/salud` sin token. Solo si el desfase es <=30s envía Authorization y X-Id-Arranque por esa conexión. No sigue3xx, no utiliza HTTP ni setInsecure.
5. Confirmar en backend hardware_confirmado=false, bomba APAGADA, versión1.0.2 y lectura calibrada. Comprobar HTTP200 por serie sin imprimir cuerpos ni tokens.
6. Enviar OFF: esperar ACK EJECUTADA/SIN_CAMBIO. Para ensayar ON que un backend correcto rechazará por hardware no confirmado, usar el fixture negativo aislado; esperar HARDWARE_NO_CONFIRMADO, nunca un encendido simulado como exitoso.
7. Desactivar/reanudar hotspot y reiniciar por USB: comprobar conservación de ACK/marca de agua y ausencia de escrituras GPIO26. Estas son pruebas pendientes en el ESP32 físico, no resultados ya aprobados.

La comunicación utiliza timeout de conexión5s/respuesta8s, backoff2..60s con jitter, Retry-After y pausa mínima60s ante401/403. Las respuestas inválidas se acotan/rechazan. ACK400/422 quedan en cuarentena persistente sin reciclarse como confirmados. Los búferes RAM pueden perder muestras/eventos al reiniciar; los ACK NVS se conservan.

Ver `INTEGRACION_API.md` para alcance y limitaciones; `../tests/firmware/README.md` para repetir pruebas.

Referencias técnicas: [ADC Arduino ESP32](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html) y [cliente TLS de Espressif](https://github.com/espressif/arduino-esp32/blob/master/libraries/NetworkClientSecure/src/NetworkClientSecure.h). La evidencia de compilación corresponde al core local3.3.12, no a la rama master.
