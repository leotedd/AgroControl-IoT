# Contrato API IoT — AgroControl IoT

| Campo | Valor |
|---|---|
| Versión del contrato | **1.0.1**: corrección de 1.0.0, **pendiente de validación por Codex** antes de implementarse |
| Fecha | 2026-10-15 |
| Prefijo base | `https://<HOST>/api/v1` |
| Consumidores | Firmware ESP32 (Codex), Frontend web (Claude) |
| Proveedor | Backend Node.js + Express (Claude) |

> Este documento es la **fuente de verdad** de la integración entre el firmware ESP32 y el backend.
> Ningún lado cambia nombres de campos, rutas, códigos o semántica sin incrementar la versión y registrar
> el cambio en la sección [16](#16-historial-de-cambios). Este archivo lo mantiene Claude; las propuestas de
> Codex se canalizan por `firmware-esp32/INTEGRACION_API.md` y se incorporan en una nueva versión.
>
> - Adaptaciones que el firmware debe realizar: [Anexo A](#anexo-a--adaptaciones-requeridas-en-el-firmware-codex).
> - Casos de aceptación compartidos: [Anexo B](#anexo-b--casos-de-aceptación-compartidos).
> - Versiones anteriores: `documentacion/historial/`.

**Aprobación:** el responsable del proyecto aprobó el 2026-10-15: (1) encendido manual sólo en `MANUAL`, con sensor válido, sin bloqueos y dentro de límites, y apagado siempre permitido; (2) tres modos `DESHABILITADO` / `MANUAL` / `AUTOMATICO`, y apagar no reactiva otro modo; (3) ids numéricos de orden ≤ 2^53 − 1; (4) `duracion_s` por orden sin ampliar el máximo del ESP32; (5) valores conservadores de banco de Codex, configurables y no agronómicos.

**Estado de aprobación y conformidad:** el responsable aprobó la 1.0.0. La 1.0.1 está pendiente de validación por Codex. Ni el backend ni el firmware son conformes todavía: no existe implementación ni prueba integrada. La conformidad se declara con el Anexo B.

**1.0.1** resuelve las ambigüedades P0/P1 del diagnóstico de Codex (`firmware-esp32/INTEGRACION_API.md` §5):
- Vigencia TLS sin `MBEDTLS_HAVE_TIME_DATE` (4.1).
- Política definitiva de rearme (10.5).
- Invalidación de encendidos en cola ante un APAGAR (8.3).
- ACK históricos y tardíos (7.3).
- APAGAR repetido frente a ACK inmutable (7.3, 8.3).
- Presupuesto temporal de caducidad (4.2).
- Alcance del fallo seguro por reloj (principio 7).
- Corte de respaldo (10.7).
- Primera muestra del sensor (10.4).

Los cambios se detallan en la sección 16.

---

## Índice

1. [Principios](#1-principios)
2. [Convenciones generales](#2-convenciones-generales)
3. [Identificadores y vocabulario](#3-identificadores-y-vocabulario)
4. [Transporte seguro, hora y aprovisionamiento](#4-transporte-seguro-hora-y-aprovisionamiento)
5. [Autenticación](#5-autenticación)
6. [Flujo de comunicación del dispositivo](#6-flujo-de-comunicación-del-dispositivo)
7. [Endpoints del dispositivo (`/iot`)](#7-endpoints-del-dispositivo-iot)
8. [Órdenes: ciclo de vida, prioridad, persistencia e idempotencia](#8-órdenes-ciclo-de-vida-prioridad-persistencia-e-idempotencia)
9. [Modos, configuración y sincronización de estado](#9-modos-configuración-y-sincronización-de-estado)
10. [Reglas de seguridad del firmware](#10-reglas-de-seguridad-del-firmware)
11. [Endpoints de usuario (plataforma web)](#11-endpoints-de-usuario-plataforma-web)
12. [Formato de errores y códigos](#12-formato-de-errores-y-códigos)
13. [Medidas de seguridad](#13-medidas-de-seguridad)
14. [Límites y cuotas](#14-límites-y-cuotas)
15. [Ejemplos de prueba con curl](#15-ejemplos-de-prueba-con-curl)
16. [Historial de cambios](#16-historial-de-cambios)
- [Anexo A — Adaptaciones requeridas en el firmware (Codex)](#anexo-a--adaptaciones-requeridas-en-el-firmware-codex)
- [Anexo B — Casos de aceptación compartidos](#anexo-b--casos-de-aceptación-compartidos)

---

## 1. Principios

1. **El ESP32 siempre inicia la comunicación** (modelo *pull* por HTTPS). El servidor nunca abre conexiones hacia el dispositivo.
2. **La seguridad física la decide el ESP32.** El servidor propone órdenes y configuración, y el firmware valida localmente cada una y puede rechazarla. Ninguna regla de seguridad depende de la red ni del servidor.
3. **El control automático vive en el ESP32** y sigue funcionando sin Internet.
4. **Estado deseado frente a órdenes.**
   - Lo que debe persistir (modo, umbrales, tiempos, calibración) es **configuración versionada**.
   - Las acciones puntuales (regar N s, apagar, rearmar) son **órdenes** con caducidad y confirmación.
5. **APAGAR siempre gana.** Un apagado autenticado se ejecuta en cualquier modo y estado, y anula los encendidos obsoletos.
6. **Ninguna orden ni configuración prolonga un riego** más allá de los límites del ESP32 (`riego_max_s` y el tope compilado).
7. **Fallo seguro.**
   - Un reinicio, un sensor inválido o caducado, datos corruptos, un fallo de persistencia o el disparo del corte de respaldo **apagan la bomba** y bloquean según 10.5.
   - Una orden dudosa (mal formada, caducada, duplicada o anulada) se **rechaza** sin encender.
   - Un **reloj no confiable** o la **falta de red no apagan ni bloquean por sí solos**: impiden nuevos encendidos y rearmes remotos. El `AUTOMATICO` local ya habilitado y los riegos en curso continúan con temporizadores monotónicos, que el reloj UTC no puede prolongar.
8. **Como máximo un intento de encendido por orden.** El resultado puede quedar incierto ante un corte de energía, pero el encendido nunca se repite.
9. **Sólo HTTPS con verificación de certificados.** No hay excepciones de laboratorio.

---

## 2. Convenciones generales

| Aspecto | Convención |
|---|---|
| Transporte | **Exclusivamente HTTPS** (TLS 1.2+) con validación de cadena y nombre de host (sección 4) |
| Formato | JSON UTF-8, `Content-Type: application/json` |
| Nombres de campos | `snake_case`, en español, sin tildes ni `ñ` |
| Enumeraciones | `MAYUSCULAS_CON_GUION_BAJO` |
| Fechas | ISO-8601 en **UTC** con `Z`: `2026-10-15T20:31:05Z` (milisegundos opcionales) |
| Enteros | Rango seguro de JavaScript: 0 ≤ n ≤ 2^53 − 1 (9 007 199 254 740 991). El firmware usa `uint64_t` y rechaza valores mayores |
| Porcentajes | Decimal 0.0–100.0, máximo 1 decimal |
| Duraciones | Enteros en segundos (`_s`) o milisegundos (`_ms`) |
| Respuesta exitosa | `{ "data": { ... } }` |
| Respuesta de error | `{ "error": { "codigo", "mensaje", "detalles?" }, "id_solicitud" }` |
| Trazabilidad | `X-Request-Id` en todas las respuestas |
| Caché | Todas las respuestas `/iot` llevan `Cache-Control: no-store` |
| Compatibilidad | Campos desconocidos: el servidor los **ignora** y el firmware también. Enumeraciones *reportadas* desconocidas: el servidor las **almacena sin rechazar**. Órdenes de `tipo` desconocido: el firmware las **rechaza** (`TIPO_DESCONOCIDO`) |
| Versión | Versión mayor en la ruta (`/api/v1`). El firmware informa `version_contrato` en la telemetría |

---

## 3. Identificadores y vocabulario

| Concepto | Identificador | Ejemplo | Notas |
|---|---|---|---|
| Dispositivo | `uid` | `AGC-ESP32-0001` | Único global. El servidor lo deduce del token |
| Sensor | `codigo` | `HUM1` | Único dentro del dispositivo. `^[A-Z0-9_]{2,16}$` |
| Actuador | `codigo` | `BOMBA1` | Único dentro del dispositivo. `^[A-Z0-9_]{2,16}$` |
| Orden | `id` (entero) | `1287` | Generado por el servidor, inmutable, único global, 1 ≤ id ≤ 2^53 − 1. **Estrictamente creciente por dispositivo en el orden de creación** (8.2) |
| Arranque | `id_arranque` | `9f3a12c0` | 8 caracteres hex en minúscula, aleatorios (`esp_random()`) en cada encendido |
| Secuencia | `seq` | `1042` | Entero creciente dentro del arranque, compartido por lecturas y eventos |
| Uptime | `uptime_ms` | `3600123` | Milisegundos monotónicos desde el arranque, **64 bits** (`esp_timer_get_time()/1000`, no `millis()`) |

Prototipo: dispositivo `AGC-ESP32-0001`, sensor `HUM1` (capacitivo D43, GPIO34/ADC1) y actuador `BOMBA1` (relé en GPIO26, activo en bajo), según el `Settings.h` de Codex y pendiente de confirmar la placa. El contrato admite N sensores y N actuadores.

### Enumeraciones

| Enumeración | Valores |
|---|---|
| `modo` | `DESHABILITADO`, `MANUAL`, `AUTOMATICO` (mismos valores para el modo deseado y el efectivo) |
| `estado_bomba` | `APAGADA`, `RIEGO_MANUAL`, `RIEGO_AUTOMATICO` |
| `tipo_bloqueo` | `CRITICO`, `PREVENTIVO` |
| `causa_bloqueo` | Ver 10.5 |
| `estado_lectura` | `OK`, `FUERA_DE_RANGO`, `ERROR_SENSOR`, `SIN_CALIBRAR` |
| `tipo_orden` | `BOMBA_ENCENDER`, `BOMBA_APAGAR`, `RESTABLECER_BLOQUEO` |
| `estado_orden` | `PENDIENTE`, `ENTREGADA`, `EJECUTADA`, `RECHAZADA`, `FALLIDA`, `EXPIRADA`, `CANCELADA`, `SIN_CONFIRMAR` |
| `resultado_orden` | `EJECUTADA`, `RECHAZADA`, `FALLIDA` |
| `motivo_fin_riego` | `UMBRAL_ALCANZADO`, `DURACION_CUMPLIDA`, `TIEMPO_MAXIMO`, `ORDEN_APAGAR`, `CAMBIO_MODO`, `CONFIG_ACTUALIZADA`, `FALLA_SENSOR`, `SENSOR_CADUCADO`, `FALLA_CRITICA`, `TOPE_ABSOLUTO` (+ `REINICIO`, que sólo asigna el servidor) |

---

## 4. Transporte seguro, hora y aprovisionamiento

### 4.1 HTTPS obligatorio

- El firmware sólo se comunica por `https://`. Quedan **prohibidos** `http://`, `setInsecure()`, aceptar certificados arbitrarios o cualquier respaldo inseguro, también en laboratorio. No hay indicadores de compilación que permitan saltarlo.
- Es obligatorio verificar la **cadena de certificados** hasta una CA confiable y el **nombre de host**:
  - Recomendado: el paquete de CA raíz del núcleo ESP32 (`esp_crt_bundle` / `WiFiClientSecure::setCACertBundle`), que cubre Cloudflare Tunnel, ngrok y Let's Encrypt.
  - Alternativa: CA raíz explícitas (`setCACert`). No se fijan certificados *hoja*, porque caducan en 60–90 días.
  - Para un servidor de pruebas propio: CA de pruebas instalada explícitamente en el firmware y nombre de host correcto.
- **Vigencia del certificado: es obligatoria, no basta con documentarla.** Se cumple por **una** de estas dos vías, y el firmware informa cuál usa en `seguridad.tls_vigencia` (`MBEDTLS` o `VERIFICADOR`):
  - **Vía A, mbedTLS:** el núcleo está compilado con `MBEDTLS_HAVE_TIME_DATE` activo. mbedTLS rechaza en el *handshake* los certificados fuera de `notBefore`/`notAfter` usando el UTC del sistema.
  - **Vía B, verificador posterior al *handshake*:** si el núcleo no tiene esa opción, el firmware actúa tras completar el *handshake* y **antes de escribir ningún byte de aplicación**:
    1. Obtiene la cadena que presenta el servidor (`WiFiClientSecure::getPeerCertificate()` o `mbedtls_ssl_get_peer_cert()`, recorriendo `next`).
    2. Comprueba en **cada** certificado recibido que `valid_from ≤ UTC_local ≤ valid_to`.
    3. Si alguno falla, cierra la conexión sin enviar nada y cuenta `errores_tls`.
  - En ambas vías se usa el UTC de SNTP (4.2, punto 2). Sin UTC no se abre ninguna conexión.
  - Las raíces del paquete de CA del núcleo son anclas de confianza: no se verifican por fecha y se actualizan con el núcleo.
  - Si el núcleo elegido no permite ninguna de las dos vías, **no se habilita la comunicación**: F-16 queda no conforme y no se admite ninguna degradación.
- **Sin redirecciones:** el cliente HTTP no sigue redirecciones. Un `3xx` se trata como error, para no reenviar el token a otro host.
- Si la verificación TLS falla, no se envía ningún dato ni token, se cuenta el error y se reintenta con *backoff*. El control local continúa.
- El backend rechaza cualquier solicitud `/iot` que no haya llegado por HTTPS con `403 HTTPS_REQUERIDO`. Lo evalúa con `X-Forwarded-Proto`, emitido por un túnel o proxy de confianza. El tramo interno proxy→backend debe estar en la misma máquina o en una red aislada.
- Antes de aprobar la integración física hay que ensayar que se rechazan un certificado caducado o de otro host y una CA no confiable (Anexo B).

### 4.2 Hora (SNTP + verificación cruzada + plazos monotónicos)

1. Tras conectar al Wi-Fi, el firmware sincroniza UTC por **SNTP** (`pool.ntp.org`, `time.google.com`, `time.cloudflare.com`) **antes** de cualquier solicitud HTTPS. Sin sincronización SNTP no hay comunicación con la API; el control local sigue activo.
2. La hora es **provisionalmente válida** cuando SNTP confirma la sincronización y el año es ≥ 2026. Se resincroniza cada ≤ 1 h.
3. **Verificación cruzada antes de enviar el token:**
   1. En cada conexión TLS nueva, tras el *handshake* y la verificación de vigencia (4.1), la primera solicitud es `GET /api/v1/salud` **sin** cabecera `Authorization`.
   2. El firmware compara su `hora_servidor` con el UTC local. Si |Δ| ≤ **30 s**, el reloj pasa a **confiable** y sólo entonces se envían por esa conexión solicitudes con token.
   3. Si |Δ| > 30 s, cierra la conexión **sin enviar el token**, marca el reloj como no confiable, fuerza una resincronización SNTP y reintenta con *backoff*.
   4. Con la conexión abierta, cada respuesta `/iot` vuelve a compararse. Una discrepancia > 30 s invalida el reloj y cierra la conexión.
   5. `hora_servidor` nunca establece el reloj; sólo lo valida.
   6. Con el reloj no confiable se rechazan `BOMBA_ENCENDER` y `RESTABLECER_BLOQUEO` (`RELOJ_NO_CONFIABLE`). El control local sigue según el principio 7.
4. **Plazo monotónico de la orden (cota conservadora):**
   - `plazo_mono = uptime_ms_envio + (expira_en − hora_servidor)`, en milisegundos. `uptime_ms_envio` es el uptime **al enviar** el `GET /iot/ordenes` que trajo la orden, no al recibir la respuesta. Como el servidor genera `hora_servidor` después de ese envío, la cota descuenta el tránsito y nunca sobreestima la vigencia.
   - Si `expira_en − hora_servidor ≤ 0`, la orden no es vigente.
   - Si la misma orden llega de nuevo, se conserva el **menor** `plazo_mono` ya calculado. La vigencia nunca se amplía.
   - **Vigente** ⇔ reloj confiable **y** `UTC_local < expira_en` **y** `uptime_ms < plazo_mono`. Se comprueba al desencolar, tras escribir `INTENCION` e **inmediatamente antes** del GPIO.
   - Un salto SNTP posterior puede acortar la vigencia (condición UTC), pero nunca ampliarla (condición monotónica).
5. Los temporizadores de riego, descanso y caducidad del sensor usan **siempre** el reloj monotónico. Un cambio de UTC nunca alarga un riego.
6. **Riesgo residual documentado:** SNTP no está autenticado. La verificación de cadena y de host no depende de la hora, y la verificación cruzada limita el desvío a 30 s una vez establecida la sesión. Si se requiere más garantía, la fase 3 contempla un RTC validado o NTS.

### 4.3 Aprovisionamiento de Wi-Fi, URL y token

| Dato | NVS namespace | Clave |
|---|---|---|
| SSID Wi-Fi | `agro-wifi` | `ssid` (ya implementado por Codex) |
| Contraseña Wi-Fi | `agro-wifi` | `password` (ya implementado por Codex) |
| URL base de la API | `agro-api` | `url`, p. ej. `https://agro.ejemplo.com/api/v1` |
| Token del dispositivo | `agro-api` | `token` |

Reglas:
1. **Nunca** en el código fuente ni en el repositorio. `secrets.h` sigue en `.gitignore` por si una herramienta local lo usa.
2. Sólo se cargan **con acceso físico** (puerto USB serie o herramienta local de escritura de NVS). Quedan prohibidos los portales Wi-Fi abiertos y cualquier canal remoto de aprovisionamiento.
3. El firmware **nunca imprime** la contraseña ni el token. Como mucho muestra los 12 primeros caracteres del token (`agc_dev_XXXX`).
4. La URL debe empezar por `https://`. Si no, no hay comunicación y se reporta por serie `URL_NO_HTTPS`.
5. Si falta cualquiera de los cuatro datos, el control local sigue activo y no hay comunicación.
6. Hay que borrar el aprovisionamiento antes de entregar o desechar un dispositivo. NVS sin cifrar no protege en reposo; el cifrado de NVS y de flash queda para la fase 3.
7. La URL de un túnel rápido de Cloudflare cambia en cada reinicio. Para pruebas repetidas conviene un túnel con nombre o dominio fijo, o un dominio estático de ngrok.

---

## 5. Autenticación

### 5.1 Dispositivos (ESP32)

- Token propio por dispositivo: `agc_dev_` + 43 caracteres base64url (256 bits aleatorios).
- Cabeceras **obligatorias** en todas las solicitudes `/iot`:

```http
Authorization: Bearer agc_dev_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
X-Id-Arranque: 9f3a12c0
```

- El servidor guarda sólo el **SHA-256** del token y su prefijo de 12 caracteres. El token completo se muestra **una vez**, al crearlo o rotarlo.
- **Rotación:** crea un token nuevo y el anterior sigue válido durante un **periodo de gracia de 24 h** (configurable entre 0 y 72 h), para poder reaprovisionar. El primer uso del token nuevo invalida el anterior.
- **Revocación** inmediata: `401 TOKEN_DISPOSITIVO_INVALIDO`. **Deshabilitar** el dispositivo: `403 DISPOSITIVO_DESHABILITADO`.
- El token nunca se vuelve a transmitir por la API después de crearse.
- Un dispositivo sólo accede a **sus propias** órdenes, configuración, sensores y actuadores. Ningún campo JSON (p. ej. `authorized`) sustituye a la autenticación: la autorización del núcleo de control la decide el adaptador tras la autenticación TLS + token.

### 5.2 Usuarios (plataforma web)

- `POST /auth/login` devuelve un JWT de acceso (15 min) en el cuerpo y un token de refresco (7 días, rotativo y con detección de reutilización) en la cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
- Contraseñas con bcrypt (costo 12).
- Rol global `ADMIN` / `USUARIO` y permisos por terreno:

| Rol en terreno | Ver | Encender / apagar / rearmar | Cambiar modo y configuración | Administrar terreno, dispositivos, miembros |
|---|:-:|:-:|:-:|:-:|
| `LECTOR` | ✅ | ❌ | ❌ | ❌ |
| `OPERADOR` | ✅ | ✅ | ✅ | ❌ |
| `PROPIETARIO` | ✅ | ✅ | ✅ | ✅ |
| `ADMIN` (global) | ✅ | ✅ | ✅ | ✅ + usuarios |

---

## 6. Flujo de comunicación del dispositivo

```
 ESP32 · tarea de red                                          Backend
   │ Wi-Fi ⇒ SNTP ⇒ TLS verificado (conexión keep-alive)          │
   │──(1) GET /iot/configuracion ────────────────────────────────►│
   │◄─────────────── config vN (o 304) ───────────────────────────│
   │──(2) POST /iot/configuracion/confirmacion ──────────────────►│
   │                                                              │
   │  ┌── cada intervalo_ordenes_s (3 s) ──────────────────┐      │
   │──(3) GET /iot/ordenes ──────────────────────────────────────►│
   │◄── { ordenes:[≤1 por actuador], config_version, hora } ──────│
   │  │ config distinta ⇒ (1) y (2)                        │      │
   │  │ orden ⇒ diario NVS ⇒ cola a la tarea de control ⇒  │      │
   │──(4) POST /iot/ordenes/{id}/confirmacion ───────────────────►│
   │  └────────────────────────────────────────────────────┘      │
   │  ┌── cada intervalo_telemetria_s (10 s) ──────────────┐      │
   │──(5) POST /iot/telemetria ──────────────────────────────────►│
   │  └────────────────────────────────────────────────────┘      │
   │──(6) POST /iot/eventos (al ocurrir / al reconectar) ────────►│
```

- **Latencia esperada** de la web a la bomba: ≤ `intervalo_ordenes_s` + RTT (unos 3–5 s). Si la telemetría responde `ordenes_pendientes > 0`, el firmware consulta órdenes de inmediato.
- Se usa una única conexión TLS persistente (*keep-alive*).
- **Presencia:** cualquier solicitud `/iot` autenticada actualiza `ultima_conexion_en`.
  - `EN_LINEA`: ≤ 30 s.
  - `INESTABLE`: entre 30 y 120 s.
  - `FUERA_DE_LINEA`: más de 120 s; genera la alerta `DISPOSITIVO_FUERA_DE_LINEA`.
- **Reinicio:** si `X-Id-Arranque` difiere del último conocido, se aplica 8.5.

---

## 7. Endpoints del dispositivo (`/iot`)

Todos requieren `Authorization` y `X-Id-Arranque`. El cuerpo admite como máximo **16 KB**.

| # | Método | Ruta | Propósito |
|---|---|---|---|
| 7.1 | `POST` | `/api/v1/iot/telemetria` | Humedad y estado real |
| 7.2 | `GET` | `/api/v1/iot/ordenes` | Órdenes vigentes y versión de configuración |
| 7.3 | `POST` | `/api/v1/iot/ordenes/{id}/confirmacion` | Resultado de una orden |
| 7.4 | `GET` | `/api/v1/iot/configuracion` | Configuración deseada |
| 7.5 | `POST` | `/api/v1/iot/configuracion/confirmacion` | Aplicación o rechazo de la configuración |
| 7.6 | `POST` | `/api/v1/iot/eventos` | Eventos locales |

### Objeto común `estado_actuador`

```json
{
  "actuador": "BOMBA1",
  "modo": "MANUAL",
  "estado_bomba": "RIEGO_MANUAL",
  "riego_transcurrido_s": 4,
  "riego_restante_s": 6,
  "descanso_restante_s": 0,
  "bloqueo": null,
  "id_orden_activa": 1287,
  "uptime_ms": 3601200
}
```

| Campo | Tipo | Reglas |
|---|---|---|
| `modo` | enum | Modo **efectivo** en el ESP32 |
| `estado_bomba` | enum | Estado **lógico real** ordenado al relé. Sin realimentación no demuestra caudal ni el estado físico de los contactos |
| `riego_transcurrido_s` / `riego_restante_s` | entero | 0 si `APAGADA` |
| `descanso_restante_s` | entero | Segundos hasta permitir otro arranque |
| `bloqueo` | `null` \| `{ "id_bloqueo", "tipo", "causa", "desde_id_arranque", "desde_uptime_ms", "desde_ts", "liberable_remotamente" }` | Persistido en NVS junto con el bloqueo. `id_bloqueo` es un contador persistente y creciente que nunca se reutiliza (10.5). Ver la nota sobre el instante del bloqueo |

**Instante del bloqueo.** Un bloqueo sobrevive a los reinicios, así que su inicio se identifica con el **arranque en que se activó**:
- `desde_id_arranque` (8 hex) y `desde_uptime_ms` son el arranque y el uptime de ese momento. Se persisten en NVS con el bloqueo y **no cambian** tras un reinicio: `desde_uptime_ms` sigue refiriéndose a `desde_id_arranque`, no al arranque actual.
- `desde_ts` es la hora UTC de activación si el reloj era confiable, o `null` en caso contrario.
- El servidor:
  - Calcula el `bloqueado_desde` que muestra así: usa `desde_ts` si existe. Si no, y `desde_id_arranque` es el arranque actual, usa `reportado_en − (uptime_ms − desde_uptime_ms)` y lo marca como estimado. Si no, usa el `ocurrido_en` del evento `BLOQUEO_ACTIVADO` con el mismo `id_bloqueo`, o la muestra como desconocida.
  - **Nunca** resta uptimes de arranques distintos.
| `id_orden_activa` | entero \| null | `BOMBA_ENCENDER` que originó el riego en curso |
| `uptime_ms` | entero | Momento del estado. Con `id_arranque`, permite al servidor **descartar estados más antiguos** que el último guardado |

### 7.1 `POST /iot/telemetria`

Se envía cada `intervalo_telemetria_s`. Tras una desconexión incluye lecturas del búfer, como máximo **30 por solicitud** y las más antiguas primero.

```json
{
  "id_arranque": "9f3a12c0",
  "uptime_ms": 3600123,
  "ts": "2026-10-15T20:31:05Z",
  "version_firmware": "0.2.0",
  "version_contrato": "1.0.1",
  "config_version": 4,
  "seguridad": {
    "hardware_confirmado": true,
    "calibracion_confirmada": true,
    "tope_riego_s": 600,
    "max_id_orden_procesada": 1287,
    "reloj_confiable": true,
    "persistencia_ok": true,
    "tls_vigencia": "VERIFICADOR"
  },
  "red": { "rssi_dbm": -61, "ip_local": "192.168.43.21" },
  "diagnostico": {
    "lecturas_descartadas": 0,
    "eventos_descartados": 0,
    "reconexiones_wifi": 2,
    "errores_api": 1,
    "errores_tls": 0
  },
  "lecturas": [
    {
      "seq": 1042,
      "sensor": "HUM1",
      "tipo": "HUMEDAD_SUELO",
      "valor_pct": 42.5,
      "valor_raw": 1873,
      "estado": "OK",
      "ts": "2026-10-15T20:31:04Z",
      "uptime_ms": 3599100
    }
  ],
  "actuadores": [ { "...": "estado_actuador" } ]
}
```

| Campo | Oblig. | Reglas |
|---|:-:|---|
| `id_arranque` | ✅ | Igual a `X-Id-Arranque`; si no coincide, `422 ARRANQUE_NO_COINCIDE` |
| `uptime_ms` | ✅ | Al enviar |
| `ts` | ✅ | UTC (siempre existe, porque sin SNTP no hay HTTPS) |
| `version_firmware` / `version_contrato` | ✅ | SemVer de ≤ 16 caracteres / versión del contrato que implementa el firmware: `1.0.1`. El servidor acepta cualquier `1.x.y`. Si es distinta de la vigente, la registra y la muestra en el panel; si la versión mayor es distinta, responde `422 VALIDACION_FALLIDA` |
| `config_version` | ✅ | Versión **aplicada** (0 = valores por defecto compilados) |
| `seguridad.hardware_confirmado` | ✅ | Barrera de compilación `hardwareConfirmed` |
| `seguridad.calibracion_confirmada` | ✅ | Calibración efectiva (todos los sensores de control) |
| `seguridad.tope_riego_s` | ✅ | `TOPE_ABSOLUTO_RIEGO_S` compilado (1–600). El servidor no configura `riego_max_s` por encima de este valor |
| `seguridad.max_id_orden_procesada` | ✅ | Marca de agua persistente (8.4) |
| `seguridad.reloj_confiable` / `persistencia_ok` | ✅ | Estado de 4.2 y del diario NVS |
| `seguridad.tls_vigencia` | ✅ | `MBEDTLS` o `VERIFICADOR` (4.1) |
| `red.*`, `diagnostico.*` | ❌ | Contadores acumulados desde el arranque |
| `lecturas[]` | ✅ | 0–30. Deduplicación por (`sensor`, `id_arranque`, `seq`) |
| `lecturas[].valor_pct` | ✅ | 0.0–100.0, o `null` si `estado` ≠ `OK` |
| `lecturas[].valor_raw` | ✅ | ADC mediano (0–4095) o `null` |
| `lecturas[].ts` | ❌ | `null` si se midió antes de la sincronización SNTP |
| `lecturas[].uptime_ms` | ✅ | Uptime al medir |
| `actuadores[]` | ✅ | Un `estado_actuador` por actuador |

Hora de la lectura: se usa `lecturas[].ts` si es válida y está a menos de 24 h de la hora del servidor. Si no, `medido_en = recibido_en − (uptime_ms_envio − lecturas[].uptime_ms)` y `hora_estimada = true`.

**Respuesta `200 OK`**

```json
{
  "data": {
    "recibidas": 1,
    "duplicadas": 0,
    "descartadas": [],
    "config_version": 5,
    "ordenes_pendientes": 1,
    "hora_servidor": "2026-10-15T20:31:05.412Z"
  }
}
```

- `descartadas`: `[{ "seq": n, "codigo": "SENSOR_DESCONOCIDO" }]`. Una lectura inválida no invalida el lote.
- Errores: `400 JSON_INVALIDO`, `401`, `403`, `413`, `422 VALIDACION_FALLIDA`, `429`.

### 7.2 `GET /iot/ordenes`

Se consulta cada `intervalo_ordenes_s`.

```json
{
  "data": {
    "ordenes": [
      {
        "id": 1287,
        "tipo": "BOMBA_ENCENDER",
        "actuador": "BOMBA1",
        "parametros": { "duracion_s": 10 },
        "creada_en": "2026-10-15T20:31:00Z",
        "expira_en": "2026-10-15T20:31:30Z"
      }
    ],
    "config_version": 5,
    "hora_servidor": "2026-10-15T20:31:03.120Z"
  }
}
```

Reglas del servidor (sección 8):
- Como máximo **una orden por actuador**, ordenadas por `id` ascendente.
- Nunca entrega órdenes con `expira_en` ≤ hora del servidor.
- La entrega es una transacción: marca la orden `ENTREGADA` y guarda `id_arranque_entrega` y `entregada_en`.
- Una orden `ENTREGADA` sin confirmar se **reentrega** sólo al **mismo** `id_arranque` y mientras siga vigente.
- Siempre responde `200`; si no hay órdenes, la lista va vacía.

| `tipo` | `parametros` | TTL por defecto (rango) |
|---|---|---|
| `BOMBA_ENCENDER` | `{ "duracion_s": 1..600 }`, obligatorio | 30 s (10–60) |
| `BOMBA_APAGAR` | `{}` | 300 s (30–900) |
| `RESTABLECER_BLOQUEO` | `{ "id_bloqueo": n, "causa": "…", "inspeccion_confirmada": bool }`, todos obligatorios (10.5) | 60 s (10–300) |

`expira_en` es el límite para **iniciar** un encendido o un rearme. No limita la confirmación ni la duración del riego. Para `BOMBA_APAGAR` es sólo informativo, porque el apagado se ejecuta igualmente (8.3).

### 7.3 `POST /iot/ordenes/{id}/confirmacion`

```json
{
  "resultado": "EJECUTADA",
  "codigo_motivo": "DURACION_RECORTADA",
  "mensaje": null,
  "duracion_aplicada_s": 15,
  "ejecutada_en": "2026-10-15T20:31:03Z",
  "id_arranque_origen": "9f3a12c0",
  "uptime_ms": 3601200,
  "config_version": 5,
  "estado_actuador": { "...": "estado_actuador tras procesar la orden" }
}
```

| Campo | Oblig. | Reglas |
|---|:-:|---|
| `id_arranque_origen` | ✅ | Arranque en que se **generó** este ACK (cuando se escribió `FINAL`). Puede diferir de `X-Id-Arranque` si se reenvía tras un reinicio. `uptime_ms` y `estado_actuador.uptime_ms` pertenecen a este arranque |
| `config_version` | ✅ | Versión de configuración aplicada al procesar. Es informativa: no dispara la reconciliación (9.3) |
| `resultado` | ✅ | `EJECUTADA`, `RECHAZADA`, `FALLIDA` |
| `codigo_motivo` | ✅ si ≠ `EJECUTADA` | Tabla 7.3.1; con `EJECUTADA` puede ser `DURACION_RECORTADA`, `SIN_CAMBIO` o `null` |
| `duracion_aplicada_s` | ✅ | En `BOMBA_ENCENDER` ejecutada: 1–600, el mínimo de 10.2. En los demás casos, `null`. No cambia en los reintentos |
| `mensaje` | ❌ | ≤ 200 caracteres |
| `ejecutada_en` | ✅ | UTC, o `null` si se resolvió tras un reinicio sin hora |
| `uptime_ms` | ✅ | Uptime al procesar, del arranque `id_arranque_origen` |
| `estado_actuador` | ✅ | Estado **histórico** justo después de procesar; no describe necesariamente el estado actual |

Significado del resultado:
- `EJECUTADA`: se aplicó el mando lógico. En `BOMBA_ENCENDER` confirma el **inicio**; el final llega con el evento `RIEGO_FINALIZADO`.
- `RECHAZADA`: no se inició la acción. El actuador no cambió por esta orden.
- `FALLIDA`: hubo un fallo detectado o el resultado es incierto tras un reinicio. Nunca se reintenta la activación.

#### 7.3.1 Códigos de motivo

| Código | Resultado | Cuándo |
|---|---|---|
| `DURACION_RECORTADA` | `EJECUTADA` | `duracion_s` superaba `riego_max_s` o el tope compilado y se recortó |
| `SIN_CAMBIO` | `EJECUTADA` | `BOMBA_APAGAR` con la bomba ya apagada |
| `MODO_INCORRECTO` | `RECHAZADA` | `BOMBA_ENCENDER` con un modo efectivo distinto de `MANUAL` |
| `BLOQUEO_SEGURIDAD` | `RECHAZADA` | Hay algún bloqueo activo |
| `SENSOR_INVALIDO` | `RECHAZADA` | Lectura no válida, no finita, sin calibrar o con ≥ 3000 ms de antigüedad |
| `HUMEDAD_SUFICIENTE` | `RECHAZADA` | Humedad ≥ `umbral_parada_pct` |
| `DESCANSO_ACTIVO` | `RECHAZADA` | No se ha cumplido `descanso_min_s` |
| `ACTUADOR_OCUPADO` | `RECHAZADA` | Ya hay un riego en curso; un encendido nuevo no lo prolonga |
| `HARDWARE_NO_CONFIRMADO` | `RECHAZADA` | `hardwareConfirmed = false` |
| `ORDEN_CADUCADA` | `RECHAZADA` | Vigencia vencida (4.2, punto 4) al comprobarla justo antes de actuar |
| `RELOJ_NO_CONFIABLE` | `RECHAZADA` | El reloj no es confiable (4.2) |
| `ORDEN_DUPLICADA` | `RECHAZADA` | `id` ≤ marca de agua y sin registro en el diario |
| `ID_REUTILIZADO` | `RECHAZADA` | `id` conocido con contenido distinto. No reemplaza el resultado original |
| `ORDEN_EN_LOTE_CON_APAGAR` | `RECHAZADA` | Encendido recibido en la misma respuesta que un `BOMBA_APAGAR` del mismo actuador |
| `ANULADA_POR_APAGAR` | `RECHAZADA` | `BOMBA_ENCENDER` o `RESTABLECER_BLOQUEO` con `id` < barrera de apagado del actuador (8.3) |
| `BLOQUEO_NO_COINCIDE` | `RECHAZADA` | `RESTABLECER_BLOQUEO` cuyo `id_bloqueo` o `causa` no coinciden con el bloqueo activo, o sin ningún bloqueo activo |
| `INSPECCION_NO_CONFIRMADA` | `RECHAZADA` | Rearme de un bloqueo `PREVENTIVO` sin `inspeccion_confirmada: true` |
| `BLOQUEO_NO_LIBERABLE` | `RECHAZADA` | `RESTABLECER_BLOQUEO` sin cumplirse la condición objetiva de 10.5, o con una causa que sólo se libera localmente |
| `PERSISTENCIA_NO_DISPONIBLE` | `RECHAZADA` | No se pudo confirmar la escritura en el diario NVS; nunca se inicia el encendido |
| `ACTUADOR_DESCONOCIDO` | `RECHAZADA` | Actuador inexistente |
| `TIPO_DESCONOCIDO` | `RECHAZADA` | Tipo no soportado |
| `PARAMETROS_INVALIDOS` | `RECHAZADA` | `duracion_s` ausente o fuera de 1..600, o `id` fuera de rango |
| `RESULTADO_INCIERTO_REINICIO` | `FALLIDA` | Había un registro `INTENCION` sin `FINAL` al reiniciar (8.4) |
| `ERROR_HARDWARE` | `FALLIDA` | Fallo físico detectado al conmutar |

**Respuesta `200 OK`**

```json
{ "data": { "id": 1287, "estado": "EJECUTADA", "confirmacion_tardia": false, "hora_servidor": "2026-10-15T20:31:03.900Z" } }
```

#### 7.3.2 Reglas del servidor para ACK, incluidos los históricos y tardíos

1. **Estados que aceptan ACK:**
   - `ENTREGADA`: ACK normal.
   - `SIN_CONFIRMAR`: ACK tardío; la orden queda con `confirmacion_tardia = true`.
   - `EXPIRADA` o `CANCELADA` (nunca entregadas): `409 ORDEN_NO_ENTREGADA` y alerta crítica de incoherencia.
   - Orden inexistente o de otro dispositivo: `404 ORDEN_NO_ENCONTRADA`.
   - Los ACK **no caducan**: se aceptan sin límite de tiempo mientras la orden esté `ENTREGADA` o `SIN_CONFIRMAR`.
2. **Inmutabilidad:** el primer ACK válido se guarda completo (`ack_cuerpo`) en la misma transacción que el estado y la auditoría, y nunca se sobrescribe.
3. **Equivalencia (idempotencia):**
   - `BOMBA_ENCENDER` y `RESTABLECER_BLOQUEO`: dos ACK son equivalentes si coinciden `resultado`, `codigo_motivo` y `duracion_aplicada_s`.
   - `BOMBA_APAGAR` (excepción expresa, porque el corte se reaplica en cada recepción): dos ACK son equivalentes si ambos tienen `resultado = EJECUTADA`, aunque uno traiga `SIN_CAMBIO` y el otro `null`.
   - Un ACK equivalente devuelve `200` sin modificar nada. Uno no equivalente devuelve `409 ORDEN_YA_FINALIZADA`: se audita, se incrementa `ack_conflictos` y se conserva el original. El firmware da la orden por cerrada.
4. **Un ACK es histórico.** Describe el pasado, así que el servidor:
   - **Nunca** crea órdenes, cambia modos ni reconcilia (9.3) a partir de un ACK. La reconciliación sólo usa telemetría fresca.
   - Actualiza el snapshot del actuador con `estado_actuador` del ACK **sólo** si `id_arranque_origen` es el arranque actual (`X-Id-Arranque`) **y** `estado_actuador.uptime_ms` supera el `reportado_uptime_ms` guardado. En cualquier otro caso lo archiva en `ack_cuerpo` sin tocar el estado.
   - Nunca compara uptimes de arranques distintos.
   - Sólo la cabecera `X-Id-Arranque` dispara la regla de reinicio (8.5). `id_arranque_origen` no.
5. **Coherencia con la entrega:** si `id_arranque_origen` no coincide con `id_arranque_entrega` y el ACK no es `FALLIDA / RESULTADO_INCIERTO_REINICIO`, se acepta pero se registra la alerta `ACK_INCOHERENTE` para revisión.

### 7.4 `GET /iot/configuracion`

Se consulta al arrancar (tras SNTP) y cuando la `config_version` del servidor es mayor que la aplicada. Con `If-None-Match: "4"` responde `304` si no hay cambios.

**Respuesta `200 OK`** (`ETag: "5"`)

```json
{
  "data": {
    "config_version": 5,
    "intervalo_telemetria_s": 10,
    "intervalo_ordenes_s": 3,
    "sensores": [
      { "sensor": "HUM1", "tipo": "HUMEDAD_SUELO", "raw_seco": 3000, "raw_humedo": 1300, "calibracion_confirmada": false }
    ],
    "control": [
      {
        "actuador": "BOMBA1",
        "sensor": "HUM1",
        "modo": "DESHABILITADO",
        "umbral_inicio_pct": 30.0,
        "umbral_parada_pct": 55.0,
        "riego_max_s": 15,
        "descanso_min_s": 60
      }
    ],
    "hora_servidor": "2026-10-15T20:31:03.120Z"
  }
}
```

#### Parámetros, rangos y valores por defecto

> ⚠ **Valores de BANCO DE PRUEBAS**, tomados del firmware de Codex. Son conservadores para proteger la mini bomba y el circuito. **No son parámetros agronómicos**: hay que recalibrarlos por cultivo, suelo y sensor antes de usarlos en campo. Todos se pueden configurar desde la web dentro de los rangos. La web los marca como "valores de banco".

| Campo | Rango | Banco | Significado |
|---|---|---|---|
| `intervalo_telemetria_s` | 5–3600 | 10 | Envío de telemetría |
| `intervalo_ordenes_s` | 2–60 | 3 | Consulta de órdenes |
| `raw_seco` | 21–4074 | 3000 | ADC en seco = 0 % |
| `raw_humedo` | 21–4074 | 1300 | ADC en húmedo = 100 % |
| `calibracion_confirmada` | bool | `false` | Sin confirmar, las lecturas son `SIN_CALIBRAR` y no se riega |
| `modo` | enum | `DESHABILITADO` | Modo deseado |
| `umbral_inicio_pct` | 0–95 | 30 | En `AUTOMATICO`, arranca si la humedad es < este valor |
| `umbral_parada_pct` | 5–100 | 55 | Para si la humedad es ≥ este valor (también en `MANUAL`) |
| `riego_max_s` | 5–`tope_riego_s` (≤ 600) | 15 | Duración máxima de cualquier riego |
| `descanso_min_s` | 5–86400 | 60 | Espera mínima tras cualquier riego, tras el arranque y tras un rearme; también actúa como antirrebote |

Validación, la misma en el servidor y en el firmware. Si falla cualquier regla, se rechaza **toda** la configuración:
- Histéresis: `umbral_parada_pct − umbral_inicio_pct ≥ 5`.
- Calibración: |`raw_seco` − `raw_humedo`| ≥ 200.
- `riego_max_s` ≤ `tope_riego_s` reportado. Si no, el firmware rechaza con `FUERA_DE_CAPACIDAD`.
- Versión:
  - **Igual a la aplicada:** sin ningún efecto. No apaga, no reinicia el descanso y no cambia el modo; se confirma de nuevo como `APLICADA`.
  - **Menor:** se rechaza con `VERSION_REGRESIVA`.
  - **Mayor y válida:** apaga cualquier riego e inicia `descanso_min_s`, aunque la bomba ya estuviera apagada (9.4).
- Correspondencia exacta de dispositivos: la configuración sólo puede referirse a sensores y actuadores que el firmware tiene. Un código desconocido se rechaza con `SENSOR_DESCONOCIDO` o `ACTUADOR_DESCONOCIDO`, sin aplicar nada parcialmente.
- Porcentaje: `pct = 100 × (raw − raw_seco) / (raw_humedo − raw_seco)`, recortado a 0–100.
- Constantes del firmware que **no se configuran remotamente**:
  - Rieles ADC ≤ 20 o ≥ 4075, inválidos.
  - Dispersión de 5 muestras > 500, inválida.
  - Mediana fuera de calibración ± 200, inválida.
  - Caducidad del sensor: 3000 ms.
  - `TOPE_ABSOLUTO_RIEGO_S` ≤ 600.

### 7.5 `POST /iot/configuracion/confirmacion`

```json
{
  "config_version": 5,
  "resultado": "APLICADA",
  "errores": [],
  "actuadores": [ { "...": "estado_actuador tras aplicar" } ]
}
```

- `resultado`: `APLICADA` | `RECHAZADA`. Con `RECHAZADA`, `errores` lleva elementos como `{ "campo": "control[0].riego_max_s", "codigo": "FUERA_DE_CAPACIDAD" }` y el firmware **conserva la configuración anterior completa**.
- La configuración se persiste en NVS de forma **atómica** (un único bloque con versión y CRC32) **antes** de confirmarla.
- Una configuración `APLICADA` puede dejar un modo efectivo distinto del pedido (p. ej. `DESHABILITADO` por un bloqueo). El servidor lo resuelve con 9.3.
- Respuesta `200`: `{ "data": { "config_version_aplicada": 5, "hora_servidor": "..." } }`. Si la versión no existe: `409 VERSION_CONFIG_DESCONOCIDA`.

### 7.6 `POST /iot/eventos`

Se envían al ocurrir. Sin conexión se acumulan en un búfer de al menos 20 y se envían después, como máximo 30 por solicitud.

```json
{
  "id_arranque": "9f3a12c0",
  "uptime_ms": 3700000,
  "eventos": [
    {
      "seq": 1043,
      "tipo": "RIEGO_INICIADO",
      "actuador": "BOMBA1",
      "ts": "2026-10-15T20:32:00Z",
      "uptime_ms": 3659000,
      "datos": { "origen": "AUTOMATICO", "humedad_pct": 29.8, "duracion_programada_s": 15 }
    }
  ]
}
```

| `tipo` | `datos` | Efecto en el servidor |
|---|---|---|
| `ARRANQUE` | `{ "motivo_reinicio": "POWERON"\|"WATCHDOG"\|"BROWNOUT"\|"PANIC"\|"SOFTWARE"\|"OTRO", "version_firmware", "modo_inicial", "ordenes_inciertas": [ids] }` | Alerta si el motivo no es `POWERON` ni `SOFTWARE` |
| `RIEGO_INICIADO` | `{ "origen": "MANUAL"\|"AUTOMATICO", "humedad_pct", "duracion_programada_s", "id_orden"? }` | Abre un ciclo de riego |
| `RIEGO_FINALIZADO` | `{ "origen", "motivo_fin", "duracion_s", "humedad_inicio_pct", "humedad_fin_pct", "id_orden"? }` | Cierra el ciclo |
| `MODO_CAMBIADO` | `{ "anterior", "nuevo", "origen": "CONFIG"\|"ORDEN_APAGAR"\|"BLOQUEO"\|"ARRANQUE"\|"REARME" }` | Regla 9.3 |
| `BLOQUEO_ACTIVADO` | `{ "id_bloqueo", "tipo", "causa", "liberable_remotamente", "reemplaza_id_bloqueo"? }` | Alerta (`CRITICO` = crítica, `PREVENTIVO` = advertencia) |
| `BLOQUEO_LIBERADO` | `{ "id_bloqueo", "por": "ORDEN"\|"LOCAL", "id_orden"? }` | Resuelve la alerta |
| `CORTE_RESPALDO` | `{ "duracion_aplicada_s", "retraso_ms" }` | Alerta crítica (10.7) |
| `FALLA_SENSOR` / `SENSOR_RECUPERADO` | `{ "sensor", "valor_raw", "estado" }` | Abre o resuelve una alerta. Recuperar el sensor **no** libera el bloqueo |
| `CONEXION_RECUPERADA` | `{ "sin_conexion_s", "causa": "SIN_WIFI"\|"SIN_HORA"\|"SIN_API"\|"TLS" }` | Informativo |
| `CONFIG_APLICADA` / `CONFIG_RECHAZADA` | `{ "config_version", "errores"? }` | Informativo / alerta |
| `DATOS_DESCARTADOS` | `{ "lecturas", "eventos" }` | Alerta `DATOS_PERDIDOS` |

Respuesta `200`: `{ "data": { "recibidos": 1, "duplicados": 0, "hora_servidor": "..." } }`. Se deduplica por (`id_arranque`, `seq`). Los tipos desconocidos se almacenan sin efecto.

---

## 8. Órdenes: ciclo de vida, prioridad, persistencia e idempotencia

### 8.1 Estados

```
              ┌── usuario cancela / reemplazada ────────────► CANCELADA  (final · nunca se ejecutó)
              │
 [creada] ► PENDIENTE ── vence sin entregarse ──────────────► EXPIRADA   (final · nunca se ejecutó)
              │
              └─ GET /iot/ordenes ─► ENTREGADA ─┬─ ACK ─────► EJECUTADA | RECHAZADA | FALLIDA (final)
                                                │
                                                └─ vigencia + 30 s sin ACK,
                                                   o reinicio del dispositivo ─► SIN_CONFIRMAR
                                                                                   │ ACK tardío
                                                                                   ▼
                                                                   EJECUTADA | RECHAZADA | FALLIDA
```

| Estado | Final | Garantía |
|---|:-:|---|
| `PENDIENTE` | ❌ | No entregada |
| `ENTREGADA` | ❌ | Entregada a `id_arranque_entrega`; a la espera del ACK |
| `EJECUTADA` / `RECHAZADA` / `FALLIDA` | ✅ | Resultado confirmado por el ESP32 (ACK inmutable) |
| `EXPIRADA` | ✅ | **Nunca** se entregó, así que nunca se ejecutó |
| `CANCELADA` | ✅ | **Nunca** se entregó, así que nunca se ejecutó |
| `SIN_CONFIRMAR` | ⚠ | Resultado **desconocido**: la web muestra "no confirmada — verificar estado real". Nunca se reentrega y pasa a final si llega un ACK tardío |

Una orden **nunca** se elimina. La expiración y la cancelación conservan la auditoría.

### 8.2 Creación y prioridad de APAGAR (servidor)

Cada creación es una transacción con `SELECT … FROM dispositivos WHERE id = ? FOR UPDATE`. Esto la serializa por dispositivo y garantiza que los `id` crecen en el orden de entrega.

1. `BOMBA_APAGAR` se acepta **siempre**, incluso fuera de línea (con advertencia). Además:
   - **Cancela** en la misma transacción las órdenes `PENDIENTE` de encendido y rearme del actuador (`CANCELADA`, motivo `REEMPLAZADA_POR_APAGAR`).
   - Si el modo deseado es `AUTOMATICO`, lo cambia a `MANUAL` con una nueva `config_version` (origen `SISTEMA`, motivo `ORDEN_APAGAR`).
2. `BOMBA_ENCENDER` se rechaza con `409 APAGADO_PENDIENTE` si el actuador tiene un `BOMBA_APAGAR` `PENDIENTE` o `ENTREGADA`. Un encendido o un rearme nunca cancelan un apagado.
3. Un `BOMBA_ENCENDER` nuevo cancela un `BOMBA_ENCENDER` `PENDIENTE` anterior (motivo `REEMPLAZADA`).
4. `BOMBA_APAGAR` no se puede cancelar desde la web. Cancelar una orden `ENTREGADA` no es posible, porque ya pudo ejecutarse: para detener la bomba hay que enviar `BOMBA_APAGAR`.

**Entrega** (`GET /iot/ordenes`):
- Por actuador sólo se entrega la orden entregable con **mayor `id`**. Si existe un `BOMBA_APAGAR` más nuevo, un `BOMBA_ENCENDER` `ENTREGADA` sin confirmar deja de reentregarse.

### 8.3 Procesamiento en el firmware: coordinador único y barrera de apagado

1. **Coordinador único.**
   - La tarea de control ejecuta todas las órdenes y es la única que escribe la marca de agua, el diario y las barreras persistidas.
   - La tarea de red sólo valida el formato, aplica el camino prioritario del punto 2 y encola.
   - La cola tiene capacidad acotada (≥ 8). Si está llena, la tarea de red no encola los encendidos ni rearmes sobrantes, que se volverán a recibir en la siguiente consulta, pero **nunca** omite el camino prioritario de un `BOMBA_APAGAR`.
2. **Camino prioritario de APAGAR.** Al recibir un `BOMBA_APAGAR` autenticado para un actuador conocido, la tarea de red hace dos cosas **sin esperar a la cola**:
   1. Fuerza el nivel inactivo del relé. Esto es seguro e idempotente en cualquier contexto.
   2. Eleva de forma atómica en RAM `barrera_apagado[actuador] = max(barrera_apagado[actuador], id)`.

   Después encola el `BOMBA_APAGAR` para que la tarea de control complete el efecto lógico (`AUTOMATICO` → `MANUAL`, eventos, descanso, ACK). No se comprueban modo, bloqueo, reloj, vigencia, duplicado ni capacidad del diario.
3. **Barrera de apagado.** Todo `BOMBA_ENCENDER` o `RESTABLECER_BLOQUEO` del mismo actuador con `id` < `barrera_apagado[actuador]` queda **anulado**: `RECHAZADA / ANULADA_POR_APAGAR`, sin efecto y registrado en el diario. La barrera se comprueba en tres puntos:
   1. Al desencolar.
   2. Tras escribir `INTENCION`.
   3. Dentro de la **misma sección crítica** que activa el GPIO.

   Así, un encendido que ya estaba en cola, en validación o escribiéndose en NVS cuando llega el apagado nunca arranca.
4. **Persistencia de la barrera.**
   - La tarea de control persiste `barrera_apagado[actuador]` en NVS **después** del corte; persistir nunca retrasa el apagado.
   - Tras un reinicio se restaura. Junto con la marca de agua, impide que un encendido antiguo arranque después del reinicio.
   - Si la escritura falla, la bomba ya está apagada: se reporta `persistencia_ok = false` y se activa el bloqueo `CRITICO / PERSISTENCIA_NO_DISPONIBLE`.
5. **Orden total.**
   - `BOMBA_ENCENDER` y `RESTABLECER_BLOQUEO` se procesan en **orden ascendente de `id`** por dispositivo. La marca de agua sólo crece y se escribe en el mismo commit atómico que la `INTENCION`.
   - `BOMBA_APAGAR` puede adelantarse a la cola. Su efecto equivale a haberse procesado en orden, porque anula todo encendido o rearme anterior del mismo actuador.
   - `BOMBA_APAGAR` **no** modifica la marca de agua global, para no anular órdenes legítimas de otros actuadores.
6. **Defensa del lote** (se mantiene): si una respuesta trae un `BOMBA_APAGAR` para un actuador, las demás órdenes de ese actuador en la misma respuesta se rechazan con `ORDEN_EN_LOTE_CON_APAGAR`.
7. **Respuestas antiguas:** la tarea de red procesa las respuestas en el orden en que envió las solicitudes. Nunca encola un encendido o rearme con `id` ≤ al mayor ya encolado, salvo las reentregas, que se resuelven con el diario sin ejecutarse.
8. **APAGAR repetido:**
   - Cada recepción de un `BOMBA_APAGAR` vuelve a forzar el corte, que es idempotente.
   - Para un mismo `id`, el firmware **retransmite el ACK original** si lo conserva (registro en RAM o diario).
   - Si no lo conserva (p. ej. tras un reinicio), envía un ACK nuevo, que el servidor considera equivalente (7.3.2, punto 3). Nunca se inventa un resultado distinto de `EJECUTADA` para un apagado efectuado.
9. **Complemento del servidor:** 8.2 (cancelar los pendientes, una orden por actuador, no reentregar un encendido después de un apagado más nuevo).

### 8.4 Diario durable y anti-repetición

El firmware mantiene en NVS:
- **Marca de agua** `max_id_orden_procesada` (`uint64`).
- **Diario** de al menos **16** entradas `{ id, tipo, actuador, parametros, expira_en, fase, resultado, codigo_motivo, duracion_aplicada_s, ack_confirmado }`. Las fases son `INTENCION` y `FINAL`, y las escrituras son atómicas y verificadas: versión, CRC y recuperación de una escritura interrumpida.

Procedimiento para `BOMBA_ENCENDER` y `RESTABLECER_BLOQUEO`:
1. Buscar el `id` en el diario.
   - Con `FINAL`: **no se ejecuta** y se reenvía el ACK guardado.
   - Con contenido distinto: se rechaza con `ID_REUTILIZADO`.
   - Con `INTENCION` sin `FINAL`: no se ejecuta.
2. Si el `id` es ≤ `max_id_orden_procesada` y no está en el diario: `RECHAZADA / ORDEN_DUPLICADA`.
3. Validar contenido, vigencia y condiciones de seguridad (10.3).
4. Escribir y verificar en NVS: `max_id_orden_procesada = id` y la entrada en `INTENCION` (también para los rechazos). Si no se puede verificar, se rechaza con `PERSISTENCIA_NO_DISPONIBLE` y la bomba se mantiene apagada.
5. Revalidar la vigencia y la seguridad **inmediatamente antes** de tocar el GPIO, y actuar **una sola vez**.
6. Persistir `FINAL` con el ACK completo **antes** de enviarlo. Si esta escritura falla, la bomba se apaga y se activa el bloqueo `CRITICO / PERSISTENCIA_NO_DISPONIBLE`; nunca se repite el efecto.
7. Reintentar el ACK, incluso tras `expira_en` o un reinicio, hasta recibir `200`, `404` o `409`, y entonces marcar `ack_confirmado`. Un `404` o `409` cierra los reintentos y nunca autoriza a repetir el encendido.
8. **Reciclaje:** sólo se reutilizan entradas con `FINAL` y `ack_confirmado`. Si no queda ninguna libre, los nuevos encendidos y rearmes se rechazan con `PERSISTENCIA_NO_DISPONIBLE`; `BOMBA_APAGAR` sigue funcionando.
9. **Al arrancar:** toda `INTENCION` sin `FINAL` se resuelve con la bomba apagada y un ACK `FALLIDA / RESULTADO_INCIERTO_REINICIO`, que se persiste antes de enviarse. Se activa el bloqueo `PREVENTIVO / RESULTADO_INCIERTO_REINICIO`. No se afirma que no hubo pulso: el corte pudo ocurrir entre el GPIO y el `FINAL`.

10. **Límites de la garantía local:**
    - Un corte **antes** de escribir `INTENCION` no deja registro local. La orden no se intentó, y el firmware no puede reconstruir un `id` que nunca persistió.
    - Que no se reentregue tras ese reinicio lo garantiza el servidor (8.5).
    - La garantía local empieza en el commit durable previo al efecto.

Garantía resultante, que combina 8.3, 8.4 y 8.5: **como máximo un intento por orden** y **ningún encendido anterior a un apagado del mismo actuador**, incluso con reinicios, reenvíos, colas o reconexiones.

### 8.5 Reinicio del dispositivo (servidor)

Cuando llega un `X-Id-Arranque` distinto del último conocido:
1. Las órdenes `ENTREGADA` a un arranque anterior pasan a `SIN_CONFIRMAR` (motivo `REINICIO_DISPOSITIVO`) y **no se reentregan**. Si después llega su ACK, persistido en el diario, se acepta como tardío.
2. Los ciclos de riego abiertos se cierran con `motivo_fin = REINICIO`, porque el firmware siempre arranca con la bomba apagada.
3. Se registra el nuevo arranque.

### 8.6 Caducidad (servidor)

Una tarea revisa cada 5 s:
- Las órdenes `PENDIENTE` vencidas pasan a `EXPIRADA`.
- Las `ENTREGADA` cuyo `expira_en + 30 s` ya pasó pasan a `SIN_CONFIRMAR` y generan la alerta `ORDEN_SIN_CONFIRMAR`.

La consulta de entrega también comprueba la vigencia dentro de su transacción.

---

## 9. Modos, configuración y sincronización de estado

### 9.1 Los tres modos

| Modo | Riego automático | `BOMBA_ENCENDER` | `BOMBA_APAGAR` | Uso |
|---|:-:|:-:|:-:|---|
| `DESHABILITADO` | ❌ | ❌ `MODO_INCORRECTO` | ✅ | Estado seguro por defecto: arranque, bloqueos y rearmes |
| `MANUAL` | ❌ | ✅ con las condiciones de 10.3 | ✅ | Pruebas y control remoto |
| `AUTOMATICO` | ✅ (lazo local) | ❌ `MODO_INCORRECTO` | ✅ y pasa a `MANUAL` | Riego autónomo |

Transiciones locales:

| Desde | Evento | Hacia | Bomba |
|---|---|---|---|
| cualquiera | Nueva configuración aplicada | modo configurado si no hay bloqueo; si lo hay, `DESHABILITADO` | **Se apaga** (`CONFIG_ACTUALIZADA` o `CAMBIO_MODO`) y empieza el descanso |
| `AUTOMATICO` | `BOMBA_APAGAR` | `MANUAL` | Se apaga (`ORDEN_APAGAR`) |
| `MANUAL` / `DESHABILITADO` | `BOMBA_APAGAR` | sin cambio | Se apaga si estaba encendida |
| cualquiera | Bloqueo activado | `DESHABILITADO` | Se apaga |
| bloqueado | `RESTABLECER_BLOQUEO` aceptado | `DESHABILITADO` (no reactiva ningún modo) | Apagada; empieza el descanso |
| — | Arranque | `DESHABILITADO`. Sólo si la constante de compilación `PERMITIR_MODO_PERSISTIDO_AL_ARRANCAR = true` y no hay bloqueo se restaura el modo persistido, con descanso completo desde el arranque | Apagada |

**Apagar nunca activa un modo que riegue.** Sólo puede llevar a `MANUAL`, que no riega por sí solo, o dejar el modo igual. Reconectarse, recibir de nuevo la misma versión de configuración o reiniciar tampoco suben el modo.

### 9.2 Configuración deseada

- El servidor guarda la configuración deseada con `config_version`. Esta **sólo crece** con cada cambio (modo, umbrales, tiempos, calibración, intervalos), lo haga el usuario o el sistema.
- "Activar modo automático" = `PATCH /actuadores/{id}/control { "modo": "AUTOMATICO" }`. El servidor lo exige:
  - Sin bloqueo reportado; si lo hay, `409 BLOQUEO_ACTIVO`.
  - Con calibración confirmada; si no, `409 CALIBRACION_NO_CONFIRMADA`.
  - Con `hardware_confirmado`; si no, `409 HARDWARE_NO_CONFIRMADO`.
- El firmware aplica la configuración de forma atómica: todo o nada.
- **Una configuración nunca libera un bloqueo.** Si llega pidiendo `MANUAL` o `AUTOMATICO` con un bloqueo activo, se aplica (umbrales, tiempos) pero el modo efectivo sigue en `DESHABILITADO`.

### 9.3 Reconciliación: el servidor nunca sube un modo por su cuenta

Orden de actividad: `DESHABILITADO` < `MANUAL` < `AUTOMATICO`.

La reconciliación **sólo** usa la telemetría fresca (7.1) del arranque actual. Los ACK de órdenes y de configuración no la disparan, porque pueden ser históricos (7.3.2).

Si la telemetría informa `config_version` == versión deseada **y** un modo efectivo **menor** que el deseado, el servidor **baja** el modo deseado al efectivo dentro de una transacción. La causa puede ser un bloqueo, un `BOMBA_APAGAR` en automático, el arranque o un rearme. La operación crea una nueva `config_version` (origen `SISTEMA`) y se audita.

En consecuencia:
- Una configuración posterior, como un cambio de umbral, **nunca** reactiva un modo que el dispositivo abandonó por seguridad.
- Volver a `MANUAL` o `AUTOMATICO` siempre exige una acción explícita del usuario.

### 9.4 Una configuración nueva nunca prolonga un riego

Aplicar una configuración nueva **apaga** cualquier riego en curso (`CONFIG_ACTUALIZADA`, o `CAMBIO_MODO` si cambió el modo) e inicia `descanso_min_s`. Así:
- Ningún cambio de `riego_max_s`, umbrales o calibración altera el temporizador de un riego activo.
- La regla es simple y verificable.

La web avisa antes de enviar un cambio de configuración durante un riego.

### 9.5 Lo que muestra la web

1. **Modo configurado** (deseado) y **modo efectivo** (reportado), con el aviso "Pendiente de aplicar" si difieren o si `config_version_aplicada` < deseada.
2. **Estado real de la bomba** (`estado_bomba` reportado) y su antigüedad, p. ej. "hace 4 s".
3. Si el dispositivo no está `EN_LINEA`:
   - La bomba aparece como **"desconocido — último reporte hace X"**.
   - "Encender" queda deshabilitado; "Apagar" sigue disponible.
4. Un bloqueo activo se muestra con su tipo y su causa. El botón "Rearmar" sólo aparece si `liberable_remotamente`, y pide confirmar que se inspeccionó físicamente.
5. Los valores de banco se marcan como "no agronómicos".

### 9.6 Estados seguros ante pérdida de conexión

| Situación | Comportamiento del ESP32 |
|---|---|
| Sin Wi-Fi, sin hora o sin API | Control local según el modo efectivo y la configuración en NVS; reintentos con *backoff* |
| `AUTOMATICO` sin conexión | Sigue regando con histéresis, tiempo máximo, descanso y bloqueos |
| `MANUAL` con un riego en curso | Termina al cumplir su duración (temporizador local). Sin conexión no llegan encendidos nuevos |
| `DESHABILITADO` | Bomba apagada |
| Reconexión | `CONEXION_RECUPERADA`. Envía búferes y ACK pendientes. Descarga la configuración si es mayor. **No** cambia de modo ni repite órdenes ya procesadas |
| `401` / `403` | Reintento ≤ 1 por minuto; el control local continúa |

En el servidor, un `BOMBA_ENCENDER` para un dispositivo que no está `EN_LINEA` se rechaza (`409 DISPOSITIVO_FUERA_DE_LINEA`). `BOMBA_APAGAR` se acepta con advertencia.

---

## 10. Reglas de seguridad del firmware

### 10.1 Arranque seguro
1. Con `hardwareConfirmed`, escribir el nivel **inactivo** del relé y **después** configurar el pin como salida, antes de cualquier otra inicialización. Sin hardware confirmado no se habilita el GPIO. Durante el *bootloader* el pin no está controlado, así que hace falta una polarización externa compatible con el módulo de relé.
2. Cargar desde NVS la configuración (bloque con CRC32), el bloqueo, la marca de agua y el diario. Si algo está corrupto: valores por defecto compilados, `DESHABILITADO` y bloqueo `CRITICO / CONFIG_INVALIDA` o `PERSISTENCIA_NO_DISPONIBLE`.
3. Resolver las `INTENCION` sin `FINAL` según 8.4, punto 9.
4. Modo inicial según 9.1 e inicio de `descanso_min_s` desde el arranque.
5. Emitir el evento `ARRANQUE` con el motivo de reinicio y las órdenes inciertas.

### 10.2 Límites de tiempo
- `TOPE_ABSOLUTO_RIEGO_S` es una constante compilada ≤ 600 y no se puede cambiar remotamente. Se reporta en `seguridad.tope_riego_s`.
- Duración aplicada de cualquier riego = `min(duracion_s solicitada, riego_max_s, TOPE_ABSOLUTO_RIEGO_S)`, medida con reloj monotónico desde la activación real.
- Riego manual que cumple su duración: apagado normal (`DURACION_CUMPLIDA`), sin bloqueo.
- Riego automático que llega a `riego_max_s` sin alcanzar `umbral_parada_pct`: apagado (`TIEMPO_MAXIMO`) y **bloqueo `PREVENTIVO`** desde la primera vez.
- Si el riego supera su duración por un fallo de control (lo detecta el corte de respaldo de 10.7): bloqueo `CRITICO / FALLA_CRITICA`.
- Ningún duplicado, reconexión, cambio de UTC, encendido nuevo, ACK ni configuración renueva o amplía el temporizador.

### 10.3 Condiciones para `BOMBA_ENCENDER` (todas obligatorias)
1. Autenticado (TLS + token), no duplicado (8.4) y no anulado por la barrera de apagado (8.3).
2. Reloj confiable y orden vigente, comprobado justo antes de actuar (4.2).
3. Ningún `BOMBA_APAGAR` del mismo actuador en el lote.
4. Modo efectivo `MANUAL`.
5. Sin **ningún** bloqueo, ni `CRITICO` ni `PREVENTIVO`.
6. `hardwareConfirmed` y calibración confirmada.
7. Lectura del sensor válida, finita y con menos de 3000 ms de antigüedad.
8. Humedad < `umbral_parada_pct`.
9. `descanso_min_s` cumplido.
10. Bomba apagada: un riego en curso no se prolonga.
11. Escritura `INTENCION` verificada en NVS.

Durante un riego manual también se para por `umbral_parada_pct`, por un sensor inválido o caducado (además de bloquear) y por los límites de 10.2.

### 10.4 Lazo `AUTOMATICO` con histéresis
Se evalúa al menos cada 100 ms en la tarea de control:

```
si sensor inválido, sin calibrar o caducado (≥ 3000 ms) → APAGAR + bloqueo CRITICO (en cualquier modo, sin esperar)
si apagada y sin bloqueo y descanso = 0
   y humedad < umbral_inicio_pct                      → ENCENDER (RIEGO_INICIADO, AUTOMATICO)
si encendida y humedad ≥ umbral_parada_pct            → APAGAR (UMBRAL_ALCANZADO)
si encendida en AUTOMATICO y t ≥ riego_max_s          → APAGAR (TIEMPO_MAXIMO) + bloqueo PREVENTIVO
al apagar cualquier riego                             → iniciar descanso_min_s
```

Entre los dos umbrales el estado no cambia (histéresis). Un apagado siempre es inmediato.

**Primera muestra:** si 10 s después del arranque no hay ninguna lectura válida, se reporta `ERROR_SENSOR` y se activa el bloqueo `CRITICO / FALLA_SENSOR`, aunque la bomba no haya llegado a encender.

### 10.5 Bloqueos: política definitiva de rearme

**Identidad del bloqueo.** Cada bloqueo recibe un `id_bloqueo` tomado de un contador persistente en NVS, creciente y que nunca se reutiliza, ni siquiera tras un reinicio. Si aparece una causa nueva con un bloqueo ya activo:
- Se conserva la causa más restrictiva: `CRITICO` antes que `PREVENTIVO`, y sólo local antes que remota.
- Se asigna un `id_bloqueo` **nuevo**. Así, una orden de rearme preparada para el bloqueo anterior ya no coincide.

**Condición objetiva de sensor**, usada en la tabla:
- Lecturas válidas, calibradas y continuas durante ≥ 10 s, todas con < 3000 ms de antigüedad.
- Bomba apagada.
- Corte de respaldo no disparado.

| Causa | Tipo | ¿Rearme remoto? | Condición objetiva que comprueba el firmware | Datos que exige la orden |
|---|---|---|---|---|
| `FALLA_SENSOR`, `SENSOR_CADUCADO` | `CRITICO` | Sí | Condición objetiva de sensor | `id_bloqueo`, `causa` |
| `CONFIG_INVALIDA`, `CALIBRACION_INVALIDA` | `CRITICO` | Sí | Configuración aplicada válida (CRC correcto), calibración confirmada y condición objetiva de sensor | `id_bloqueo`, `causa` |
| `TIEMPO_MAXIMO`, `RESULTADO_INCIERTO_REINICIO` | `PREVENTIVO` | Sí, **una vez por episodio** | Condición objetiva de sensor | `id_bloqueo`, `causa`, `inspeccion_confirmada: true` |
| `TIEMPO_MAXIMO_REPETIDO` | `CRITICO` | **No**, sólo local | Local: condición objetiva de sensor | — |
| `FALLA_CRITICA` (incluye el corte de respaldo) | `CRITICO` | **No**, sólo local | Local: condición objetiva de sensor y temporizador de respaldo desarmado | — |
| `PERSISTENCIA_NO_DISPONIBLE` | `CRITICO` | **No**, sólo local | Local: escritura y lectura de prueba en NVS verificadas | — |

**Escalado por episodio.** Un contador persistente `rearmes_remotos_episodio` limita los rearmes remotos de un mismo episodio de tiempo máximo:
- Pasa a 1 al rearmar remotamente un bloqueo `TIEMPO_MAXIMO`.
- Vuelve a 0 cuando un riego automático termina por `UMBRAL_ALCANZADO` (prueba de que el agua llega) o tras un rearme local.
- Si ocurre un `TIEMPO_MAXIMO` con el contador ≥ 1, el bloqueo se registra como `CRITICO / TIEMPO_MAXIMO_REPETIDO`, que sólo se rearma en local.

Resultado: un episodio de posible marcha en seco admite **como máximo un** rearme remoto.

**Rearme remoto (`RESTABLECER_BLOQUEO`).** El firmware libera el bloqueo sólo si se cumple, en este orden:
1. Las condiciones generales de una orden: autenticada, no duplicada, sin anular por la barrera, vigente con reloj confiable e `INTENCION` escrita.
2. Hay un bloqueo activo y `parametros.id_bloqueo` y `parametros.causa` coinciden con él. Si no: `BLOQUEO_NO_COINCIDE`.
3. La causa admite rearme remoto. Si no: `BLOQUEO_NO_LIBERABLE`.
4. Para `PREVENTIVO`, `parametros.inspeccion_confirmada === true`. Si no: `INSPECCION_NO_CONFIRMADA`.
5. Se cumple la condición objetiva de la tabla. Si no: `BLOQUEO_NO_LIBERABLE`.

`inspeccion_confirmada` es una **declaración auditada** de un usuario `OPERADOR` o superior: el servidor guarda quién la hizo. El firmware sólo verifica que está presente y coincide; no puede comprobar físicamente que haya agua. Es una limitación conocida.

**Rearme local.**
- Exige presencia física: el comando USB serie `REARMAR <id_bloqueo>`, o un botón mantenido 5 s. Codex elige el mecanismo y lo documenta.
- Exige las mismas condiciones objetivas de la tabla y que el `id_bloqueo` coincida.
- Emite `BLOQUEO_LIBERADO { "por": "LOCAL" }` y pone a 0 `rearmes_remotos_episodio`.

**Reglas comunes:**
- Ningún bloqueo permite encender, en ningún modo. La API no tiene ninguna forma de saltarse un bloqueo.
- Los bloqueos persisten en NVS y sobreviven a reinicios, reconexiones, configuraciones nuevas y rotaciones de token.
- Al liberar se persiste el estado, se emite `BLOQUEO_LIBERADO` (con `id_bloqueo`), se queda en `DESHABILITADO` y se inicia el descanso. Para volver a operar hace falta una configuración nueva y explícita del usuario (9.2).
- **Limitación conocida:** sin sensores de caudal, nivel o corriente, el bloqueo por tiempo máximo es una **heurística**. No detecta de verdad la marcha en seco, un tanque vacío ni un relé soldado.

### 10.6 Sensor
- Se usa un pin del **ADC1**: GPIO 32–39 en el ESP32 clásico; no aplica a C3/S3 sin revisarlo. El ADC2 no funciona con el Wi-Fi activo. La salida del sensor no debe superar la tensión admitida por el ADC.
- Mediana de 5 muestras con las reglas de validez de 7.4. Una lectura plausible no demuestra que el cableado esté íntegro.

### 10.7 Separación de red y control
1. **Tarea de control** (FreeRTOS, prioridad alta): muestreo, lazo, temporizadores, órdenes y relé. Nunca espera a la red. Está suscrita al *task watchdog* (≤ 5 s).
2. **Tarea de red** (prioridad menor): Wi-Fi, SNTP, HTTPS, JSON y búferes. Se comunica con la de control sólo mediante colas o estructuras protegidas.
3. **Corte de respaldo:**
   - Al encender se arma un `esp_timer` de un solo disparo a `duración aplicada + 2 s`. Se desarma en cada apagado normal.
   - El *callback* sólo hace dos cosas, sin bloquear ni tocar NVS ni registros:
     1. Fuerza el nivel inactivo del relé (`gpio_set_level`).
     2. Activa una bandera atómica `corte_respaldo`.
   - La tarea de control, al ver la bandera, registra y persiste fuera del *callback* el bloqueo `CRITICO / FALLA_CRITICA`.
   - **Enclavamiento:** mientras la bandera esté activa, ningún camino puede volver a encender. Se comprueba en la misma sección crítica que activa el GPIO.
   - Se puede usar el despacho `ESP_TIMER_ISR` si el núcleo lo admite; en ese caso el *callback* y lo que invoque deben residir en IRAM. Codex documenta el mecanismo y el núcleo usados.

   **Alcance real del corte de respaldo.** El `esp_timer` es software que se ejecuta **en el mismo microcontrolador**. **No** es un corte independiente de los fallos del MCU.

   | Situación | ¿Lo cubre el `esp_timer`? | Capa que actúa |
   |---|---|---|
   | La tarea de control se bloquea, entra en un bucle o tiene un error lógico que olvida apagar | Sí, mientras el servicio de temporizadores siga despachando | `esp_timer` (y el TWDT como respaldo) |
   | La red bloquea durante 8 s | Sí (además la red no comparte tarea con el control) | Separación de tareas + `esp_timer` |
   | Tareas o ISR de mayor prioridad, secciones críticas largas, operaciones de *flash*/NVS (caché desactivada) | **Parcialmente**: el despacho se **retrasa** (el *callback* no se ejecuta durante una escritura en *flash* si no está en IRAM) | Retraso acotado por la tolerancia de F-19; las escrituras NVS son breves y fuera de la ruta de encendido |
   | La tarea `esp_timer` bloqueada o sin CPU, o las interrupciones deshabilitadas demasiado tiempo | **No** | *Task watchdog* (≤ 5 s) o *interrupt watchdog* (activado) ⇒ reinicio ⇒ 10.1 |
   | Pánico, excepción o corrupción de memoria | **No** | Reinicio ⇒ 10.1. Entre el pánico y el reinicio, y durante el *bootloader*, el pin no está controlado por el firmware ⇒ depende de la **polarización externa** del pin del relé |
   | Caída de tensión de la lógica (*brownout*) o pérdida de alimentación del ESP32 con la bomba alimentada aparte | **No** | Detector de *brownout* ⇒ reinicio. Sin alimentación lógica el estado del relé depende sólo del circuito |
   | Relé con contactos soldados, transistor del driver en cortocircuito, GPIO dañado, cableado o polaridad erróneos | **No** | Ninguna capa de software. Requiere protección eléctrica externa |

   **Garantía verificable (F-19):**
   - Con el hardware en buen estado y el servicio de temporizadores despachando, el GPIO del relé recibe el nivel inactivo en ≤ `duración aplicada + 2,5 s`, aunque la tarea de control esté bloqueada.
   - Si en su lugar actúa un watchdog, el resultado aceptable es un reinicio con la bomba apagada al arrancar, que depende de la polarización externa durante el reinicio.
   - La tolerancia se mide en banco con el núcleo, la placa y el circuito reales. Un simulador no la demuestra.

   **Lo que NO se garantiza:** que la bomba se detenga ante fallos del propio MCU, de su alimentación o del circuito de potencia. Para una instalación real es **obligatorio** un corte eléctrico independiente (temporizador por hardware, *interlock* o protección de caudal y nivel). En el banco, la mitigación es la supervisión presencial.
4. Detector de *brownout* e *interrupt watchdog* activados. Tras cualquier reinicio el firmware vuelve a poner el relé en reposo en cuanto se ejecuta (10.1). Antes de ese momento manda la polarización externa.
5. Las escrituras en NVS no se hacen en cada ciclo, sólo ante cambios de estado.
6. Para una instalación real es **obligatorio** además un corte eléctrico independiente del MCU (ver la tabla de alcance del punto 3).

### 10.8 Red y reintentos
- Conexión TLS persistente, con 5 s de timeout de conexión y 8 s de respuesta.
- Ante un error de red, `5xx` o `429`: *backoff* exponencial con *jitter* (2 s → 4 s → … hasta 60 s), respetando `Retry-After`.
- Ante `400` o `422`: no se reintenta el mismo mensaje; se descarta y se cuenta.
- Se distinguen los estados `SIN_WIFI`, `SIN_HORA`, `SIN_API`, `TLS_ERROR` y `CONECTADO`.
- Hay que comprobarlo así: una solicitud que agote los 8 s durante un riego más corto no debe retrasar el apagado.

### 10.9 Búferes
- Mínimos: 100 lecturas en un búfer circular, 20 eventos y 16 ACK pendientes (en el diario NVS). Van separados del registro de diagnóstico por serie.
- Si se desbordan, se descartan las lecturas o eventos más antiguos y se suma al contador correspondiente. Los ACK no confirmados **nunca** se descartan (8.4, punto 8).

---

## 11. Endpoints de usuario (plataforma web)

Requieren `Authorization: Bearer <jwt>`, salvo login, refresh y salud. Las listas devuelven `{ "data": [...], "meta": { "pagina", "por_pagina", "total" } }`, con un máximo de 100 por página.

### 11.1 Resumen

| Método | Ruta | Rol mínimo | Descripción |
|---|---|---|---|
| `GET` | `/salud` | público | Estado del servicio y de la BD. Responde `{ "data": { "estado": "OK", "hora_servidor": "…" } }`, sin datos sensibles. El ESP32 lo usa para la verificación de hora (4.2, punto 3) antes de enviar el token |
| `POST` | `/auth/login` · `/auth/refresh` · `/auth/logout` | — | Sesión |
| `GET` | `/auth/me` | autenticado | Usuario y terrenos |
| `GET/POST` · `PATCH` | `/usuarios` · `/usuarios/{id}` | ADMIN | Usuarios |
| `GET/POST` | `/terrenos` | autenticado | Mis terrenos / crear |
| `GET/PATCH/DELETE` | `/terrenos/{id}` | LECTOR / PROPIETARIO | Terreno |
| `GET/POST/DELETE` | `/terrenos/{id}/miembros` | PROPIETARIO | Permisos |
| `GET/POST` · `PATCH/DELETE` | `/terrenos/{id}/cultivos` · `/cultivos/{id}` | LECTOR / PROPIETARIO | Cultivos |
| `GET/POST` · `PATCH/DELETE` | `/terrenos/{id}/zonas` · `/zonas/{id}` | LECTOR / PROPIETARIO | Zonas |
| `GET` | `/zonas/{id}/riegos` | LECTOR | Ciclos de riego |
| `GET/POST` | `/terrenos/{id}/dispositivos` | LECTOR / PROPIETARIO | Registrar (el token se muestra una vez) |
| `GET/PATCH` | `/dispositivos/{id}` | LECTOR / PROPIETARIO | Detalle / editar / deshabilitar |
| `POST` | `/dispositivos/{id}/token/rotar` · `/token/revocar` | PROPIETARIO | Rotación (con 24 h de gracia) / revocación |
| `GET` | `/dispositivos/{id}/estado` | LECTOR | **Panel en vivo** |
| `POST` · `PATCH` | `/dispositivos/{id}/sensores` · `/sensores/{id}` | PROPIETARIO | Sensores y calibración |
| `POST` | `/dispositivos/{id}/actuadores` | PROPIETARIO | Actuadores |
| `GET` · `PATCH` | `/dispositivos/{id}/configuracion` | LECTOR · OPERADOR | Configuración deseada y aplicada; intervalos |
| `PATCH` | `/actuadores/{id}/control` | OPERADOR | Modo, umbrales y tiempos |
| `POST` | `/dispositivos/{id}/ordenes` | OPERADOR | **Enviar orden** |
| `GET` | `/dispositivos/{id}/ordenes` · `/ordenes/{id}` | LECTOR | Historial / estado de una orden |
| `POST` | `/ordenes/{id}/cancelar` | OPERADOR | Sólo `PENDIENTE` y nunca `BOMBA_APAGAR` |
| `GET` | `/sensores/{id}/mediciones` | LECTOR | `?desde&hasta&agrupacion=crudo\|5m\|1h\|1d` |
| `GET` | `/dispositivos/{id}/eventos` | LECTOR | Eventos |
| `GET` · `POST` | `/alertas` · `/alertas/{id}/reconocer` · `/alertas/{id}/resolver` | LECTOR · OPERADOR | Alertas |

### 11.2 `POST /auth/login`

```json
// Solicitud
{ "email": "admin@agrocontrol.local", "password": "********" }
// 200 OK (+ Set-Cookie agc_refresh)
{ "data": { "token_acceso": "eyJ...", "expira_en_s": 900, "usuario": { "id": 1, "nombre": "Administrador", "email": "admin@agrocontrol.local", "rol": "ADMIN" } } }
```
Errores: `401 CREDENCIALES_INVALIDAS` (mensaje genérico) y `429`.

### 11.3 `GET /dispositivos/{id}/estado`

```json
{
  "data": {
    "dispositivo": {
      "id": 1, "uid": "AGC-ESP32-0001", "nombre": "ESP32 Banco",
      "conexion": "EN_LINEA", "ultima_conexion_en": "2026-10-15T20:31:05Z", "segundos_desde_conexion": 2,
      "rssi_dbm": -61, "version_firmware": "0.2.0", "version_contrato": "1.0.1",
      "hardware_confirmado": true, "tope_riego_s": 600, "reloj_confiable": true, "persistencia_ok": true, "tls_vigencia": "VERIFICADOR",
      "config_version_deseada": 5, "config_version_aplicada": 5, "config_sincronizada": true
    },
    "sensores": [
      { "id": 1, "codigo": "HUM1", "tipo": "HUMEDAD_SUELO", "zona": { "id": 1, "nombre": "Cama 1" },
        "calibracion_confirmada": true,
        "ultima_lectura": { "valor_pct": 42.5, "valor_raw": 1873, "estado": "OK", "medido_en": "2026-10-15T20:31:04Z" } }
    ],
    "actuadores": [
      {
        "id": 1, "codigo": "BOMBA1", "tipo": "BOMBA",
        "modo_configurado": "MANUAL",
        "reportado": {
          "modo": "MANUAL", "estado_bomba": "APAGADA", "riego_transcurrido_s": 0, "riego_restante_s": 0,
          "descanso_restante_s": 12, "bloqueo": null, "id_orden_activa": null,
          "reportado_en": "2026-10-15T20:31:05Z", "antiguedad_s": 2, "fiable": true
        },
        "control": { "umbral_inicio_pct": 30, "umbral_parada_pct": 55, "riego_max_s": 15, "descanso_min_s": 60, "valores_de_banco": true },
        "orden_activa": null,
        "acciones_permitidas": { "encender": false, "apagar": true, "rearmar": false, "motivo_encender_no_permitido": "DESCANSO_ACTIVO" }
      }
    ],
    "alertas_activas": 0,
    "hora_servidor": "2026-10-15T20:31:07Z"
  }
}
```

- `fiable = false` si el dispositivo no está `EN_LINEA`.
- `acciones_permitidas` sólo **ayuda a la interfaz**; la decisión final la toma el ESP32.
- `valores_de_banco = true` mientras los parámetros coincidan con los de banco.
- La web consulta este endpoint cada 3 s.

### 11.4 `POST /dispositivos/{id}/ordenes`

```json
// Solicitud
{ "tipo": "BOMBA_ENCENDER", "actuador": "BOMBA1", "parametros": { "duracion_s": 10 }, "ttl_s": 30 }

// 201 Created
{
  "data": {
    "id": 1287, "tipo": "BOMBA_ENCENDER", "actuador": "BOMBA1", "parametros": { "duracion_s": 10 },
    "estado": "PENDIENTE", "origen": "WEB",
    "creada_en": "2026-10-15T20:31:00Z", "expira_en": "2026-10-15T20:31:30Z",
    "solicitada_por": { "id": 1, "nombre": "Administrador" },
    "canceladas": [], "advertencias": []
  }
}
```

- Cabecera opcional `Idempotency-Key` (≤ 64 caracteres). Si se repite una clave del mismo usuario, se devuelve la orden original con `200` en lugar de crear otra.
- `parametros` es inmutable: el servidor guarda la `duracion_s` solicitada y el ESP32 informa `duracion_aplicada_s`. La web muestra las dos.
- Comprobaciones previas para `BOMBA_ENCENDER`, orientativas (decide el ESP32):
  - `409 DISPOSITIVO_FUERA_DE_LINEA`
  - `409 MODO_NO_MANUAL` (modo configurado o efectivo distinto de `MANUAL`)
  - `409 BLOQUEO_ACTIVO`
  - `409 CONFIG_NO_SINCRONIZADA`
  - `409 APAGADO_PENDIENTE`
  - `409 CALIBRACION_NO_CONFIRMADA`
  - `409 HARDWARE_NO_CONFIRMADO`
  - `422 DURACION_EXCEDE_MAXIMO` (`duracion_s` > `riego_max_s` configurado)
- `RESTABLECER_BLOQUEO`: la web envía `{ "tipo": "RESTABLECER_BLOQUEO", "actuador": "BOMBA1", "parametros": { "id_bloqueo": 7, "causa": "TIEMPO_MAXIMO", "inspeccion_confirmada": true } }`. El servidor exige:
  - Que `id_bloqueo` y `causa` coincidan con el último bloqueo reportado por la telemetría. Si no: `409 BLOQUEO_NO_COINCIDE`.
  - Que el bloqueo sea `liberable_remotamente`. Si no: `409 BLOQUEO_NO_LIBERABLE_REMOTAMENTE`.
  - Para `PREVENTIVO`, que el usuario marque explícitamente la casilla de inspección (`inspeccion_confirmada: true`). Si no: `422`.

  Los `parametros` se envían sin cambios al ESP32, que vuelve a comprobarlo todo (10.5). En la auditoría queda el usuario que confirmó.
- `BOMBA_APAGAR` siempre devuelve `201`. `canceladas` lista los `id` cancelados y `advertencias` puede incluir `DISPOSITIVO_FUERA_DE_LINEA` y `MODO_CAMBIADO_A_MANUAL`.
- La web sigue la orden con `GET /ordenes/{id}` cada segundo: *Enviada → Recibida por el ESP32 → Ejecutada ✔ / Rechazada ✖ (motivo) / Expirada ⌛ / Sin confirmar ⚠*.

### 11.5 `PATCH /actuadores/{id}/control`

```json
// Solicitud (campos opcionales)
{ "modo": "AUTOMATICO", "umbral_inicio_pct": 30, "umbral_parada_pct": 55, "riego_max_s": 15, "descanso_min_s": 60 }
// 200 OK
{ "data": { "config_version_deseada": 6, "config_version_aplicada": 5, "control": { "modo": "AUTOMATICO", "...": "..." }, "advertencias": ["RIEGO_EN_CURSO_SE_DETENDRA"] } }
```

Errores posibles:
- `422 VALIDACION_FALLIDA`, con `HISTERESIS_INSUFICIENTE`, `FUERA_DE_RANGO` o `FUERA_DE_CAPACIDAD` (`riego_max_s` > `tope_riego_s`).
- `409 BLOQUEO_ACTIVO`, `409 CALIBRACION_NO_CONFIRMADA` y `409 HARDWARE_NO_CONFIRMADO` (para `MANUAL` o `AUTOMATICO`).

---

## 12. Formato de errores y códigos

```json
{
  "error": {
    "codigo": "VALIDACION_FALLIDA",
    "mensaje": "La solicitud contiene datos inválidos.",
    "detalles": [ { "campo": "lecturas[0].valor_pct", "codigo": "FUERA_DE_RANGO", "mensaje": "Debe estar entre 0 y 100." } ]
  },
  "id_solicitud": "c0a8012e-7b1f-4a6e-9c55-1d2e3f4a5b6c"
}
```

`codigo` es estable y `mensaje` está pensado para personas. Los `5xx` nunca exponen trazas internas.

| HTTP | `codigo` | Cuándo | Acción del firmware |
|---|---|---|---|
| 400 | `JSON_INVALIDO` | El cuerpo no es JSON | Descartar y contar |
| 401 | `NO_AUTENTICADO` / `TOKEN_EXPIRADO` / `CREDENCIALES_INVALIDAS` | (web) | — |
| 401 | `TOKEN_DISPOSITIVO_INVALIDO` | Token ausente, inválido o revocado | Reintento ≤ 1/min |
| 403 | `DISPOSITIVO_DESHABILITADO` | Deshabilitado desde la web | Reintento ≤ 1/min |
| 403 | `HTTPS_REQUERIDO` | La solicitud no llegó por HTTPS | Revisar la URL |
| 403 | `PERMISO_DENEGADO` | (web) Rol insuficiente | — |
| 404 | `RECURSO_NO_ENCONTRADO` / `ORDEN_NO_ENCONTRADA` / `DISPOSITIVO_NO_ENCONTRADO` / `ACTUADOR_NO_ENCONTRADO` / `SENSOR_NO_ENCONTRADO` | — | ACK: cerrar los reintentos |
| 409 | `ORDEN_YA_FINALIZADA` / `ORDEN_NO_ENTREGADA` | ACK incoherente | Cerrar los reintentos |
| 409 | `VERSION_CONFIG_DESCONOCIDA` | — | Volver a descargar la configuración |
| 409 | `APAGADO_PENDIENTE`, `MODO_NO_MANUAL`, `BLOQUEO_ACTIVO`, `DISPOSITIVO_FUERA_DE_LINEA`, `CONFIG_NO_SINCRONIZADA`, `CALIBRACION_NO_CONFIRMADA`, `HARDWARE_NO_CONFIRMADO`, `BLOQUEO_NO_LIBERABLE_REMOTAMENTE`, `BLOQUEO_NO_COINCIDE` | (web) Orden o cambio no permitido | — |
| 409 | `CONFLICTO` | Duplicado (email, uid, código) | — |
| 413 | `CARGA_DEMASIADO_GRANDE` | > 16 KB (iot) / 100 KB (web) | Enviar lotes más pequeños |
| 422 | `VALIDACION_FALLIDA` / `DURACION_EXCEDE_MAXIMO` / `ARRANQUE_NO_COINCIDE` | Datos inválidos | Descartar y contar |
| 429 | `DEMASIADAS_SOLICITUDES` | Límite superado (`Retry-After`) | Esperar |
| 500 | `ERROR_INTERNO` | — | *Backoff* |
| 503 | `SERVICIO_NO_DISPONIBLE` | BD caída | *Backoff* |

Códigos de detalle de validación: `REQUERIDO`, `TIPO_INVALIDO`, `FUERA_DE_RANGO`, `FUERA_DE_CAPACIDAD`, `VALOR_NO_PERMITIDO`, `FORMATO_INVALIDO`, `HISTERESIS_INSUFICIENTE`, `CALIBRACION_INSUFICIENTE`, `VERSION_REGRESIVA`, `SENSOR_DESCONOCIDO`, `ACTUADOR_DESCONOCIDO`.

---

## 13. Medidas de seguridad

| Área | Medida |
|---|---|
| Transporte | Sólo HTTPS, verificando cadena y host y sin excepciones. HSTS en la web. El backend rechaza `/iot` sin HTTPS. Ensayos negativos de TLS |
| Hora | SNTP antes de HTTPS, verificación cruzada de ±30 s, plazos monotónicos y temporizadores monotónicos |
| Tokens de dispositivo | 256 bits, sólo SHA-256 en la BD, se muestran una vez, rotación con 24 h de gracia, revocación inmediata y nunca se retransmiten |
| Aprovisionamiento | Sólo con acceso físico, en NVS, nunca en el repositorio ni en los registros, y URL obligatoriamente `https://` |
| Contraseñas | bcrypt 12, mínimo 10 caracteres, bloqueo progresivo tras 5 intentos |
| Sesiones web | JWT de 15 min (HS256, secreto ≥ 32 bytes) + refresh rotativo `HttpOnly`/`Secure`/`SameSite=Strict`, revocable y con detección de reutilización |
| Autorización | Pertenencia al terreno verificada en cada consulta; un dispositivo sólo accede a lo suyo |
| Órdenes | TTL corto para encender, APAGAR prioritario, una orden por actuador, `id` crecientes y serializados, diario durable, ACK inmutable y decisión final en el ESP32 |
| Validación | `zod` en el servidor y las mismas reglas en el firmware |
| Base de datos | Consultas parametrizadas, transacciones con `FOR UPDATE` en órdenes y configuración, y usuario MySQL con privilegios mínimos |
| HTTP | `helmet`, CORS restringido, rate limiting y límite de cuerpo |
| Registros | Logs estructurados con `id_solicitud`, sin tokens, contraseñas ni `Authorization` |
| Auditoría | Órdenes, ACK en conflicto, cambios de modo y configuración (también los del sistema), tokens y permisos |
| Física | Apagado al arrancar, tope compilado, bloqueos persistentes, tareas separadas, corte de respaldo por software (`esp_timer`, con el alcance limitado de 10.7), watchdogs y brownout. **Ninguna de estas capas protege ante fallos del MCU, de su alimentación o del circuito de potencia.** Requiere verificación eléctrica, polarización externa del pin y, en una instalación real, un corte eléctrico independiente obligatorio |

### 13.1 Reglas obligatorias del backend

Estas reglas son normativas y se verifican con el Anexo B. Se aplican a `/iot` y a la API web.

#### 13.1.1 Pertenencia de recursos

| Regla | Detalle |
|---|---|
| P-1 | En `/iot`, el dispositivo es **sólo** el que resuelve el token. Ningún parámetro, cabecera ni campo del cuerpo puede seleccionar otro dispositivo |
| P-2 | Todo código de sensor o actuador (`lecturas[].sensor`, `actuadores[].actuador`, `eventos[].actuador`, `estado_actuador.actuador`) se resuelve con `WHERE dispositivo_id = :dispositivo_del_token AND codigo = ?`. Si no existe, la lectura se descarta (`SENSOR_DESCONOCIDO`) o el elemento se ignora; nunca se asocia a otro dispositivo |
| P-3 | `POST /iot/ordenes/{id}/confirmacion` busca con `WHERE id = ? AND dispositivo_id = :dispositivo_del_token`. Si la orden es de otro dispositivo, se responde igual que si no existiera (`404 ORDEN_NO_ENCONTRADA`), sin revelar que existe |
| P-4 | En la API web, cada recurso se resuelve hasta su `terreno_id` (sensor → dispositivo → terreno; orden → dispositivo → terreno; etc.) y se comprueba `usuario_terreno` **en la misma consulta o transacción** que lo lee o modifica |
| P-5 | Un usuario que **no es miembro** del terreno recibe `404` (no revela que el recurso existe). Un miembro con rol insuficiente recibe `403 PERMISO_DENEGADO`. `ADMIN` global tiene acceso a todo |
| P-6 | Las relaciones creadas o editadas deben pertenecer al mismo terreno: zona ↔ cultivo, sensor/actuador ↔ zona, `configuraciones_control.sensor_id` ↔ mismo dispositivo que el actuador. Si no: `422 VALIDACION_FALLIDA` |
| P-7 | Un `RESTABLECER_BLOQUEO` o un `PATCH` de control sólo se aceptan para actuadores del dispositivo indicado en la ruta |

#### 13.1.2 Límites numéricos y de formato

Se validan con `zod` **antes** de cualquier acceso a la BD. Un fallo devuelve `422 VALIDACION_FALLIDA` con `detalles`, salvo las lecturas individuales, que se descartan (7.1).

| Dato | Regla |
|---|---|
| Enteros en JSON | Tipo `number` entero (`Number.isSafeInteger`). Se rechazan cadenas, fracciones, `NaN`, `Infinity` y notación que pierda precisión |
| `id` de orden (cuerpo y ruta) | 1 ≤ id ≤ 9 007 199 254 740 991. En la ruta: `^[1-9][0-9]{0,15}$` y luego `≤ MAX_SAFE_INTEGER`. Antes de exponer un `id` recién insertado, la aplicación comprueba que ≤ 2^53 − 1 |
| `uptime_ms`, `desde_uptime_ms`, `max_id_orden_procesada` | 0 ≤ n ≤ 2^53 − 1 |
| `seq` | 0 ≤ n ≤ 4 294 967 295 (`INT UNSIGNED`) |
| `id_arranque` | `^[0-9a-f]{8}$`; el del cuerpo debe coincidir con `X-Id-Arranque` (salvo `id_arranque_origen` en un ACK) |
| `valor_pct` | 0.0–100.0 o `null`; se almacena redondeado a 1 decimal |
| `valor_raw` | Entero 0–4095 o `null` |
| `rssi_dbm` | Entero −120..0 |
| `duracion_s` | Entero 1–600 y ≤ `riego_max_s` configurado (`422 DURACION_EXCEDE_MAXIMO`) |
| `duracion_aplicada_s` | Entero 1–600 o `null` según 7.3 |
| `ttl_s` | Encender 10–60, apagar 30–900, rearmar 10–300 |
| Configuración | Rangos y reglas de 7.4, incluido `riego_max_s ≤ tope_riego_s` reportado |
| `id_bloqueo` | Entero 1..2^53 − 1 |
| `config_version` | Entero 0..4 294 967 295 |
| Fechas | ISO-8601 UTC con `Z` y milisegundos opcionales. Se rechazan las fechas sin zona y las que tienen otro desfase |
| Cadenas | Longitudes del esquema SQL (p. ej. `mensaje` ≤ 200, códigos `^[A-Z0-9_]{2,16}$`) |
| Enumeraciones reportadas | `^[A-Z_]{2,40}$`; se almacenan aunque no se conozcan (§2) |
| Enumeraciones del servidor | (`tipo` de orden, `modo` deseado, roles) sólo los valores definidos |
| Arreglos | `lecturas` ≤ 30, `eventos` ≤ 30, `errores` ≤ 50 |
| Cuerpo | ≤ 16 KB en `/iot` y ≤ 100 KB en la web (`413`) |

#### 13.1.3 Transacciones

| Operación | Requisitos |
|---|---|
| Crear orden; cambiar control, configuración o calibración; reconciliar modo; registrar arranque; entregar órdenes; procesar ACK; tareas de caducidad | Transacción InnoDB que **empieza** con `SELECT … FROM dispositivos WHERE id = ? FOR UPDATE` |
| Orden de bloqueo fijo | `dispositivos` → `ordenes_riego` → `actuadores` / `configuraciones_control` / `sensores` → `alertas` / `auditoria`. Ninguna transacción bloquea en otro orden (evita interbloqueos) |
| Interbloqueo o *lock wait timeout* | Reintento de toda la transacción hasta 3 veces con espera aleatoria; después, `503 SERVICIO_NO_DISPONIBLE` |
| Versión de configuración | `config_version_deseada = config_version_deseada + 1` en la misma transacción que el cambio |
| Transiciones de estado de orden | `UPDATE … WHERE id = ? AND estado IN (…estados de origen permitidos…)`, comprobando las filas afectadas. Si son 0, se relee y se decide según 7.3.2 o 8.x |
| Auditoría y alertas | En la misma transacción que la acción que las origina |
| Telemetría | Lecturas y eventos con `INSERT IGNORE` (deduplicación). Snapshot con `UPDATE` condicional por (`id_arranque`, `uptime_ms`) (7, `estado_actuador`). No requiere bloquear el dispositivo, salvo si dispara la reconciliación (9.3) o la regla de reinicio (8.5) |
| Aislamiento | `REPEATABLE READ` (por defecto en InnoDB). Las lecturas que deciden escrituras se hacen con `FOR UPDATE` |
| Zona horaria | Conexión `mysql2` con `timezone: 'Z'` y `SET time_zone = '+00:00'` |

#### 13.1.4 Inmutabilidad

1. **ACK:** el primer ACK válido escribe `resultado`, `codigo_motivo`, `mensaje`, `duracion_aplicada_s`, `ejecutada_en`, `confirmada_en`, `confirmacion_tardia`, `ack_uptime_ms`, `ack_id_arranque_origen`, `ack_id_arranque_envio`, `ack_config_version` y `ack_cuerpo` con:
   `UPDATE ordenes_riego SET … WHERE id = ? AND dispositivo_id = ? AND resultado IS NULL AND estado IN ('ENTREGADA','SIN_CONFIRMAR')`.
   Si afecta 0 filas, se relee y se aplica la equivalencia de 7.3.2: `200` sin escribir, o `409` incrementando sólo `ack_conflictos` y auditando.
2. **Orden:** `dispositivo_id`, `actuador_id`, `tipo`, `parametros`, `ttl_s`, `origen`, `solicitada_por`, `idempotency_key`, `creada_en` y `expira_en` no cambian después de insertarse.
3. **Defensa en la BD:** el *trigger* `trg_ordenes_inmutables` de `database/schema.sql` rechaza (`SIGNAL SQLSTATE '45000'`) cualquier `UPDATE` que modifique los campos del punto 2, o los campos ACK del punto 1 cuando `OLD.resultado` ya no es `NULL`. Sólo `ack_conflictos` puede cambiar después.
4. **Borrado:** las órdenes no se borran desde la aplicación (8.1). El usuario MySQL de la aplicación no tiene `DELETE` sobre `ordenes_riego` ni sobre `auditoria`. El `ON DELETE CASCADE` sólo aplica a tareas administrativas de retirada de un dispositivo, fuera de la API.
5. **Auditoría:** sólo se insertan filas en `auditoria`; nunca se actualizan ni se borran.

---

## 14. Límites y cuotas

| Recurso | Límite |
|---|---|
| `GET /iot/ordenes` por dispositivo | 40/min, en un cubo propio que nunca compite con la telemetría |
| Resto de `/iot` por dispositivo | 80/min |
| Login | 5 intentos/min por IP |
| API web | 300/min por usuario |
| Lecturas / eventos por solicitud | 30 / 30 |
| Órdenes por respuesta | 1 por actuador |
| Cuerpo `/iot` | 16 KB |

---

## 15. Ejemplos de prueba con curl

```bash
export API=https://<HOST>/api/v1
export TOKEN=agc_dev_XXXXXXXX       # token de pruebas: nunca uno real en el repositorio
H=(-H "Authorization: Bearer $TOKEN" -H "X-Id-Arranque: 9f3a12c0" -H "Content-Type: application/json")

# Telemetría
curl -sS -X POST "$API/iot/telemetria" "${H[@]}" -d '{
  "id_arranque":"9f3a12c0","uptime_ms":60000,"ts":"2026-10-15T20:31:05Z","version_firmware":"0.2.0","version_contrato":"1.0.1",
  "config_version":0,
  "seguridad":{"hardware_confirmado":true,"calibracion_confirmada":false,"tope_riego_s":600,"max_id_orden_procesada":0,"reloj_confiable":true,"persistencia_ok":true,"tls_vigencia":"VERIFICADOR"},
  "lecturas":[{"seq":1,"sensor":"HUM1","tipo":"HUMEDAD_SUELO","valor_pct":null,"valor_raw":1873,"estado":"SIN_CALIBRAR","ts":"2026-10-15T20:31:04Z","uptime_ms":59000}],
  "actuadores":[{"actuador":"BOMBA1","modo":"DESHABILITADO","estado_bomba":"APAGADA","riego_transcurrido_s":0,"riego_restante_s":0,"descanso_restante_s":0,"bloqueo":null,"id_orden_activa":null,"uptime_ms":60000}]}'

# Órdenes
curl -sS "$API/iot/ordenes" "${H[@]}"

# Confirmar
curl -sS -X POST "$API/iot/ordenes/1287/confirmacion" "${H[@]}" -d '{
  "resultado":"EJECUTADA","codigo_motivo":null,"mensaje":null,"duracion_aplicada_s":10,"ejecutada_en":"2026-10-15T20:31:03Z","id_arranque_origen":"9f3a12c0","uptime_ms":61000,"config_version":1,
  "estado_actuador":{"actuador":"BOMBA1","modo":"MANUAL","estado_bomba":"RIEGO_MANUAL","riego_transcurrido_s":0,"riego_restante_s":10,"descanso_restante_s":0,"bloqueo":null,"id_orden_activa":1287,"uptime_ms":61000}}'

# Configuración
curl -sS "$API/iot/configuracion" "${H[@]}"
```

El backend incluirá un **simulador de dispositivo** (`backend/scripts/simulador-esp32.ts`) que implementa este contrato, incluidas 8.3–8.4, 9.1 y 10.x, para validar la web sin hardware.

---

## 16. Historial de cambios

| Versión | Fecha | Autor | Cambio |
|---|---|---|---|
| 1.0.0-rc1 | 2026-10-15 | Claude | Versión inicial para revisión |
| 1.0.0-rc2 | 2026-10-15 | Revisión de Codex (sobre este archivo) | Bloqueos sin *override*, TLS sin excepciones, UUID completo, duración aplicada, ACK tardío, diario durable y casos de aceptación. Archivada íntegra en `historial/CONTRATO_API_IOT_1.0.0-rc2.md` |
| 1.0.0 | 2026-10-15 | Claude, con aprobación del responsable | Corrección tras la auditoría de consistencia. Incorpora rc2 salvo donde contradice decisiones aprobadas (ver abajo). Archivada en `historial/CONTRATO_API_IOT_1.0.0.md` |
| **1.0.1** | 2026-10-15 | Claude (arquitecto), a petición del responsable | Resuelve las ambigüedades P0/P1 del diagnóstico de compatibilidad de Codex. **Pendiente de validación por Codex** |

**Cambios rc1 → 1.0.0**

| # | Área | Cambio | Firmware |
|---|---|---|:-:|
| 1 | Órdenes | `id` de orden: **entero creciente por dispositivo** ≤ 2^53 − 1 (decisión aprobada 3; sustituye el UUID de rc1 y rc2) | ✅ |
| 2 | Órdenes | Estado `SIN_CONFIRMAR`; ACK tardío reconciliado; `EXPIRADA`/`CANCELADA` garantizan que no hubo ejecución | — |
| 3 | Órdenes | Cabecera `X-Id-Arranque`; lo entregado a un arranque anterior no se reentrega (8.5) | ✅ |
| 4 | Órdenes | Diario durable `INTENCION`/`FINAL` + marca de agua persistente + ACK persistido; `RESULTADO_INCIERTO_REINICIO` (8.4, de rc2) | ✅ |
| 5 | Órdenes | APAGAR prioritario: siempre se ejecuta, cancela encendidos pendientes, una orden por actuador, rechazo en lote (8.2–8.3) | ✅ |
| 6 | Órdenes | TTL: encender 30 s (máx. 60), apagar 300 s, rearmar 60 s; vigencia UTC + plazo monotónico justo antes de actuar | ✅ |
| 7 | Órdenes | `duracion_aplicada_s` (de rc2); el servidor conserva `duracion_s` inmutable; nuevos códigos de motivo con nombres de rc2 | ✅ |
| 8 | Órdenes | ACK inmutable: el primero gana y los conflictos se auditan (de rc2) | — |
| 9 | Modos | Tres modos deseados y efectivos `DESHABILITADO`/`MANUAL`/`AUTOMATICO` (decisión 2; rc2 dejaba el deseado en 2 modos) | ✅ |
| 10 | Modos | APAGAR en `AUTOMATICO` pasa a **`MANUAL`** (decisión 2; rc2 proponía `DESHABILITADO`); reconciliación 9.3 | ✅ |
| 11 | Modos | Arranque en `DESHABILITADO` salvo `PERMITIR_MODO_PERSISTIDO_AL_ARRANCAR` | ✅ |
| 12 | Seguridad | Encender sólo en `MANUAL` y sin ningún bloqueo (decisión 1); 11 condiciones (10.3) | ✅ |
| 13 | Seguridad | Bloqueos `CRITICO`/`PREVENTIVO` con política de liberación por causa (10.5); bloqueo preventivo desde el primer tiempo máximo; se elimina `max_riegos_maximos_consecutivos` | ✅ |
| 14 | Seguridad | Sensor inválido o caducado: corte y bloqueo inmediatos (de rc2, sin los 60 s de rc1) | ✅ |
| 15 | Config | Valores de banco de Codex (30/55 %, 15 s, 60 s, 3000/1300), marcados como no agronómicos (decisión 5) | ✅ |
| 16 | Config | `calibracion_confirmada`; se eliminan `raw_min_valido`/`raw_max_valido`; `tope_riego_s` reportado y `FUERA_DE_CAPACIDAD` | ✅ |
| 17 | Config | Una configuración nueva **apaga** el riego en curso (de rc2) y nunca libera bloqueos; versiones sólo crecientes; aplicación atómica con CRC32 | ✅ |
| 18 | Transporte | HTTPS obligatorio sin excepciones; ensayos negativos de TLS | ✅ |
| 19 | Hora | SNTP obligatorio (exigido por el responsable) + verificación cruzada de ±30 s + plazo monotónico; riesgo residual documentado (rc2 pedía RTC o hora manual) | ✅ |
| 20 | Firmware | Tareas separadas de red y control, corte de respaldo `esp_timer`, watchdog y brownout (10.7) | ✅ |
| 21 | Aprovisionamiento | NVS `agro-wifi` + `agro-api` sólo con acceso físico (4.3) | ✅ |
| 22 | Autenticación | Rotación con 24 h de gracia y revocación | — |
| 23 | Telemetría | Nuevo `estado_actuador`; `uptime_ms` de 64 bits; bloques `seguridad` y `diagnostico`; `version_contrato` | ✅ |
| 24 | Eventos | `MODO_CAMBIADO`, `BLOQUEO_ACTIVADO` (antes `BLOQUEO_SEGURIDAD`), `CONFIG_RECHAZADA`, `DATOS_DESCARTADOS`, `ordenes_inciertas` | ✅ |
| 25 | Límites | Cubo de rate limit propio para `GET /iot/ordenes` | — |
| 26 | Web | Modo configurado, modo efectivo, estado real de la bomba y fiabilidad; `acciones_permitidas`; confirmación de inspección para rearmar | — |

**Decisiones de rc2 que no se adoptaron, con su motivo**

| Propuesta rc2 | Decisión 1.0.0 | Motivo |
|---|---|---|
| UUID completo de 36 caracteres | Entero creciente | Decisión aprobada 3. Con `id` crecientes y serializados por dispositivo, la marca de agua resuelve el anti-replay sin depender de que quepan 64 UUID en NVS |
| Modo deseado sólo `MANUAL`/`AUTO` | Tres modos también en el deseado | Decisión aprobada 2; la reconciliación 9.3 mantiene coherentes deseado y efectivo |
| APAGAR deja `DESHABILITADO` | APAGAR en `AUTOMATICO` pasa a `MANUAL` | Decisión aprobada 2. `MANUAL` nunca riega por sí solo, y así el operador puede volver a encender sin reconfigurar |
| Hora inicial por RTC o puesta manual; NTP no basta | SNTP + verificación cruzada + plazos monotónicos | El responsable exigió NTP. El riesgo residual queda documentado (4.2) y la fase 3 contempla RTC/NTS |
| Rearme de tiempo máximo sólo local | Remoto **una vez por episodio**, con `id_bloqueo`, `causa` e `inspeccion_confirmada` en la orden, que el firmware verifica, y sensor válido durante 10 s. Una repetición pasa a `CRITICO`, sólo local. Los fallos de hardware y persistencia siguen siendo sólo locales | Decidido en 1.0.1 (10.5) por delegación del responsable. Permite operar el banco en remoto con evidencia verificable y un límite contra rearmes repetidos de una bomba en seco |

**Cambios 1.0.0 → 1.0.1**

| # | Observación de Codex (`INTEGRACION_API.md` §5) | Resolución | Sección | Verificación |
|---|---|---|---|---|
| 1 | P0-1: vigencia TLS sin `MBEDTLS_HAVE_TIME_DATE` | Vigencia obligatoria por la vía A (mbedTLS) o la vía B (verificador de la cadena tras el *handshake*, antes de enviar datos). Sin ninguna de las dos, no hay comunicación. `seguridad.tls_vigencia`. Sin redirecciones | 4.1 | F-16, F-20 |
| 2 | Hora: el token se enviaba antes de comprobar la hora | `GET /salud` sin token como primera solicitud de cada conexión; el token sólo se envía si \|Δ\| ≤ 30 s | 4.2, 11.1 | F-21 |
| 3 | P0-2: rearme pendiente y orden sin evidencia | Política definitiva: `id_bloqueo` persistente, `parametros` del rearme con `id_bloqueo`/`causa`/`inspeccion_confirmada` verificados por el firmware, condición objetiva de 10 s, un rearme remoto por episodio y escalado a `TIEMPO_MAXIMO_REPETIDO`; códigos `BLOQUEO_NO_COINCIDE` e `INSPECCION_NO_CONFIRMADA` | 10.5, 7.2, 11.4 | F-13, F-22, F-23, B-16 |
| 4 | P0-3: ordenación global y APAGAR frente a encendidos en cola | Coordinador único, orden ascendente para encendidos y rearmes, camino prioritario de APAGAR, `barrera_apagado` por actuador (RAM + NVS) comprobada en tres puntos, `ANULADA_POR_APAGAR`. APAGAR no mueve la marca de agua global | 8.3 | F-17, F-18 |
| 5 | P1-4: APAGAR duplicado frente a ACK inmutable | El corte se reaplica siempre; se retransmite el ACK original. Excepción expresa del servidor: los ACK `EJECUTADA` de APAGAR son equivalentes aunque cambie `SIN_CAMBIO`/`null` | 7.3.2, 8.3 | B-15 |
| 6 | P1-5: ACK históricos y `config_version` | El ACK lleva `id_arranque_origen` y `config_version`. Los ACK nunca reconcilian ni cambian modos. El snapshot sólo se actualiza desde un ACK del arranque actual y más reciente. Nunca se comparan uptimes de arranques distintos | 7.3, 7.3.2, 9.3 | B-17, B-18 |
| 7 | P1-6: presupuesto temporal de caducidad | `plazo_mono` desde el uptime de **envío** de la solicitud, en ms; en una reentrega se conserva el menor; se comprueba en tres puntos | 4.2 | F-9 |
| 8 | P1-7: principio 7 frente a operación sin red | El reloj no confiable o la falta de red sólo impiden encendidos y rearmes remotos; no apagan el automático local | Principio 7 | F-24 |
| 9 | P1-8: corte de respaldo | El *callback* sólo fuerza el GPIO y activa una bandera; persistencia diferida; enclavamiento; tolerancia ≤ duración + 2,5 s o reinicio por watchdog; evento `CORTE_RESPALDO` | 10.7, 7.6 | F-19 |
| 10 | §3: primera muestra | Sin lectura válida a los 10 s del arranque: `ERROR_SENSOR` y bloqueo `CRITICO / FALLA_SENSOR` | 10.4 | F-25 |
| 11 | P1: configuración remota | Una versión igual no tiene efecto; una mayor válida apaga e inicia el descanso; sensores y actuadores desconocidos se rechazan sin aplicación parcial | 7.4 | F-10, F-11 |
| 12 | §3 F-6: corte antes de `INTENCION` | Límite de la garantía local documentado | 8.4 (10) | F-6 |
| 13 | Revisión de 1.0.1 (1): `bloqueo.desde_uptime_ms` sin arranque de referencia ni persistencia en el snapshot | Se añaden `desde_id_arranque` y `desde_ts`, persistidos con el bloqueo e invariables tras reiniciar; reglas del servidor para mostrar `bloqueado_desde` sin restar uptimes de arranques distintos; columnas `bloqueo_desde_*` en `actuadores` | 7 (`estado_actuador`), esquema | B-22 |
| 14 | Revisión de 1.0.1 (2): faltaban reglas explícitas del backend | Nueva 13.1: pertenencia (P-1 a P-7), límites numéricos y de formato, transacciones con orden de bloqueo fijo y reintento, inmutabilidad de la orden y del ACK con *trigger* en la BD y privilegios mínimos | 13.1, esquema | B-19 a B-21 |
| 15 | Revisión de 1.0.1 (3): referencias obsoletas a `version_contrato = 1.0.0` | Ejemplos y regla actualizados a `1.0.1`; política de aceptación de versiones `1.x.y` | 7.1, 11.3, 15 | Revisión documental |
| 16 | Revisión de 1.0.1 (4): el `esp_timer` se presentaba como independiente | Tabla de alcance real (qué cubre y qué no), garantía sólo en condiciones explícitas, *interrupt watchdog*, IRAM en despacho ISR; corte eléctrico externo **obligatorio** en instalación real | 10.7, 13 | F-19 |

---

## Anexo A — Adaptaciones requeridas en el firmware (Codex)

Revisado contra `firmware-esp32/AgroControl/Control.h`, `Settings.h`, `AgroControl.ino` e `INTEGRACION_API.md` en su estado del 2026-10-15. Este anexo **no modifica** archivos de Codex.

### A.1 Ya compatible (se conserva)
- Mediana de 5 muestras, rieles ≤ 20 / ≥ 4075, dispersión > 500, margen de ±200 y fórmula del porcentaje.
- Histéresis, caducidad del sensor de 3000 ms, reloj monotónico tolerante al desbordamiento y descanso desde el arranque.
- Relé a nivel inactivo antes de `OUTPUT`, `relayActiveHigh = false`, GPIO34/GPIO26 y la barrera `hardwareConfirmed`.
- Rechazo de órdenes caducadas o con reloj desconocido; el encendido exige `Manual`, sensor fresco y válido, humedad < parada, descanso y ausencia de bloqueo.
- `clearFault()` sólo con lectura fresca y válida y bomba apagada; tras el rearme, `Disabled`.
- Sensor inválido o caducado: corte y bloqueo inmediatos.
- Wi-Fi desde NVS `agro-wifi` con reconexión no bloqueante.

### A.2 Cambios en `Control.h`

| # | Actual | Requerido (desde 1.0.0, vigente en 1.0.1; los añadidos de 1.0.1 están en A.6) |
|---|---|---|
| A2.1 | `Mode { Disabled, Automatic, Manual }` | Mismo conjunto, serializado como `DESHABILITADO` / `AUTOMATICO` / `MANUAL` |
| A2.2 | `Action::Off` ⇒ `mode_ = Mode::Disabled` | `Automatic` ⇒ `Manual`; `Manual` y `Disabled` no cambian (9.1) |
| A2.3 | OFF pasa por las comprobaciones de id, reloj, caducidad y capacidad | OFF sin esas comprobaciones (8.3, punto 2); sólo exige el canal autenticado |
| A2.4 | Sin duración por orden; el manual usa `maximumMs` | `Command.durationMs`; fin = `min(duración, maximumMs, TOPE)`; fin normal `DURACION_CUMPLIDA` sin bloqueo; `DURACION_RECORTADA` |
| A2.5 | `seen_[64]` volátil y `Result::Capacity` | Marca de agua + diario NVS `INTENCION`/`FINAL` de ≥ 16 entradas (8.4). Eliminar `Capacity` y usar `PERSISTENCIA_NO_DISPONIBLE` sólo si no hay entradas reciclables |
| A2.6 | `locked_` booleano y volátil | Tipo y causa del bloqueo, persistidos: `Timeout` (en `AUTOMATICO`) ⇒ `PREVENTIVO/TIEMPO_MAXIMO`; `SensorFault` ⇒ `CRITICO/FALLA_SENSOR`; `StaleSensor` ⇒ `CRITICO/SENSOR_CADUCADO`; `CriticalFault` ⇒ `CRITICO/FALLA_CRITICA` |
| A2.7 | `Timeout` bloquea en cualquier modo | En manual ocurre antes el fin por duración (A2.4). Superar la duración por un fallo ⇒ `CRITICO/FALLA_CRITICA` |
| A2.8 | `Result` interno | Mapear a 7.3.1: `WrongMode`⇒`MODO_INCORRECTO`, `Expired`⇒`ORDEN_CADUCADA`, `ClockUnknown`⇒`RELOJ_NO_CONFIABLE`, `Duplicate`⇒reenviar el ACK del diario o `ORDEN_DUPLICADA`, `InvalidId`⇒`PARAMETROS_INVALIDOS`, `Unsafe`⇒el código específico (`BLOQUEO_SEGURIDAD`, `SENSOR_INVALIDO`, `HUMEDAD_SUFICIENTE`, `DESCANSO_ACTIVO`, `ACTUADOR_OCUPADO`) |
| A2.9 | `uint64_t id` sin formato de red | Entero JSON 1..2^53 − 1 |
| A2.10 | — | `RESTABLECER_BLOQUEO` ⇒ `clearFault()` según la política de 10.5; causas sólo locales ⇒ `BLOQUEO_NO_LIBERABLE` |
| A2.11 | `Config` local | Cargar 7.4; `staleMs = 3000` fijo; `cooldownMs ≥ 5000`; validación atómica; `VERSION_REGRESIVA`; `FUERA_DE_CAPACIDAD`; **apagar el riego al aplicar** (9.4); una configuración no libera bloqueos |
| A2.12 | `calibrationConfirmed` sólo en compilación | Efectiva = `calibracion_confirmada` remota (y la barrera de compilación si se mantiene); se reporta |
| A2.13 | `enableAutomaticAtBoot` | Equivale a `PERMITIR_MODO_PERSISTIDO_AL_ARRANCAR` (por defecto `false`) |
| A2.14 | — | Vigencia comprobada justo antes del GPIO con UTC **y** plazo monotónico (4.2, punto 4) |

### A.3 Nuevos componentes del adaptador

| # | Componente | Ref. |
|---|---|---|
| A3.1 | Tarea de control FreeRTOS (alta prioridad, TWDT ≤ 5 s) y tarea de red separada, comunicadas por colas | 10.7 |
| A3.2 | Corte de respaldo `esp_timer` a la duración aplicada + 2 s | 10.7 |
| A3.3 | Brownout; motivo de reinicio y órdenes inciertas en `ARRANQUE` | 10.1 |
| A3.4 | SNTP antes de HTTPS; verificación cruzada de ±30 s; `reloj_confiable` | 4.2 |
| A3.5 | HTTPS con `setCACertBundle` o CA raíz, verificación de host, keep-alive, timeouts de 5/8 s y *backoff* con *jitter*. Documentar el estado de `MBEDTLS_HAVE_TIME_DATE` | 4.1, 10.8 |
| A3.6 | Aprovisionamiento NVS `agro-api` (`url`, `token`) por USB serie, sin imprimir secretos y validando `https://`. Interfaz local para liberar bloqueos sólo locales | 4.3, 10.5 |
| A3.7 | Cabeceras `Authorization` y `X-Id-Arranque`; `id_arranque` con `esp_random()`; `seq` compartido | 3, 5.1 |
| A3.8 | `uptime_ms` de 64 bits | 3 |
| A3.9 | JSON de 7.1–7.6 (se sugiere ArduinoJson 7) | 7 |
| A3.10 | Búferes: 100 lecturas y 20 eventos en RAM; ACK en el diario NVS; contadores de descarte; separados de la cola serie | 10.9 |
| A3.11 | Configuración, bloqueo, marca de agua y diario en NVS con CRC32 y escritura atómica verificada | 7.5, 8.4 |
| A3.12 | Rechazo en lote con APAGAR y procesamiento secuencial por actuador | 8.3 |

### A.4 Correspondencia de eventos

| Codex `Event` | Contrato |
|---|---|
| `Boot` | `ARRANQUE` |
| `Started` | `RIEGO_INICIADO` |
| `Wet` | `RIEGO_FINALIZADO` (`UMBRAL_ALCANZADO`) |
| `Timeout` | `RIEGO_FINALIZADO` (`TIEMPO_MAXIMO`) + `BLOQUEO_ACTIVADO` (`PREVENTIVO`) |
| `SensorFault` | `FALLA_SENSOR` + `BLOQUEO_ACTIVADO` (`CRITICO`), y `RIEGO_FINALIZADO` si estaba regando |
| `StaleSensor` | `BLOQUEO_ACTIVADO` (`CRITICO`, `SENSOR_CADUCADO`), y `RIEGO_FINALIZADO` si estaba regando |
| `CriticalFault` | `BLOQUEO_ACTIVADO` (`CRITICO`, `FALLA_CRITICA`), y `RIEGO_FINALIZADO` si estaba regando |
| `ManualOff` | `RIEGO_FINALIZADO` (`ORDEN_APAGAR`) |
| `ModeChanged` | `MODO_CAMBIADO`, y `RIEGO_FINALIZADO` (`CAMBIO_MODO`) si estaba regando |
| `Disabled` | `RIEGO_FINALIZADO` (`CAMBIO_MODO`) |
| (nuevos) | `RIEGO_FINALIZADO` (`DURACION_CUMPLIDA`, `CONFIG_ACTUALIZADA`), `BLOQUEO_LIBERADO`, `CONEXION_RECUPERADA`, `CONFIG_APLICADA`, `CONFIG_RECHAZADA`, `DATOS_DESCARTADOS` |

### A.5 Pruebas que añadir en `tests/firmware/`
Son los casos F-1 a F-25 del Anexo B que dependen del firmware.

### A.6 Adaptaciones adicionales de 1.0.1

| # | Adaptación | Ref. |
|---|---|---|
| A6.1 | Elegir y documentar la vía de vigencia TLS (A: `MBEDTLS_HAVE_TIME_DATE`; B: verificador de la cadena antes de enviar bytes) y reportar `seguridad.tls_vigencia`. Desactivar el seguimiento de redirecciones | 4.1 |
| A6.2 | Primera solicitud de cada conexión: `GET /salud` sin token; comprobar \|Δ\| ≤ 30 s antes de enviar `Authorization` | 4.2 |
| A6.3 | `plazo_mono` a partir del uptime de envío de la solicitud, conservando el menor en las reentregas | 4.2 |
| A6.4 | Coordinador único en la tarea de control; camino prioritario de APAGAR en la tarea de red (GPIO inactivo + `barrera_apagado` atómica); barrera comprobada en tres puntos; barrera persistida en NVS después del corte | 8.3 |
| A6.5 | Encendidos y rearmes en orden ascendente; APAGAR no toca la marca de agua global | 8.3 |
| A6.6 | Registro de ACK de APAGAR (RAM y, si cabe, diario) para retransmitir el original | 8.3 |
| A6.7 | ACK con `id_arranque_origen` (el arranque en que se escribió `FINAL`) y `config_version` | 7.3 |
| A6.8 | `id_bloqueo` persistente; `rearmes_remotos_episodio`; causa `TIEMPO_MAXIMO_REPETIDO`; validación de `RESTABLECER_BLOQUEO` en el orden de 10.5; condición objetiva de 10 s; interfaz local `REARMAR <id_bloqueo>` o botón | 10.5 |
| A6.9 | *Callback* del corte de respaldo mínimo (GPIO + bandera), enclavamiento y evento `CORTE_RESPALDO` | 10.7 |
| A6.10 | Bloqueo `FALLA_SENSOR` si no hay lectura válida a los 10 s del arranque | 10.4 |
| A6.11 | Configuración: una versión igual no tiene efecto; rechazo sin aplicación parcial de códigos desconocidos | 7.4 |
| A6.12 | El reloj no confiable no detiene el `AUTOMATICO` local ni corta un riego en curso | Principio 7 |

---

## Anexo B — Casos de aceptación compartidos

Basados en los casos 16.2 de rc2 y adaptados a 1.0.0. 1.0.1 añade F-17 a F-25 y B-15 a B-22. **Ninguno se ha ejecutado todavía.** Se usarán los mismos *fixtures* JSON en las pruebas del backend, en el simulador y en el adaptador del firmware.

| # | Caso | Resultado obligatorio | Lado |
|---|---|---|---|
| F-1 | `BOMBA_APAGAR` con reloj desconocido, caducado, duplicado, con bloqueo y diario lleno, en cada modo | Apaga de inmediato; `EJECUTADA` (`SIN_CAMBIO` si ya estaba apagada) | FW |
| F-2 | `BOMBA_APAGAR` en `AUTOMATICO` | Modo `MANUAL`; nunca reanuda el automático | FW + BE |
| F-3 | `BOMBA_ENCENDER` en `AUTOMATICO`, en `DESHABILITADO`, con bloqueo `CRITICO` o `PREVENTIVO`, con sensor caducado o sin calibrar, con humedad ≥ parada, en descanso o ya encendida | Rechazo con el código específico; la bomba no cambia | FW |
| F-4 | Duración solicitada 30 s, configuración 20 s y tope compilado 15 s | Riego ≤ 15 s; ACK `duracion_aplicada_s = 15`, `DURACION_RECORTADA`; sin bloqueo al terminar | FW |
| F-5 | La misma orden reentregada a mitad del riego | No renueva el temporizador; reenvía el ACK del diario | FW |
| F-6 | Corte de energía antes de `INTENCION`, entre `INTENCION` y el GPIO, entre el GPIO y `FINAL`, y entre `FINAL` y el ACK | Arranca apagada; nunca repite la orden; `RESULTADO_INCIERTO_REINICIO` si no hay `FINAL`; el ACK persistido se reenvía | FW |
| F-7 | Orden con `id` ≤ marca de agua tras un reinicio | No se ejecuta | FW |
| F-8 | Mismo `id` con otro contenido | `ID_REUTILIZADO`; no reemplaza el ACK original | FW |
| F-9 | Encendido justo en `expira_en`, con salto de UTC hacia atrás, o en una cola que cruza el plazo | `ORDEN_CADUCADA` / `RELOJ_NO_CONFIABLE` | FW |
| F-10 | Configuración nueva con un riego activo (`riego_max_s` mayor o menor) | El riego se apaga (`CONFIG_ACTUALIZADA`); nunca se prolonga | FW |
| F-11 | Configuración inválida, regresiva o por encima de la capacidad | Rechazo completo; se conserva la anterior | FW |
| F-12 | Bloqueo, reinicio, misma configuración y nueva configuración con `AUTOMATICO` | Sigue en `DESHABILITADO`; ninguna configuración libera el bloqueo | FW + BE |
| F-13 | `RESTABLECER_BLOQUEO` con la causa presente, o con `FALLA_CRITICA` o `PERSISTENCIA_NO_DISPONIBLE` | `BLOQUEO_NO_LIBERABLE` | FW |
| F-14 | Primer `TIEMPO_MAXIMO` en `AUTOMATICO` | Bloqueo `PREVENTIVO` y `DESHABILITADO` | FW |
| F-15 | Una solicitud HTTP agota los 8 s durante un riego de 5 s | Apaga a los 5 s sin esperar a la red | FW |
| F-16 | Certificado caducado, CA no confiable, otro host o URL `http://` | Sin sesión API ni envío del token; el control local continúa | FW |
| B-1 | Doble clic con la misma `Idempotency-Key` | Una sola orden | BE |
| B-2 | Encender y luego apagar antes de la entrega | El encendido queda `CANCELADA` y sólo se entrega el apagado | BE |
| B-3 | Encender con un apagado pendiente | `409 APAGADO_PENDIENTE` | BE |
| B-4 | Encendido `ENTREGADA` más un apagado nuevo | Sólo se entrega el apagado; el encendido no se reentrega | BE |
| B-5 | Encendido `ENTREGADA` y llega un `X-Id-Arranque` nuevo | `SIN_CONFIRMAR`, sin reentrega; un ACK tardío posterior se acepta | BE |
| B-6 | `ENTREGADA` sin ACK hasta vigencia + 30 s y después ACK | `SIN_CONFIRMAR` y luego final con `confirmacion_tardia` | BE |
| B-7 | ACK repetido idéntico / con otro contenido | `200` sin cambios / `409` y auditoría | BE |
| B-8 | ACK para una orden `EXPIRADA` | `409 ORDEN_NO_ENTREGADA` y alerta | BE |
| B-9 | Telemetría con un modo efectivo menor y la versión al día | El modo deseado baja y se crea una versión nueva de origen `SISTEMA` | BE |
| B-10 | Telemetría antigua que llega después de una más reciente | No sobrescribe el estado | BE |
| B-11 | Lectura o evento reenviado | Deduplicado | BE |
| B-12 | `PATCH` a `AUTOMATICO` con bloqueo, sin calibración o sin hardware confirmado | `409` | BE |
| B-13 | Solicitud `/iot` sin HTTPS | `403 HTTPS_REQUERIDO` | BE |
| B-14 | Token rotado: el anterior durante la gracia, después y tras el primer uso del nuevo | Válido / inválido / inválido | BE |
| F-17 | `BOMBA_ENCENDER` (id 10) en cola o escribiendo `INTENCION` cuando llega `BOMBA_APAGAR` (id 11) del mismo actuador | El relé nunca se activa; id 10 `RECHAZADA / ANULADA_POR_APAGAR`; id 11 `EJECUTADA` | FW |
| F-18 | Tras F-17, reinicio y reentrega o reenvío de id 10 | No se ejecuta (barrera persistida o marca de agua) | FW |
| F-19 | Tarea de control bloqueada a propósito durante un riego de 5 s | Relé inactivo en ≤ 7,5 s, o reinicio por watchdog con arranque apagado; nunca reencendido; bloqueo `FALLA_CRITICA` | FW |
| F-20 | Núcleo con `MBEDTLS_HAVE_TIME_DATE` desactivado y servidor con certificado caducado | Vía B rechaza antes de enviar bytes; sin token transmitido | FW |
| F-21 | UTC local desfasado 60 s respecto al servidor | `GET /salud` detecta \|Δ\| > 30 s; la conexión se cierra sin enviar el token; encendidos `RELOJ_NO_CONFIABLE` | FW |
| F-22 | `RESTABLECER_BLOQUEO` con `id_bloqueo` antiguo (ya reemplazado), sin `inspeccion_confirmada` en un `PREVENTIVO`, o sin bloqueo activo | `BLOQUEO_NO_COINCIDE` / `INSPECCION_NO_CONFIRMADA` / `BLOQUEO_NO_COINCIDE` | FW |
| F-23 | `TIEMPO_MAXIMO`, rearme remoto y otro `TIEMPO_MAXIMO` sin un `UMBRAL_ALCANZADO` intermedio | Segundo bloqueo `CRITICO / TIEMPO_MAXIMO_REPETIDO`, `liberable_remotamente = false`; el rearme remoto da `BLOQUEO_NO_LIBERABLE` | FW |
| F-24 | `AUTOMATICO` activo, pérdida de SNTP/API y reloj no confiable | Sigue regando por histéresis y tiempos monotónicos; encendidos remotos rechazados; ningún riego se prolonga | FW |
| F-25 | Arranque con el sensor desconectado | A los 10 s: `ERROR_SENSOR`, bloqueo `CRITICO / FALLA_SENSOR` | FW |
| B-15 | ACK de APAGAR `EJECUTADA/null` y después `EJECUTADA/SIN_CAMBIO` para el mismo id | `200` en ambos; se conserva el primero | BE |
| B-16 | `RESTABLECER_BLOQUEO` web con `id_bloqueo` distinto del reportado, sin la casilla en un `PREVENTIVO`, o con un bloqueo sólo local | `409 BLOQUEO_NO_COINCIDE` / `422` / `409 BLOQUEO_NO_LIBERABLE_REMOTAMENTE` | BE |
| B-17 | ACK reenviado tras un reinicio (`id_arranque_origen` antiguo, cabecera nueva) | La orden se cierra con `confirmacion_tardia`; el snapshot del actuador no cambia; no hay reconciliación | BE |
| B-18 | ACK del arranque actual con un `estado_actuador.uptime_ms` menor que el snapshot | Cierra la orden; el snapshot no cambia | BE |
| B-19 | El dispositivo A confirma una orden del dispositivo B; reporta un sensor de B; un usuario no miembro consulta un sensor; un `LECTOR` envía una orden | `404 ORDEN_NO_ENCONTRADA` / lectura descartada `SENSOR_DESCONOCIDO` / `404` / `403 PERMISO_DENEGADO` | BE |
| B-20 | `id` de ruta `9007199254740992`, `"10"` como cadena, `duracion_s: 10.5`, `seq: -1`, fecha sin `Z` | `422 VALIDACION_FALLIDA` en todos los casos | BE |
| B-21 | `UPDATE` directo en SQL de `parametros`, o de `resultado` en una orden ya confirmada | El *trigger* lo rechaza (`SQLSTATE 45000`); los datos no cambian | BE / BD |
| B-22 | Bloqueo activado en el arranque X; telemetría del arranque Y con el mismo `id_bloqueo` y `desde_id_arranque = X` | `bloqueado_desde` se toma de `desde_ts` o del evento; nunca se calcula con el uptime de Y | BE |

Para declarar la conformidad: contrato aprobado (✅), esquema revisado, pruebas del backend y del adaptador C++ compiladas y aprobadas con estos casos, ensayo integrado por HTTPS y pruebas físicas documentadas.
