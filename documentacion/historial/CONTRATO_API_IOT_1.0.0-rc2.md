# Contrato API IoT — AgroControl IoT

| Campo | Valor |
|---|---|
| Versión del contrato | **1.0.0-rc2** (borrador para revisión; NO aprobado) |
| Fecha | 2026-10-15 |
| Prefijo base | `https://<HOST>/api/v1` |
| Consumidores | Firmware ESP32 (Codex), Frontend web (Claude) |
| Proveedor | Backend Node.js + Express (Claude) |

> Este documento es la **fuente de verdad** de la integración entre el firmware ESP32 y el backend.
> Ningún lado puede cambiar nombres de campos, rutas, códigos o semántica sin incrementar la versión
> del contrato y registrar el cambio en la sección [15. Historial de cambios](#15-historial-de-cambios).

**Alcance de rc2:** incorpora la revisión de `firmware-esp32/INTEGRACION_API.md`. Las semánticas rc1 se sustituyen antes de publicar v1 estable. No implica que firmware, backend o esquema SQL ya sean conformes. Ver [16. Coordinación y aceptación](#16-coordinación-y-aceptación).

---

## Índice

1. [Principios](#1-principios)
2. [Convenciones generales](#2-convenciones-generales)
3. [Identificadores y vocabulario](#3-identificadores-y-vocabulario)
4. [Autenticación](#4-autenticación)
5. [Flujo de comunicación del dispositivo](#5-flujo-de-comunicación-del-dispositivo)
6. [Endpoints del dispositivo (`/iot`)](#6-endpoints-del-dispositivo-iot)
7. [Ciclo de vida de las órdenes](#7-ciclo-de-vida-de-las-órdenes)
8. [Configuración y modo automático](#8-configuración-y-modo-automático)
9. [Comportamiento obligatorio del firmware (seguridad)](#9-comportamiento-obligatorio-del-firmware-seguridad)
10. [Endpoints de usuario (plataforma web)](#10-endpoints-de-usuario-plataforma-web)
11. [Formato de errores y códigos](#11-formato-de-errores-y-códigos)
12. [Medidas de seguridad](#12-medidas-de-seguridad)
13. [Límites y cuotas](#13-límites-y-cuotas)
14. [Ejemplos de prueba con curl](#14-ejemplos-de-prueba-con-curl)
15. [Historial de cambios](#15-historial-de-cambios)
16. [Coordinación y aceptación](#16-coordinación-y-aceptación)

---

## 1. Principios

1. **El ESP32 siempre inicia la comunicación** (modelo *pull* por HTTPS). El servidor nunca abre conexiones hacia el dispositivo. Esto funciona detrás del NAT del hotspot de la tablet sin configurar puertos.
2. **El control automático vive en el ESP32.** El servidor sólo guarda la *configuración deseada*; el lazo de control (histéresis, tiempo máximo, descanso) se ejecuta localmente y sigue funcionando sin Internet.
3. **Estado deseado vs. órdenes.**
   - Lo que debe *persistir* (modo MANUAL/AUTO, umbrales, tiempos, calibración) es **configuración versionada**.
   - Lo que es *una acción puntual* (encender la bomba 30 s, apagarla ya) es una **orden** con confirmación.
4. **Ninguna orden puede encender la bomba de forma indefinida.** Toda orden de encendido lleva duración obligatoria y el firmware aplica un tope absoluto propio.
5. **Fallo seguro:** ante cualquier duda (reinicio, sensor inválido, datos corruptos, orden mal formada) la bomba queda **APAGADA**.
6. **Idempotencia:** el dispositivo puede reenviar mediciones, eventos y confirmaciones sin crear duplicados.

---

## 2. Convenciones generales

| Aspecto | Convención |
|---|---|
| Transporte | HTTPS (TLS 1.2+) con cadena de confianza, nombre del servidor y vigencia validados, también en las pruebas del dispositivo. Sin excepciones inseguras. |
| Formato | JSON UTF-8, `Content-Type: application/json` |
| Nombres de campos | `snake_case`, en español, sin tildes ni `ñ` |
| Enumeraciones | `MAYUSCULAS_CON_GUION_BAJO` |
| Fechas | ISO-8601 en **UTC** con `Z`: `2026-10-15T20:31:05Z` (milisegundos opcionales) |
| Porcentajes | Número decimal 0.0–100.0 con máximo 1 decimal |
| Duraciones | Enteros en segundos, sufijo `_s` (`duracion_s`); milisegundos con sufijo `_ms` |
| Respuesta exitosa | `{ "data": { ... } }` |
| Respuesta de error | `{ "error": { "codigo", "mensaje", "detalles?" }, "id_solicitud" }` |
| Trazabilidad | El servidor devuelve la cabecera `X-Request-Id` en todas las respuestas |
| Campos desconocidos | El servidor **ignora** campos extra; el firmware **debe ignorar** campos que no conoce (compatibilidad hacia adelante) |
| Versión | La versión mayor va en la ruta (`/api/v1`). Cambios incompatibles ⇒ `/api/v2` |

### Hora del servidor

Todas las respuestas JSON exitosas del espacio `/iot` incluyen `hora_servidor`. Las respuestas 304 no tienen cuerpo. La hora recibida sobre TLS ya validado sirve para contrastar/sincronizar UTC; no permite omitir la validación TLS inicial. Ver 9.9 para arranque del reloj y rechazo seguro.

---

## 3. Identificadores y vocabulario

| Concepto | Identificador | Ejemplo | Notas |
|---|---|---|---|
| Dispositivo | `uid` | `AGC-ESP32-0001` | Único global. El dispositivo **no** lo envía: lo deduce el servidor a partir del token. |
| Sensor | `codigo` | `HUM1` | Único **dentro del dispositivo**. `[A-Z0-9_]{2,16}` |
| Actuador (relé/bomba/válvula) | `codigo` | `BOMBA1` | Único **dentro del dispositivo**. `[A-Z0-9_]{2,16}` |
| Orden | `id` (UUID v4) | `5f1c2a8e-8a4b-4b8e-9a51-2f7c0d3e1a77` | Cadena canónica minúscula de 36 caracteres; generada por el servidor e inmutable. No convertir a uint64 ni usar hashes truncados para deduplicar. |
| Arranque del firmware | `id_arranque` | `9f3a12c0` | 8 caracteres hex aleatorios generados en cada encendido |
| Secuencia | `seq` | `1042` | Entero creciente por arranque, compartido por lecturas y eventos |

**Configuración del prototipo de hoy:** un dispositivo `AGC-ESP32-0001` con un sensor `HUM1` (capacitivo D43) y un actuador `BOMBA1` (relé + mini bomba). El contrato ya admite N sensores y N actuadores por dispositivo.

### Enumeraciones

| Enumeración | Valores |
|---|---|
| `modo` | Deseado: `MANUAL`, `AUTO`. Efectivo en telemetría/ACK: `DESHABILITADO`, `MANUAL`, `AUTO`. `DESHABILITADO` prohíbe todo ON hasta habilitación explícita segura. |
| `tipo_sensor` | `HUMEDAD_SUELO` (futuro: `TEMPERATURA_AMBIENTE`, `HUMEDAD_AMBIENTE`, `NIVEL_TANQUE`, `CAUDAL`) |
| `tipo_actuador` | `BOMBA`, `VALVULA` |
| `estado_lectura` | `OK`, `FUERA_DE_RANGO`, `ERROR_SENSOR`, `SIN_CALIBRAR` |
| `tipo_orden` | `BOMBA_ENCENDER`, `BOMBA_APAGAR`, `RESTABLECER_BLOQUEO` |
| `estado_orden` | `PENDIENTE`, `ENTREGADA`, `EJECUTADA`, `FALLIDA`, `RECHAZADA`, `EXPIRADA`, `CANCELADA` |
| `motivo_actuador` | `REPOSO`, `MANUAL_ORDEN`, `AUTO_UMBRAL`, `DESCANSO`, `BLOQUEO_SEGURIDAD`, `FALLA_SENSOR` |
| `tipo_evento` | Ver sección 6.5 |

---

## 4. Autenticación

### 4.1 Dispositivos (ESP32)

- Cada dispositivo tiene un **token secreto propio**, generado por el servidor al registrar el dispositivo en la web.
- Formato: `agc_dev_` + 43 caracteres base64url (256 bits aleatorios). Ej.: `agc_dev_Xy3...`
- Se envía en **todas** las solicitudes `/iot`:

```http
Authorization: Bearer agc_dev_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- El servidor guarda sólo el **hash SHA-256** del token y sus primeros 12 caracteres (`token_prefijo`) para identificarlo en la interfaz. El token completo se muestra **una sola vez** al crearlo o rotarlo.
- El token se puede **rotar** o **revocar** desde la web. Un token revocado devuelve `401 TOKEN_DISPOSITIVO_INVALIDO`.
- Un dispositivo con estado `DESHABILITADO` recibe `403 DISPOSITIVO_DESHABILITADO`.
- En el firmware, el token y las credenciales Wi-Fi se aprovisionan fuera del repositorio y se guardan en NVS. El adaptador actual solo lee Wi-Fi de NVS; token y aprovisionamiento están pendientes. Nunca se versiona un secreto real. NVS sin cifrado no asegura protección en reposo.

> Justificación (ADR-004 en `ARQUITECTURA.md`): un token Bearer de alta entropía sobre TLS es seguro, simple de implementar en el ESP32 y suficiente para el prototipo. mTLS o firmas HMAC quedan como mejora futura.

### 4.2 Usuarios (plataforma web)

- `POST /api/v1/auth/login` con email y contraseña ⇒ devuelve un **token de acceso JWT** (15 min) en el cuerpo y un **token de refresco** (7 días) en una cookie `HttpOnly; Secure; SameSite=Strict`.
- El frontend envía `Authorization: Bearer <jwt>` en cada solicitud y renueva con `POST /api/v1/auth/refresh` (rotación del token de refresco en cada uso).
- Contraseñas con **bcrypt** (costo 12).
- Roles globales: `ADMIN`, `USUARIO`.
- Permisos por terreno (`usuario_terreno.rol`):

| Rol en terreno | Ver | Enviar órdenes | Cambiar configuración / modo | Administrar cultivos, zonas, dispositivos, miembros |
|---|:-:|:-:|:-:|:-:|
| `LECTOR` | ✅ | ❌ | ❌ | ❌ |
| `OPERADOR` | ✅ | ✅ | ✅ | ❌ |
| `PROPIETARIO` | ✅ | ✅ | ✅ | ✅ |
| (global) `ADMIN` | ✅ todo | ✅ | ✅ | ✅ + gestión de usuarios |

---

## 5. Flujo de comunicación del dispositivo

```
 ESP32                                                        Backend
   │                                                             │
   │──(1) GET /iot/configuracion  (al arrancar) ────────────────►│
   │◄──────────────── config v4 (o 304 si no cambió) ────────────│
   │──(2) POST /iot/configuracion/confirmacion {v4, APLICADA} ──►│
   │                                                             │
   │   ┌─── cada intervalo_ordenes_s (por defecto 3 s) ───┐       │
   │──(3) GET /iot/ordenes ─────────────────────────────────────►│
   │◄──── { ordenes:[...], config_version: 4, hora_servidor } ───│
   │   │ si config_version ≠ aplicada ⇒ repetir (1) y (2)  │      │
   │   │ por cada orden: validar ⇒ ejecutar ⇒              │      │
   │──(4) POST /iot/ordenes/{id}/confirmacion ─────────────────►│
   │   └───────────────────────────────────────────────────┘       │
   │                                                             │
   │   ┌─── cada intervalo_telemetria_s (por defecto 10 s) ─┐     │
   │──(5) POST /iot/telemetria  (lecturas + estado) ────────────►│
   │   └───────────────────────────────────────────────────┘       │
   │                                                             │
   │──(6) POST /iot/eventos  (cuando ocurre algo relevante) ────►│
```

- **Latencia esperada** de una orden web ⇒ bomba: ≤ `intervalo_ordenes_s` + RTT (≈ 3–5 s).
- **Presencia:** cualquier solicitud `/iot` autenticada actualiza `ultima_conexion_en`. El servidor considera el dispositivo:
  - `EN_LINEA` si la última conexión fue hace ≤ 30 s,
  - `INESTABLE` si fue hace 30–120 s,
  - `FUERA_DE_LINEA` si fue hace > 120 s (genera alerta `DISPOSITIVO_FUERA_DE_LINEA`).
- Si el servidor no responde, el firmware **continúa** con el control local y reintenta con *backoff* (ver 9.8).

---

## 6. Endpoints del dispositivo (`/iot`)

Todos requieren `Authorization: Bearer <token_dispositivo>`. Tamaño máximo de cuerpo: **16 KB**.

| # | Método | Ruta | Propósito |
|---|---|---|---|
| 6.1 | `POST` | `/api/v1/iot/telemetria` | Enviar humedad y estado del dispositivo |
| 6.2 | `GET` | `/api/v1/iot/ordenes` | Consultar órdenes pendientes (y versión de configuración) |
| 6.3 | `POST` | `/api/v1/iot/ordenes/{id}/confirmacion` | Confirmar ejecución, rechazo o falla de una orden |
| 6.4 | `GET` | `/api/v1/iot/configuracion` | Descargar la configuración deseada |
| 6.4b | `POST` | `/api/v1/iot/configuracion/confirmacion` | Confirmar que la configuración se aplicó |
| 6.5 | `POST` | `/api/v1/iot/eventos` | Reportar eventos locales (riego automático, fallas, reinicio) |

### 6.1 `POST /iot/telemetria` — enviar humedad y estado

Se envía cada `intervalo_telemetria_s`. Si hubo pérdida de conexión, el firmware puede enviar en `lecturas` las mediciones almacenadas en su búfer (máx. **30 lecturas por solicitud**, las más antiguas primero).

**Solicitud**

```json
{
  "id_arranque": "9f3a12c0",
  "uptime_ms": 3600123,
  "ts": "2026-10-15T20:31:05Z",
  "version_firmware": "0.1.0",
  "config_version": 4,
  "red": {
    "rssi_dbm": -61,
    "ip_local": "192.168.43.21"
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
  "actuadores": [
    {
      "actuador": "BOMBA1",
      "encendido": false,
      "modo": "AUTO",
      "motivo": "REPOSO",
      "encendido_desde_s": 0,
      "descanso_restante_s": 0,
      "bloqueado": false
    }
  ]
}
```

| Campo | Tipo | Oblig. | Reglas |
|---|---|:-:|---|
| `id_arranque` | string | ✅ | 8 hex. Cambia en cada reinicio. |
| `uptime_ms` | entero | ✅ | Milisegundos desde el arranque al momento del envío. |
| `ts` | string \| null | ❌ | Hora UTC del dispositivo si está sincronizada por NTP; si no, `null`. |
| `version_firmware` | string | ✅ | SemVer, máx. 16 caracteres. |
| `config_version` | entero | ✅ | Versión de configuración **aplicada** actualmente (0 = ninguna, valores por defecto). |
| `red.rssi_dbm` | entero | ❌ | −120..0 |
| `red.ip_local` | string | ❌ | IPv4 local. |
| `lecturas[]` | arreglo | ✅ | 0–30 elementos. |
| `lecturas[].seq` | entero | ✅ | ≥ 0, creciente en el arranque. Clave de deduplicación: (`id_arranque`, `seq`). |
| `lecturas[].sensor` | string | ✅ | Código de sensor registrado en el servidor. |
| `lecturas[].tipo` | enum | ✅ | `HUMEDAD_SUELO` en v1. |
| `lecturas[].valor_pct` | número \| null | ✅ | 0.0–100.0; `null` si `estado` ≠ `OK`. |
| `lecturas[].valor_raw` | entero \| null | ✅ | Lectura ADC filtrada (0–4095). |
| `lecturas[].estado` | enum | ✅ | `OK`, `FUERA_DE_RANGO`, `ERROR_SENSOR`, `SIN_CALIBRAR`. |
| `lecturas[].ts` | string \| null | ❌ | Hora UTC de la medición si se conoce. |
| `lecturas[].uptime_ms` | entero | ✅ | Uptime al medir. |
| `actuadores[]` | arreglo | ✅ | Estado **actual real** de cada actuador. |
| `actuadores[].encendido` | bool | ✅ | Estado físico ordenado al relé. |
| `actuadores[].modo` | enum | ✅ | Modo **efectivo** en el dispositivo. |
| `actuadores[].motivo` | enum | ✅ | Por qué está en ese estado (ver enumeración `motivo_actuador`). |
| `actuadores[].encendido_desde_s` | entero | ✅ | Segundos que lleva encendido (0 si apagado). |
| `actuadores[].descanso_restante_s` | entero | ✅ | Segundos de descanso restantes antes de permitir otro riego automático. |
| `actuadores[].bloqueado` | bool | ✅ | `true` si el control automático está bloqueado por seguridad (ver 9.4). |

**Cálculo de la hora de la lectura en el servidor:** si `lecturas[].ts` es válido y está a menos de 24 h de la hora del servidor, se usa. En otro caso se calcula `medido_en = recibido_en − (uptime_ms_envio − lecturas[].uptime_ms)`.

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

- `descartadas`: lista de `{ "seq": n, "codigo": "SENSOR_DESCONOCIDO" }` para lecturas inválidas individualmente. Una lectura inválida **no** invalida el lote completo.
- Si `config_version` ≠ versión aplicada ⇒ el firmware debe descargar la configuración (6.4).
- Si `ordenes_pendientes` > 0 ⇒ el firmware puede consultar órdenes inmediatamente sin esperar al siguiente ciclo.

**Errores:** `400 JSON_INVALIDO`, `401 TOKEN_DISPOSITIVO_INVALIDO`, `403 DISPOSITIVO_DESHABILITADO`, `413 CARGA_DEMASIADO_GRANDE`, `422 VALIDACION_FALLIDA`, `429 DEMASIADAS_SOLICITUDES`.

---

### 6.2 `GET /iot/ordenes` — consultar órdenes pendientes

Se llama cada `intervalo_ordenes_s`. Devuelve hasta **5** órdenes no finalizadas y no expiradas: primero OFF y luego las demás por creación, con UUID como desempate estable.

**Respuesta `200 OK`**

```json
{
  "data": {
    "ordenes": [
      {
        "id": "5f1c2a8e-8a4b-4b8e-9a51-2f7c0d3e1a77",
        "tipo": "BOMBA_ENCENDER",
        "actuador": "BOMBA1",
        "parametros": { "duracion_s": 30 },
        "creada_en": "2026-10-15T20:31:00Z",
        "expira_en": "2026-10-15T20:32:00Z"
      }
    ],
    "config_version": 5,
    "hora_servidor": "2026-10-15T20:31:03.120Z"
  }
}
```

- Si no hay órdenes: `"ordenes": []` (siempre `200`, nunca `204`, para simplificar el firmware).
- Al entregarla, el servidor cambia la orden de `PENDIENTE` a `ENTREGADA`.
- Una orden `ENTREGADA` sin confirmar se vuelve a entregar mientras no expire. El firmware guarda de forma durable UUID completo, contenido inmutable, estado de procesamiento y confirmación según 9.10. Una repetición no conmuta el relé ni renueva el temporizador: reenvía la confirmación persistida.
- El servidor nunca entrega órdenes cuya `expira_en` ya pasó.

**Parámetros por tipo de orden**

| `tipo` | `parametros` | Efecto en el ESP32 |
|---|---|---|
| `BOMBA_ENCENDER` | `{ "duracion_s": 1..600 }` (obligatorio) | Solo en modo efectivo `MANUAL`, sin ningún bloqueo, con sensor válido/fresco/calibrado, humedad inferior al umbral superior, bomba apagada y descanso cumplido. Duración máxima `min(duracion_s, riego_max_s, TOPE_ABSOLUTO_RIEGO_S)`; nunca prorroga un riego activo. En `AUTO` se rechaza. |
| `BOMBA_APAGAR` | `{}` | OFF inmediato incluso si ya está apagado o bloqueado. Deja modo efectivo `DESHABILITADO` e inhibición persistente; nunca reanuda AUTO por sí solo. Resultado `EJECUTADA` si el apagado lógico se aplicó. |
| `RESTABLECER_BLOQUEO` | `{}` | Solicita recuperación explícita, solo tras desaparecer la causa y cumplir 9.4. No fuerza un desbloqueo. El resultado queda `DESHABILITADO` y OFF; habilitar requiere una nueva configuración válida. |

La caducidad es la fecha límite para **iniciar** ON o aplicar RESTABLECER, no para recibir ACK ni para terminar el riego. Se rechazan si UTC es desconocido o `ahora >= expira_en`, y se comprueba inmediatamente antes del efecto, no solo al descargar. Para un OFF autenticado, dirigido al actuador correcto, se permite apagar aun sin UTC o si venció después de descargarlo: el servidor no vuelve a entregar órdenes vencidas. Un OFF no queda bloqueado por fallos de almacenamiento o por la cola de ON; los errores de persistencia se reportan y mantienen inhibidos futuros ON.

Cada orden es inmutable en UUID, dispositivo, actuador, tipo, parámetros y fechas. Mismo UUID con contenido diferente: rechazar con `ID_REUTILIZADO`, conservar el registro original y generar auditoría; nunca ejecutar el contenido nuevo. No se acepta un campo JSON `authorized` como autenticación.

**Errores:** `401`, `403`, `429`.

---

### 6.3 `POST /iot/ordenes/{id}/confirmacion` — confirmar ejecución

El firmware registra un resultado final por orden y reintenta el mismo ACK hasta obtener respuesta definitiva. La transmisión es al menos una vez; no se promete ejecución física exactamente una vez ante cortes de energía. Ver 9.10.

**Solicitud**

```json
{
  "resultado": "EJECUTADA",
  "codigo_motivo": "DURACION_RECORTADA",
  "mensaje": null,
  "ejecutada_en": "2026-10-15T20:31:03Z",
  "uptime_ms": 3601200,
  "duracion_aplicada_s": 15,
  "estado_actuador": {
    "actuador": "BOMBA1",
    "encendido": true,
    "modo": "MANUAL",
    "motivo": "MANUAL_ORDEN",
    "encendido_desde_s": 0,
    "descanso_restante_s": 0,
    "bloqueado": false
  }
}
```

| Campo | Tipo | Oblig. | Reglas |
|---|---|:-:|---|
| `resultado` | enum | ✅ | `EJECUTADA`, `RECHAZADA`, `FALLIDA` |
| `codigo_motivo` | string \| null | ✅ si ≠ `EJECUTADA` | Ver tabla siguiente |
| `mensaje` | string \| null | ❌ | Máx. 200 caracteres |
| `ejecutada_en` | string \| null | ❌ | Hora UTC si se conoce |
| `uptime_ms` | entero | ✅ | Uptime al ejecutar |
| `estado_actuador` | objeto | ✅ | Mismo formato que `actuadores[]` de 6.1, tras procesar la orden |
| `duracion_aplicada_s` | entero \| null | ✅ | ON ejecutado: 1..600, limitado a los tres topes; otros resultados/tipos: `null`. Se persiste y no cambia en reintentos. |

**Significado de `resultado`:**

- `EJECUTADA`: se aplicó el mando lógico solicitado. No demuestra caudal ni posición física de contactos sin realimentación. Para ON confirma el inicio, no la finalización del riego; esta se reporta mediante evento.
- `RECHAZADA`: no se inició la acción solicitada por validación/seguridad. Un corte preventivo local puede haber apagado un riego previo y debe reportarse por separado.
- `FALLIDA`: fallo detectado o resultado incierto tras reinicio (`RESULTADO_INCIERTO_REINICIO`); no se reintenta la activación.

**Códigos de motivo (`codigo_motivo`):**

| Código | Uso |
|---|---|
| `ACTUADOR_DESCONOCIDO` | El código de actuador no existe en el firmware |
| `TIPO_DESCONOCIDO` | Tipo de orden no soportado por esta versión de firmware |
| `PARAMETROS_INVALIDOS` | Falta `duracion_s` o está fuera de rango |
| `BLOQUEO_SEGURIDAD` | Hay una condición de seguridad activa que impide encender |
| `ERROR_HARDWARE` | Fallo físico detectado al conmutar |
| `DURACION_RECORTADA` | (Con `EJECUTADA`) se ejecutó pero se recortó la duración al tope permitido |
| `MODO_INCORRECTO` | ON recibido en AUTO o DESHABILITADO |
| `ORDEN_CADUCADA` | ON/RESTABLECER evaluados al alcanzar o superar `expira_en` |
| `RELOJ_NO_CONFIABLE` | No es posible verificar vigencia de ON/RESTABLECER |
| `SENSOR_INVALIDO` | Sensor sin calibración, inválido, no finito o con lectura de antigüedad >= 3000 ms |
| `DESCANSO_ACTIVO` | Falta cumplir el mínimo de descanso/antirrebote |
| `ACTUADOR_OCUPADO` | ON nuevo durante un riego: no extender duración |
| `PERSISTENCIA_NO_DISPONIBLE` | No puede reservarse/confirmarse registro durable; nunca iniciar ON |
| `RESULTADO_INCIERTO_REINICIO` | Había intención de ejecución persistida sin resultado confirmado al reiniciar |
| `ID_REUTILIZADO` | UUID conocido con contenido inmutable diferente; no reemplaza el resultado original |

**Respuesta `200 OK`**

```json
{
  "data": {
    "id": "5f1c2a8e-8a4b-4b8e-9a51-2f7c0d3e1a77",
    "estado": "EJECUTADA",
    "hora_servidor": "2026-10-15T20:31:03.900Z"
  }
}
```

**Idempotencia:** el backend guarda transaccionalmente el primer ACK completo. Repetir su contenido semántico devuelve `200` sin sobrescribir estado, snapshot, duración ni fechas originales. Otro contenido devuelve `409 ORDEN_YA_FINALIZADA`; se conserva evidencia local y se audita el conflicto. UUID con contenido de orden alterado tampoco modifica el ACK original. Consultas y confirmaciones verifican pertenencia al dispositivo.

**Errores:** `404 ORDEN_NO_ENCONTRADA` (no existe o pertenece a otro dispositivo — el firmware la descarta), `409 ORDEN_YA_FINALIZADA`, `422 VALIDACION_FALLIDA`.

> Una orden ENTREGADA acepta su primer ACK aunque llegue después de `expira_en`; no se convierte automáticamente en EXPIRADA. La ausencia de ACK genera alerta y estado visible «resultado desconocido», sin afirmar que la bomba no se activó. El backend no exige `ejecutada_en` si es `null` tras un reinicio y no autoriza reejecutar para obtener evidencia.

---

### 6.4 `GET /iot/configuracion` — descargar configuración

Se llama al arrancar y cada vez que el servidor informa una `config_version` distinta a la aplicada.

Soporta caché condicional: el firmware puede enviar `If-None-Match: "4"`; si la versión no cambió, la respuesta es `304 Not Modified` sin cuerpo.

**Respuesta `200 OK`** (cabecera `ETag: "5"`)

```json
{
  "data": {
    "config_version": 5,
    "intervalo_telemetria_s": 10,
    "intervalo_ordenes_s": 3,
    "sensores": [
      {
        "sensor": "HUM1",
        "tipo": "HUMEDAD_SUELO",
        "raw_seco": 3000,
        "raw_humedo": 1250,
        "raw_min_valido": 500,
        "raw_max_valido": 3800
      }
    ],
    "control": [
      {
        "actuador": "BOMBA1",
        "sensor": "HUM1",
        "modo": "AUTO",
        "umbral_inicio_pct": 35.0,
        "umbral_parada_pct": 55.0,
        "riego_max_s": 120,
        "descanso_min_s": 300,
        "max_riegos_maximos_consecutivos": 1
      }
    ],
    "hora_servidor": "2026-10-15T20:31:03.120Z"
  }
}
```

| Campo | Rango válido | Por defecto | Significado |
|---|---|---|---|
| `intervalo_telemetria_s` | 5–3600 | 10 | Cada cuánto enviar telemetría |
| `intervalo_ordenes_s` | 2–60 | 3 | Cada cuánto consultar órdenes |
| `raw_seco` | 0–4095 | 3000 | Lectura ADC en suelo/aire seco ⇒ 0 % |
| `raw_humedo` | 0–4095 | 1250 | Lectura ADC en agua/suelo saturado ⇒ 100 % |
| `raw_min_valido`, `raw_max_valido` | 0–4095 | 500 / 3800 | Fuera de este rango la lectura es `ERROR_SENSOR` (cable suelto, corto) |
| `modo` | `MANUAL`/`AUTO` | `MANUAL` | Modo deseado; el efectivo puede ser DESHABILITADO por seguridad |
| `umbral_inicio_pct` | 0–95 | 35 | Si humedad < este valor ⇒ inicia riego (AUTO) |
| `umbral_parada_pct` | 5–100 | 55 | Si humedad ≥ este valor ⇒ detiene riego (AUTO) |
| `riego_max_s` | 5–600 | 120 | Duración máxima de un riego (AUTO y MANUAL) |
| `descanso_min_s` | 5–86400 | 300 | Espera mínima desde arranque, recuperación y cualquier apagado antes de ON manual/automático |
| `max_riegos_maximos_consecutivos` | Solo `1` | 1 | Campo rc1 restringido: el primer máximo AUTO bloquea. En ON manual completar su duración solicitada normalmente no es fallo; ver 9.2. |

**Reglas validadas por el servidor** (y que el firmware también debe verificar):
- `umbral_parada_pct − umbral_inicio_pct ≥ 5` (histéresis mínima).
- Con el sensor capacitivo, normalmente `raw_seco > raw_humedo` (mayor valor = más seco). El firmware debe soportar ambos sentidos: `pct = (raw_seco − raw) / (raw_seco − raw_humedo) × 100`, recortado a 0–100.
- `raw_seco ≠ raw_humedo`.
- Para este prototipo, separación absoluta de calibración >=200 cuentas; puntos entre 21 y 4074 y dentro de [`raw_min_valido`, `raw_max_valido`]. Debe existir calibración confirmada localmente: los ejemplos del servidor no la certifican. La mediana fuera del intervalo de calibración ±200 cuentas o dispersión de 5 muestras >500 se considera inválida.
- El firmware puede imponer un límite compilado menor a 600 s (actualmente 15 s por defecto local). Debe reportar la duración aplicada y rechazar configuración que exceda sus capacidades en vez de confirmar parámetros que no puede cumplir. Servidor y web muestran configuración rechazada/pendiente.

### 6.4b `POST /iot/configuracion/confirmacion`

**Solicitud**

```json
{
  "config_version": 5,
  "resultado": "APLICADA",
  "errores": []
}
```

- `resultado`: `APLICADA` | `RECHAZADA`. Si `RECHAZADA`, `errores` es una lista de `{ "campo": "control[0].umbral_parada_pct", "codigo": "FUERA_DE_RANGO" }` y el firmware **conserva la configuración anterior**.
- La configuración aplicada se guarda en memoria no volátil (NVS) **antes** de confirmar.
- La actualización es atómica, monotónica por versión y no modifica temporizadores en curso: primero apaga e inicia descanso; luego valida/persiste/aplica. Versiones repetidas son idempotentes y no levantan inhibición ni bloqueo. Solo una versión **mayor**, explícitamente solicitada, puede habilitar desde DESHABILITADO cuando no hay bloqueo ni fallo presente. Cambiar modo no libera bloqueos críticos.

**Respuesta `200 OK`**: `{ "data": { "config_version_aplicada": 5, "hora_servidor": "..." } }`

**Errores:** `409 VERSION_CONFIG_DESCONOCIDA` si la versión no existe o es mayor que la deseada.

---

### 6.5 `POST /iot/eventos` — reportar eventos

Eventos discretos que ocurren en el dispositivo, especialmente los del control automático local. Se envían en cuanto ocurren; si no hay conexión, se almacenan (búfer de al menos 20 eventos) y se envían después.

**Solicitud**

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
      "datos": { "origen": "AUTO", "humedad_pct": 34.8 }
    }
  ]
}
```

| `tipo` | `datos` esperados | Genera alerta |
|---|---|---|
| `ARRANQUE` | `{ "motivo_reinicio": "POWERON" \| "WATCHDOG" \| "BROWNOUT" \| "PANIC" \| "SOFTWARE" \| "OTRO", "version_firmware" }` | Sí, si motivo ≠ `POWERON`/`SOFTWARE` |
| `RIEGO_INICIADO` | `{ "origen": "AUTO" \| "MANUAL", "humedad_pct", "id_orden"? }` | No |
| `RIEGO_FINALIZADO` | `{ "origen", "motivo_fin": "UMBRAL_ALCANZADO" \| "DURACION_CUMPLIDA" \| "TIEMPO_MAXIMO" \| "ORDEN_APAGAR" \| "FALLA_SENSOR" \| "CAMBIO_MODO" \| "TOPE_ABSOLUTO" \| "REINICIO", "duracion_s", "humedad_inicio_pct", "humedad_fin_pct", "id_orden"? }` | Sí, si `TIEMPO_MAXIMO`, `TOPE_ABSOLUTO` o `REINICIO` inesperado |
| `BLOQUEO_SEGURIDAD` | `{ "causa": "TIEMPO_MAXIMO" \| "FALLA_SENSOR" \| "CONFIGURACION_INVALIDA" \| "PERSISTENCIA_NO_DISPONIBLE" \| "FALLO_CRITICO" \| "RESULTADO_INCIERTO_REINICIO" }` | Sí (crítica) |
| `BLOQUEO_LIBERADO` | `{ "por": "ORDEN" \| "LOCAL" }`; nunca por cambio de configuración | No |
| `FALLA_SENSOR` | `{ "sensor", "valor_raw", "estado" }` | Sí |
| `SENSOR_RECUPERADO` | `{ "sensor", "valor_raw" }` | Resuelve la alerta anterior |
| `CONEXION_RECUPERADA` | `{ "sin_conexion_s" }` | No |
| `CONFIG_APLICADA` | `{ "config_version" }` | No |

**Respuesta `200 OK`**: `{ "data": { "recibidos": 1, "duplicados": 0, "hora_servidor": "..." } }`. Deduplicación por (`id_arranque`, `seq`).

El servidor reconstruye el **historial de riegos** (tabla `ciclos_riego`) a partir de `RIEGO_INICIADO` / `RIEGO_FINALIZADO`.

---

## 7. Ciclo de vida de las órdenes

```
                   ┌──────────── usuario cancela ────────────┐
                   │                                          ▼
  [creada] ──► PENDIENTE ──(GET /iot/ordenes)──► ENTREGADA   CANCELADA
                   │                                │
                   │ expira_en sin entregar         ├──(confirmación EJECUTADA)──► EJECUTADA
                   ▼                                ├──(confirmación RECHAZADA)──► RECHAZADA
                EXPIRADA                            └──(confirmación FALLIDA)────► FALLIDA
```

| Estado | Final | Descripción |
|---|:-:|---|
| `PENDIENTE` | ❌ | Creada, aún no recogida por el ESP32 |
| `ENTREGADA` | ❌ | El ESP32 la descargó; se espera confirmación |
| `EJECUTADA` | ✅ | El ESP32 confirmó la ejecución |
| `RECHAZADA` | ✅ | El ESP32 se negó (validación/seguridad) |
| `FALLIDA` | ✅ | El ESP32 intentó y falló |
| `EXPIRADA` | ✅ | Solo PENDIENTE no entregada antes de `expira_en`. ENTREGADA sin ACK permanece ENTREGADA, con resultado desconocido y alerta `ORDEN_SIN_CONFIRMAR` al vencer +30 s. |
| `CANCELADA` | ✅ | Cancelada por el usuario o **reemplazada** por una orden más nueva para el mismo actuador mientras seguía `PENDIENTE` |

Reglas:
- `ttl_s` por defecto: **60 s** (rango 10–300). Evita que una orden de encendido vieja se ejecute minutos después al volver la conexión.
- Al crear OFF, cancelar transaccionalmente ON/RESTABLECER PENDIENTES anteriores del mismo actuador. Un ON o RESTABLECER nuevo nunca cancela un OFF pendiente. OFF se entrega primero; si un lote contiene OFF y ON del mismo actuador, el dispositivo aplica OFF y rechaza ON de ese lote. Una orden ENTREGADA ya pudo ejecutarse: cancelarla en la web no equivale a apagarla. No se garantiza precedencia sobre una ON que el dispositivo ya esté procesando; para detenerla debe recibir OFF o actuar un corte local.
- Una tarea cada 5 s expira únicamente PENDIENTES; la consulta también verifica vigencia y cambia a ENTREGADA dentro de la misma transacción. La expiración no elimina órdenes ni ACK de auditoría. No volver a entregar una ENTREGADA ya vencida, pero aceptar su ACK tardío.

---

## 8. Configuración y modo automático

- La configuración deseada se almacena en el servidor con un número `config_version` que **se incrementa** en cada cambio (incluido el cambio de modo MANUAL ⇄ AUTO).
- **"Activar modo automático" desde la web** = `PATCH` de la configuración de control con `modo: "AUTO"` ⇒ nueva versión ⇒ el ESP32 la detecta en el siguiente `GET /iot/ordenes` ⇒ la descarga, la aplica, la guarda en NVS y confirma ⇒ la web muestra "Aplicado ✔".
- La web muestra siempre ambas cosas: **modo deseado** (servidor) y **modo efectivo** (reportado por telemetría). Si difieren, muestra "Pendiente de aplicar".
- Toda nueva configuración aplicada apaga el riego en curso (`CAMBIO_MODO`) y respeta descanso. Ninguna configuración extiende un riego ni borra bloqueos críticos. OFF y recuperación dejan modo efectivo DESHABILITADO aunque el deseado siga AUTO; la web muestra esta diferencia y exige nueva versión explícita para rearmar, no reenvío automático de la versión anterior.

---

## 9. Comportamiento obligatorio del firmware (seguridad)

Estas reglas son requisitos para declarar conformidad; el firmware actual aún necesita las adaptaciones de la sección 16.

### 9.1 Arranque seguro
1. Con hardware confirmado, establecer latch inactivo antes de habilitar GPIO y antes de Wi-Fi/sensores; polaridad configurable. Sin validación eléctrica, no habilitar GPIO ni bomba. El firmware no elimina transitorios de bootloader/reset: validar polarización externa y circuito real.
2. Cargar configuración, inhibición, bloqueo y diario de órdenes íntegros desde NVS; ante corrupción o incertidumbre dejar OFF y bloqueo. Arrancar siempre en modo efectivo DESHABILITADO; no restaurar ON ni reanudar órdenes. Conservar configuración deseada para diagnóstico; una habilitación explícita posterior válida inicia descanso completo y exige sensor fresco.
3. Resolver registros de ejecución incierta sin reactivar (9.10), conservar ACK pendientes y emitir ARRANQUE. El arranque no borra la deduplicación.

### 9.2 Tope absoluto
- Constante compilada `TOPE_ABSOLUTO_RIEGO_S <= 600`, inalterable remotamente. El valor local puede ser más restrictivo; registrar capacidad validada antes de aceptar configuración.
- ON manual: apagar como máximo a `min(duracion_solicitada, riego_max_s, TOPE_ABSOLUTO_RIEGO_S)` usando tiempo monotónico desde activación real. Completar la duración aceptada es `DURACION_CUMPLIDA`, no fallo; sensor inválido, umbral superior o OFF pueden detener antes. Si el watchdog de tiempo se excede o falla el control, apagar y bloquear. AUTO que termina por su máximo sin alcanzar umbral bloquea desde el primer caso.
- Sin renovación por duplicados, reconexión, cambios UTC, nuevo ON o ACK. La red no puede retrasar el apagado; verificarlo con una solicitud que agote los 8 s de timeout.

### 9.3 Lazo automático con histéresis (modo `AUTO`)
Evaluado al menos **una vez por segundo** con la humedad filtrada:

```
si sensor inválido/sin calibrar/caducado o fallo crítico → APAGAR y BLOQUEAR (también MANUAL)
si modo AUTO, apagado, sin bloqueo, habilitado, descanso = 0 y humedad < umbral_inicio_pct → ENCENDER
si encendido y humedad >= umbral_parada_pct → APAGAR (UMBRAL_ALCANZADO)
si encendido AUTO y tiempo >= máximo local → APAGAR, BLOQUEAR (TIEMPO_MAXIMO)
al apagar cualquier riego → iniciar descanso_min_s
```

- Entre `umbral_inicio_pct` y `umbral_parada_pct` el estado **no cambia** (banda de histéresis): esto evita que el relé conmute repetidamente.
- **Antirrebote del relé:** no conmutar el relé más de una vez cada **5 s** (excepto para apagar, que siempre es inmediato).

### 9.4 Bloqueos críticos y recuperación
- Sensor inválido/caducado/sin calibración, configuración corrupta, persistencia no fiable, fallo crítico de hardware/control y máximo AUTO alcanzado implican OFF, `bloqueado: true`, modo DESHABILITADO. Todo ON manual y automático se prohíbe. No hay override del operador por API.
- Persistir causa y bloqueo sin retrasar el corte. Si falla esa escritura, la persistencia no es fiable: mantener inhibición y no permitir ON. Ninguna nueva configuración, reconexión, rotación de token ni reinicio libera el bloqueo.
- RESTABLECER requiere orden vigente autenticada, bomba OFF, configuración íntegra y lectura calibrada válida con edad <3000 ms. Para máximo AUTO, fallo físico o almacenamiento se exige además reconocimiento local documentado tras inspección y desaparición de la causa. Si no existe interfaz local de reconocimiento, rechazar la recuperación remota de esas causas.
- Recuperar persiste el estado liberado, emite evento, deja DESHABILITADO e inicia descanso. Una orden ON del mismo lote no rearma. Se necesita después nueva versión explícita de configuración válida.
- Alcanzar tiempo máximo sin mejorar humedad es solo indicio: no se promete detección de marcha en seco, caudal, relé soldado o tanque vacío con el D43. Verificación eléctrica y corte independiente siguen siendo requisitos del montaje.

### 9.5 Sensor
- Preferir ADC1; GPIO32–39 corresponde al ESP32 clásico y no debe extrapolarse a C3/S3. Confirmar placa y límites eléctricos; nunca dar por compatible una salida de 5 V con el ADC.
- Filtro: mediana de 5 muestras (o equivalente).
- `raw` fuera del rango válido, rieles <=20/>=4075, dispersión >500, mediana fuera de calibración ±200, porcentaje no finito o lectura con antigüedad >=3000 ms ⇒ apagar y bloquear inmediatamente en cualquier modo, emitir FALLA_SENSOR. No esperar 60 s para cortar. SIN_CALIBRAR impide ON. Una lectura plausible no demuestra integridad de cableado/sensor.

### 9.6 Sin Internet
- El lazo automático ya habilitado sigue funcionando con configuración válida y reglas locales, sin depender de Internet. Reconectar no cambia modo, habilitación, bloqueo ni timers. Un reinicio durante la desconexión aplica 9.1, sin restaurar AUTO por sí solo.
- Un riego manual en curso termina al cumplir su duración, aunque no haya conexión.
- Las lecturas se guardan en un búfer circular (mín. **100** lecturas) y los eventos en otro (mín. **20**); al reconectar se envían por lotes (≤ 30 por solicitud).
- Evento `CONEXION_RECUPERADA` al volver.

### 9.7 Watchdog
- Watchdog de tareas activo. Cualquier reinicio deja la bomba apagada (9.1).

### 9.8 Red y reintentos
- Timeout por solicitud HTTP: **8 s**.
- Ante errores de red o `5xx`/`429`: *backoff* exponencial 2 s → 4 s → 8 s … máximo 60 s; respetar `Retry-After` si viene.
- Ante `401`/`403`: no insistir más de una vez por minuto; continuar el control local.
- Las solicitudes HTTP **no deben bloquear** el lazo de control (usar una tarea separada o garantizar que el apagado por tiempo se evalúa aunque una solicitud esté en curso).

### 9.9 TLS
- Validar cadena hasta CA confiable, hostname y vigencia. Se prohíben `setInsecure()`, HTTP del dispositivo, saltarse expiración y fallback inseguro, incluso en laboratorio. Para integración local usar CA de pruebas explícitamente instalada y hostname correcto; nunca certificados aceptados arbitrariamente. El tramo interno proxy/backend, si existe, queda aislado de la tablet y de redes no confiables.
- Antes del primer HTTPS, obtener UTC de una fuente confiable aprovisionada localmente (RTC validado o puesta en hora por operador durante aprovisionamiento seguro). NTP sin autenticación y una fecha de compilación **no constituyen** por sí solos prueba de vigencia. Si falta hora confiable, no abrir sesión autenticada ni aceptar ON/RESTABLECER remoto; las reglas locales ya habilitadas siguen por reloj monotónico.
- Tras TLS válido, `hora_servidor` ancla UTC al reloj monotónico. Una regresión UTC, discrepancia >5 s entre fuentes o pérdida de continuidad tras reinicio invalida el reloj para ON remoto hasta nueva sincronización confiable. Nunca usar el cambio UTC para extender duración de bomba. La fecha de fin de vigencia de orden se convierte a deadline monotónico y se revalida antes del efecto; usar el vencimiento más temprano si hay ajustes.
- Definir rotación de CA y ensayo de certificado vencido/hostname incorrecto antes de aprobación de integración. La provisión de hora y CA es una dependencia pendiente, no un mecanismo ya implementado.

### 9.10 Diario durable y cortes de energía

La garantía es **a lo sumo un intento de ON por UUID**, con posibilidad de resultado incierto; no exactamente una actuación física. Diario separado de los búferes de telemetría, con al menos 64 entradas y escritura atómica verificada (versión, integridad y recuperación de escritura interrumpida). No guardar por cada tick.

1. Buscar UUID completo antes de evaluar como orden nueva. Si existe ACK final, reenviarlo sin reejecutar ni actualizar su snapshot. Si existe intención no finalizada, no ejecutar otra vez.
2. Validar identidad, payload, modo, sensor, bloqueo, descanso, duración y vigencia. Antes de cualquier ON, reservar y confirmar en NVS `{uuid, contenido_inmutable, fase: INTENCION, duracion_aplicada_s, expira_en, config_version}`. Si no es posible verificar el commit durable, rechazar ON y mantener OFF. Registrar también rechazos para impedir activación tardía al reenviar.
3. Revalidar seguridad/vigencia tras escribir NVS e inmediatamente antes del GPIO. Aplicar una sola vez y persistir resultado, ACK completo y `fase: FINAL` antes de enviar. Un error de escritura posterior obliga a OFF/bloqueo; conservar INTENCION como incertidumbre, nunca repetir el efecto.
4. Al arrancar, cualquier INTENCION sin FINAL se resuelve con OFF y resultado FALLIDA/RESULTADO_INCIERTO_REINICIO, persistido antes de ACK. No afirmar que no hubo pulso: el corte pudo ocurrir entre GPIO y commit del resultado. Mantener inhibición hasta recuperación explícita.
5. FINAL sin ACK del servidor: reintentar el mismo cuerpo incluso tras `expira_en` o reinicio. Un `200` se marca durablemente como confirmado. Un `404`/`409` cierra los reintentos y exige auditoría local; nunca autoriza repetir ON.
6. No expulsar registros pendientes, inciertos ni con ACK sin confirmar para admitir ON. Se pueden reciclar registros confirmados únicamente cuando UTC confiable ya supera su expiración y esa barrera temporal se conserva durablemente; una regresión del reloj impide nuevos ON hasta resincronizar. Las órdenes vencidas nunca vuelven a activar aunque se haya reciclado el registro. No usar FIFO de los últimos 10 IDs.
7. Sin capacidad disponible, rechazar nuevas ON; OFF autenticado siempre corta inmediatamente aunque el diario esté lleno. Si no puede persistirse su ACK/inhibición, reportar fallo de persistencia, mantener OFF y bloqueo y no fabricar ACK durable. El arranque por defecto DESHABILITADO protege ante ese corte. Procesar las órdenes secuencialmente por actuador; separar la red del lazo de seguridad.

En el backend, UUID único global y contenido inmutable, transición de entrega transaccional y ACK durable en la misma transacción que estado/auditoría. No borrar automáticamente una ENTREGADA sin resultado. El ACK de inicio no cierra el ciclo físico de riego: su evento final conserva UUID y causa (incluido REINICIO).

---

## 10. Endpoints de usuario (plataforma web)

Todas requieren `Authorization: Bearer <jwt>` excepto login/refresh/salud. Las rutas de recursos verifican el rol del usuario en el terreno al que pertenece el recurso. Respuestas de listas: `{ "data": [...], "meta": { "pagina", "por_pagina", "total" } }` (parámetros `?pagina=1&por_pagina=20`, máx. 100).

### 10.1 Resumen

| Método | Ruta | Rol mínimo | Descripción |
|---|---|---|---|
| `GET` | `/salud` | público | Estado del servicio y de la base de datos |
| `POST` | `/auth/login` | público | Iniciar sesión |
| `POST` | `/auth/refresh` | cookie | Renovar token de acceso |
| `POST` | `/auth/logout` | autenticado | Cerrar sesión (revoca refresh) |
| `GET` | `/auth/me` | autenticado | Usuario actual y sus terrenos |
| `GET/POST` | `/usuarios` | ADMIN | Listar / crear usuarios |
| `PATCH` | `/usuarios/{id}` | ADMIN | Editar / desactivar usuario |
| `GET/POST` | `/terrenos` | autenticado | Listar mis terrenos / crear (el creador queda PROPIETARIO) |
| `GET/PATCH/DELETE` | `/terrenos/{id}` | LECTOR / PROPIETARIO | Detalle / editar / eliminar |
| `GET/POST/DELETE` | `/terrenos/{id}/miembros` | PROPIETARIO | Gestionar permisos |
| `GET/POST` | `/terrenos/{id}/cultivos` | LECTOR / PROPIETARIO | Cultivos del terreno |
| `PATCH/DELETE` | `/cultivos/{id}` | PROPIETARIO | Editar / eliminar cultivo |
| `GET/POST` | `/terrenos/{id}/zonas` | LECTOR / PROPIETARIO | Zonas de riego |
| `PATCH/DELETE` | `/zonas/{id}` | PROPIETARIO | Editar / eliminar zona |
| `GET` | `/zonas/{id}/riegos` | LECTOR | Historial de ciclos de riego |
| `GET/POST` | `/terrenos/{id}/dispositivos` | LECTOR / PROPIETARIO | Listar / registrar ESP32 (devuelve token una vez) |
| `GET/PATCH` | `/dispositivos/{id}` | LECTOR / PROPIETARIO | Detalle / editar |
| `POST` | `/dispositivos/{id}/token/rotar` | PROPIETARIO | Genera token nuevo e invalida el anterior |
| `GET` | `/dispositivos/{id}/estado` | LECTOR | **Panel en vivo** (humedad, bomba, conexión) |
| `POST` | `/dispositivos/{id}/sensores` | PROPIETARIO | Registrar sensor |
| `PATCH` | `/sensores/{id}` | PROPIETARIO | Editar sensor / calibración |
| `POST` | `/dispositivos/{id}/actuadores` | PROPIETARIO | Registrar actuador |
| `GET` | `/dispositivos/{id}/configuracion` | LECTOR | Configuración deseada + aplicada |
| `PATCH` | `/dispositivos/{id}/configuracion` | OPERADOR | Cambiar intervalos |
| `PATCH` | `/actuadores/{id}/control` | OPERADOR | Cambiar modo / umbrales / tiempos |
| `POST` | `/dispositivos/{id}/ordenes` | OPERADOR | **Enviar orden** (encender/apagar) |
| `GET` | `/dispositivos/{id}/ordenes` | LECTOR | Historial de órdenes |
| `GET` | `/ordenes/{id}` | LECTOR | Estado de una orden |
| `POST` | `/ordenes/{id}/cancelar` | OPERADOR | Cancelar orden `PENDIENTE` |
| `GET` | `/sensores/{id}/mediciones` | LECTOR | Historial (`?desde&hasta&agrupacion=crudo\|5m\|1h\|1d`) |
| `GET` | `/dispositivos/{id}/eventos` | LECTOR | Eventos del dispositivo |
| `GET` | `/alertas` | LECTOR | `?estado=ACTIVA&terreno_id=` |
| `POST` | `/alertas/{id}/reconocer` | OPERADOR | Marcar alerta como vista |
| `POST` | `/alertas/{id}/resolver` | OPERADOR | Cerrar alerta |

### 10.2 `POST /auth/login`

```json
// Solicitud
{ "email": "admin@agrocontrol.local", "password": "********" }

// 200 OK  (+ Set-Cookie: agc_refresh=...; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth)
{
  "data": {
    "token_acceso": "eyJhbGciOi...",
    "expira_en_s": 900,
    "usuario": { "id": 1, "nombre": "Administrador", "email": "admin@agrocontrol.local", "rol": "ADMIN" }
  }
}
```
Errores: `401 CREDENCIALES_INVALIDAS` (mensaje genérico, sin revelar si el email existe), `429 DEMASIADAS_SOLICITUDES`.

### 10.3 `GET /dispositivos/{id}/estado` — panel en vivo

```json
{
  "data": {
    "dispositivo": {
      "id": 1,
      "uid": "AGC-ESP32-0001",
      "nombre": "ESP32 Huerto Norte",
      "conexion": "EN_LINEA",
      "ultima_conexion_en": "2026-10-15T20:31:05Z",
      "segundos_desde_conexion": 2,
      "rssi_dbm": -61,
      "version_firmware": "0.1.0",
      "config_version_deseada": 5,
      "config_version_aplicada": 5,
      "config_sincronizada": true
    },
    "sensores": [
      {
        "id": 1, "codigo": "HUM1", "tipo": "HUMEDAD_SUELO", "zona": { "id": 1, "nombre": "Cama 1" },
        "ultima_lectura": { "valor_pct": 42.5, "valor_raw": 1873, "estado": "OK", "medido_en": "2026-10-15T20:31:04Z" }
      }
    ],
    "actuadores": [
      {
        "id": 1, "codigo": "BOMBA1", "tipo": "BOMBA",
        "reportado": { "encendido": false, "modo": "AUTO", "motivo": "REPOSO", "encendido_desde_s": 0, "descanso_restante_s": 0, "bloqueado": false, "reportado_en": "2026-10-15T20:31:05Z" },
        "control_deseado": { "modo": "AUTO", "umbral_inicio_pct": 35, "umbral_parada_pct": 55, "riego_max_s": 120, "descanso_min_s": 300 },
        "orden_activa": null
      }
    ],
    "alertas_activas": 0,
    "hora_servidor": "2026-10-15T20:31:07Z"
  }
}
```

La web consulta este endpoint cada **3 s** (polling) en la fase de prototipo.

### 10.4 `POST /dispositivos/{id}/ordenes` — enviar orden

```json
// Solicitud
{ "tipo": "BOMBA_ENCENDER", "actuador": "BOMBA1", "parametros": { "duracion_s": 30 }, "ttl_s": 60 }

// 201 Created
{
  "data": {
    "id": "5f1c2a8e-8a4b-4b8e-9a51-2f7c0d3e1a77",
    "tipo": "BOMBA_ENCENDER",
    "actuador": "BOMBA1",
    "parametros": { "duracion_s": 30 },
    "estado": "PENDIENTE",
    "origen": "WEB",
    "creada_en": "2026-10-15T20:31:00Z",
    "expira_en": "2026-10-15T20:32:00Z",
    "solicitada_por": { "id": 1, "nombre": "Administrador" },
    "advertencias": []
  }
}
```

- Cabecera opcional `Idempotency-Key: <uuid>` para evitar órdenes duplicadas por doble clic (válida 10 min).
- `advertencias` puede contener `DISPOSITIVO_FUERA_DE_LINEA` o `DURACION_RECORTADA`. El servidor conserva inmutable `duracion_s` solicitada y advierte si supera el límite conocido; el dispositivo calcula y confirma `duracion_aplicada_s`. Nunca modificar parámetros después de crear el UUID. La web muestra duración solicitada y aplicada.
- Errores: `404 DISPOSITIVO_NO_ENCONTRADO`, `404 ACTUADOR_NO_ENCONTRADO`, `403 PERMISO_DENEGADO`, `422 VALIDACION_FALLIDA`, `409 DISPOSITIVO_DESHABILITADO`.

La web hace seguimiento con `GET /ordenes/{id}` cada 1 s hasta un estado final, mostrando: *Enviada → Recibida por el ESP32 → Ejecutada ✔ / Rechazada ✖ / Expirada ⌛*.

### 10.5 `PATCH /actuadores/{id}/control` — modo y umbrales

```json
// Solicitud (todos los campos opcionales)
{ "modo": "AUTO", "umbral_inicio_pct": 35, "umbral_parada_pct": 55, "riego_max_s": 120, "descanso_min_s": 300 }

// 200 OK
{ "data": { "config_version_deseada": 6, "config_version_aplicada": 5, "control": { "modo": "AUTO", "...": "..." } } }
```
Errores: `422 VALIDACION_FALLIDA` (p. ej. `HISTERESIS_INSUFICIENTE`).

---

## 11. Formato de errores y códigos

```json
{
  "error": {
    "codigo": "VALIDACION_FALLIDA",
    "mensaje": "La solicitud contiene datos inválidos.",
    "detalles": [
      { "campo": "lecturas[0].valor_pct", "codigo": "FUERA_DE_RANGO", "mensaje": "Debe estar entre 0 y 100." }
    ]
  },
  "id_solicitud": "c0a8012e-7b1f-4a6e-9c55-1d2e3f4a5b6c"
}
```

- `codigo` es estable y lo usan las máquinas; `mensaje` es para humanos y puede cambiar.
- Los errores `5xx` nunca exponen trazas internas.

| HTTP | `codigo` | Cuándo | Acción del firmware |
|---|---|---|---|
| 400 | `JSON_INVALIDO` | Cuerpo no es JSON válido | Descartar el mensaje (no reintentar igual) |
| 401 | `NO_AUTENTICADO` | Falta cabecera Authorization (usuarios) | — |
| 401 | `TOKEN_DISPOSITIVO_INVALIDO` | Token ausente, inválido o revocado | Reintentar ≤ 1/min; control local continúa |
| 401 | `TOKEN_EXPIRADO` | JWT de usuario expirado | (web) refrescar token |
| 401 | `CREDENCIALES_INVALIDAS` | Login fallido | — |
| 403 | `DISPOSITIVO_DESHABILITADO` | Dispositivo deshabilitado en la web | Reintentar ≤ 1/min |
| 403 | `PERMISO_DENEGADO` | Rol insuficiente en el terreno | — |
| 404 | `RECURSO_NO_ENCONTRADO` | Ruta o recurso inexistente | — |
| 404 | `ORDEN_NO_ENCONTRADA` | Orden inexistente o de otro dispositivo | Descartar la confirmación |
| 404 | `DISPOSITIVO_NO_ENCONTRADO` / `ACTUADOR_NO_ENCONTRADO` / `SENSOR_NO_ENCONTRADO` | — | — |
| 409 | `ORDEN_YA_FINALIZADA` | Confirmación con resultado distinto al registrado | Considerar cerrada |
| 409 | `VERSION_CONFIG_DESCONOCIDA` | Confirmación de una versión inexistente | Volver a descargar configuración |
| 409 | `CONFLICTO` | Duplicado (email, uid, código) | — |
| 413 | `CARGA_DEMASIADO_GRANDE` | Cuerpo > 16 KB (iot) / 100 KB (web) | Enviar lotes más pequeños |
| 422 | `VALIDACION_FALLIDA` | Campos fuera de rango o faltantes (ver `detalles`) | Corregir; no reintentar igual |
| 429 | `DEMASIADAS_SOLICITUDES` | Límite superado (cabecera `Retry-After`) | Esperar `Retry-After` |
| 500 | `ERROR_INTERNO` | Error no controlado | Backoff y reintentar |
| 503 | `SERVICIO_NO_DISPONIBLE` | Base de datos caída / mantenimiento | Backoff y reintentar |

Códigos de detalle de validación: `REQUERIDO`, `TIPO_INVALIDO`, `FUERA_DE_RANGO`, `VALOR_NO_PERMITIDO`, `FORMATO_INVALIDO`, `HISTERESIS_INSUFICIENTE`, `SENSOR_DESCONOCIDO`, `ACTUADOR_DESCONOCIDO`.

---

## 12. Medidas de seguridad

| Área | Medida |
|---|---|
| Transporte | HTTPS validado para el dispositivo en producción e integración, sin bypass ni fallback HTTP (9.9). Cabecera HSTS en proxy/web. |
| Tokens de dispositivo | 256 bits aleatorios; sólo se guarda SHA-256; se muestran una vez; rotación y revocación desde la web; comparación en tiempo constante. |
| Contraseñas | bcrypt costo 12; longitud mínima 10; bloqueo progresivo tras 5 intentos fallidos por IP/email. |
| Sesiones web | JWT de 15 min firmado (HS256, secreto ≥ 32 bytes desde variable de entorno) + refresh rotativo en cookie `HttpOnly`/`Secure`/`SameSite=Strict`, revocable en BD. |
| Autorización | Verificación de pertenencia al terreno en **cada** consulta (incluye recursos hijos). Un dispositivo sólo puede ver/confirmar sus propias órdenes. |
| Validación | Esquemas `zod` en todas las entradas; rangos físicos verificados en servidor **y** firmware. |
| Base de datos | Consultas parametrizadas (`mysql2` con sentencias preparadas); usuario MySQL con privilegios mínimos (sin `DROP`/`GRANT`). |
| Cabeceras HTTP | `helmet` (CSP, X-Content-Type-Options, etc.), CORS restringido al origen de la web. |
| Límites | Rate limiting por IP (web) y por dispositivo (iot); tamaño máximo de cuerpo. |
| Secretos | Nada de credenciales en el repositorio; backend con variables de entorno, dispositivo con aprovisionamiento NVS externo. No confundir NVS con cifrado habilitado. |
| Registros | Logs estructurados con `id_solicitud`; nunca se registran tokens, contraseñas ni cabeceras `Authorization`. |
| Auditoría | Tabla `auditoria` para órdenes, cambios de configuración, rotación de tokens, cambios de permisos. |
| Seguridad física | Tope de riego, OFF al arrancar, bloqueos críticos y watchdog. El máximo sin alcanzar humedad es un indicio, no prueba de marcha en seco. Verificación eléctrica y corte independiente pendientes. |

---

## 13. Límites y cuotas

| Recurso | Límite |
|---|---|
| Solicitudes `/iot` por dispositivo | 60 por minuto (suficiente para órdenes cada 3 s + telemetría cada 10 s + eventos) |
| Login | 5 intentos por minuto por IP |
| API web | 300 solicitudes por minuto por usuario |
| Lecturas por telemetría | 30 |
| Eventos por solicitud | 30 |
| Órdenes devueltas por consulta | 5 |
| Cuerpo `/iot` | 16 KB |

---

## 14. Ejemplos de prueba con curl

```bash
export API=https://<HOST>/api/v1
export TOKEN=agc_dev_XXXXXXXXXXXXXXXX   # token de prueba (nunca uno real en el repo)

# Telemetría
curl -sS -X POST "$API/iot/telemetria" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"id_arranque":"9f3a12c0","uptime_ms":60000,"ts":null,"version_firmware":"0.1.0","config_version":0,
       "lecturas":[{"seq":1,"sensor":"HUM1","tipo":"HUMEDAD_SUELO","valor_pct":42.5,"valor_raw":1873,"estado":"OK","ts":null,"uptime_ms":59000}],
       "actuadores":[{"actuador":"BOMBA1","encendido":false,"modo":"MANUAL","motivo":"REPOSO","encendido_desde_s":0,"descanso_restante_s":0,"bloqueado":false}]}'

# Consultar órdenes
curl -sS "$API/iot/ordenes" -H "Authorization: Bearer $TOKEN"

# Confirmar orden
curl -sS -X POST "$API/iot/ordenes/<ID>/confirmacion" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"resultado":"EJECUTADA","codigo_motivo":null,"mensaje":null,"ejecutada_en":null,"uptime_ms":61000,"duracion_aplicada_s":30,
       "estado_actuador":{"actuador":"BOMBA1","encendido":true,"modo":"MANUAL","motivo":"MANUAL_ORDEN","encendido_desde_s":0,"descanso_restante_s":0,"bloqueado":false}}'

# Configuración
curl -sS "$API/iot/configuracion" -H "Authorization: Bearer $TOKEN"
curl -sS -X POST "$API/iot/configuracion/confirmacion" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"config_version":1,"resultado":"APLICADA","errores":[]}'
```

El backend incluirá un **simulador de dispositivo** (`backend/scripts/simulador-esp32.ts`) que implementa este contrato para probar la web sin hardware.

---

## 15. Historial de cambios

| Versión | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0.0-rc2 | 2026-10-15 | Bloqueos críticos sin override, TLS sin excepciones, UUID completo, duración aplicada, ACK tardío, diario durable y criterios de conformidad. Sustituye semánticas rc1 antes de aprobación estable. | Revisión de contrato |
| 1.0.0-rc1 | 2026-10-15 | Versión inicial para revisión y aprobación | Arquitectura (Claude) |

## 16. Coordinación y aceptación

**Estado: revisión pendiente, no aprobación.** Solo se modifica este contrato; no se alteran firmware, tests de Codex, backend ni esquema SQL. La coordinación queda expresada como requisitos y acciones para sus responsables; no se afirma haber recibido confirmación de Claude o Codex ni haber probado integración.

### 16.1 Viabilidad y brechas verificadas

Se revisaron `firmware-esp32/INTEGRACION_API.md`, el núcleo `Control.h`, el adaptador y `database/schema.sql`. Al revisar, `backend/` no contiene archivos implementados; no es posible demostrar compatibilidad en ejecución. El diseño puede implementarse con un adaptador Arduino/NVS y transacciones MySQL, pero la versión actual **no es conforme** hasta completar estas acciones:

| Área | Estado observado | Acción del responsable antes de integrar |
|---|---|---|
| Bloqueos/modos | Núcleo ya bloquea ON y usa Disabled; no persiste | Codex: persistir bloqueo/inhibición, mapear Disabled a DESHABILITADO, recuperación por causa. Backend/web: no permitir override ni rearmado implícito. |
| UUID | Núcleo usa uint64 y 64 IDs volátiles | Codex: UUID completo y diario durable 9.10, sin truncar. BD ya tiene UUID CHAR(36) único; backend: validar canónico y contenido inmutable. |
| Duración | Núcleo solo tiene máximo global; cualquier timeout bloquea | Codex: temporizador específico ON, normalización de duración y fin normal sin bloqueo; conservar watchdog y fallo seguro. Backend: guardar duración solicitada y ACK aplicado. |
| Caducidad y ACK | Backend sin implementar; esquema rc1 conserva estado/fechas/snapshot | Backend: ENTREGADA no expira automáticamente, ACK tardío/idempotente transaccional, conflicto auditado y prioridad OFF. Codex: reloj confiable y mismo ACK durable tras reinicio. |
| Persistencia | Firmware aún volátil; BD sin campo duración aplicada/ACK completo | Backend/BD: migración no destructiva para `duracion_aplicada_s` y cuerpo ACK inmutable, incluyendo uptime; registrar incertidumbre con código, conservar auditoría y no borrar ENTREGADA sin resolver. |
| Configuración | BD rc1 permite descanso 0 y contador 1..10 | BD/backend: exigir descanso >=5 y contador=1, calibración válida; migrar datos previos explícitamente. Firmware: confirmar capacidades y persistencia atómica; no confirmar parámetros incompatibles. |
| Estado efectivo | BD rc1 enum modo no incluye DESHABILITADO | BD/backend/web: ampliar solo modo reportado, mantener modo deseado MANUAL/AUTO; mostrar inhibición y diferencia. |
| TLS/UTC | Firmware sin cliente REST, CA, UTC ni aprovisionamiento completo | Codex/operación: aprovisionamiento seguro de CA/hora/token y ensayos negativos TLS. Nunca habilitar red insegura para acelerar la prueba. |
| Red/colas/watchdog | Cola serial de 15 eventos útiles; sin colas API ni watchdog validado | Codex: separar tarea de red, 100 lecturas/20 eventos, watchdog y ensayo de apagado con red bloqueada; conservar corte independiente del montaje. |

El esquema rc1 y otros documentos arquitectónicos aún no se declaran alineados con rc2. Tras revisar esta propuesta, sus responsables deben actualizar implementación/documentación y registrar evidencias. No se requiere `/api/v2` mientras rc1/rc2 sean borradores no publicados; si existe un consumidor rc1 desplegado, negociar migración/versionado antes de cambiarlo.

### 16.2 Casos de aceptación compartidos

Son casos exigidos, **todavía no ejecutados**; usar el mismo fixture JSON en tests backend y adaptador firmware:

| Caso | Resultado obligatorio |
|---|---|
| ON manual/AUTO con bloqueo crítico, incluso tras cambio de modo o reinicio | OFF, rechazo BLOQUEO_SEGURIDAD; sin bypass |
| Sensor inválido/NaN/sin calibrar/edad=3000 ms durante manual o AUTO | OFF inmediato y bloqueo; sensor recuperado no rearma solo |
| RESTABLECER con causa presente; nueva configuración intentando liberar bloqueo | Rechazo; mantiene bloqueo. Recuperación válida queda OFF/DESHABILITADO |
| Certificado vencido, CA no confiable, hostname distinto o reloj sin confianza | Sin sesión API autenticada; sin fallback inseguro |
| UUID idéntico antes/después de reinicio; UUID diferente que colisionaría en uint64 | Primero no repite efecto; segundo se trata como ID diferente íntegro |
| Mismo UUID con payload distinto | No ejecutar, no reemplazar ACK original, auditar |
| ON en instante `expira_en`, reloj desconocido o cola que cruza deadline | Rechazo ORDEN_CADUCADA/RELOJ_NO_CONFIABLE |
| Solicitud 30 s, config 20 s, tope compilado 15 s | ON aceptado dura como máximo 15 s; ACK duración=15 y DURACION_RECORTADA; no bloqueo por fin normal manual |
| Duplicado ON a mitad del riego o segundo ON nuevo durante riego | No renovar reloj; duplicado reenvía ACK, nuevo rechaza ACTUADOR_OCUPADO |
| Corte antes/después de INTENCION, entre GPIO y FINAL y después de FINAL antes del ACK | Al arrancar OFF; nunca repetir UUID; incertidumbre si no existe FINAL; ACK persistido se reenvía |
| ACK perdido, offline más allá de vencimiento+30 s y posterior reintento | ENTREGADA genera alerta; acepta ACK tardío una sola vez; repetición idéntica devuelve 200 |
| Diario lleno, escritura corrupta, corte durante commit o recolección | No ON; OFF sigue disponible; no expulsar registro incierto/no confirmado |
| OFF seguido de reconexión/reenvío de configuración igual | Permanece DESHABILITADO; solo nueva versión explícita segura puede rearmar |
| Lote con OFF y ON del mismo actuador o creación concurrente de OFF/ON | OFF no se cancela por ON; firmware rechaza ON del lote con OFF |
| Red esperando timeout 8 s durante riego de menor duración | El lazo de seguridad apaga en su plazo sin esperar la red |

Para declarar conformidad: contrato aprobado explícitamente, schema/migraciones revisados, pruebas backend + adaptador C++ compiladas y aprobadas con los mismos casos, ensayo integrado HTTPS y posteriormente pruebas físicas documentadas. La revisión documental no sustituye esas evidencias.

### 16.3 Verificación documental de rc2

Se analizaron 13 bloques JSON, que contienen 16 ejemplos completos, con el parser JSON de Python: todos válidos sintácticamente tras retirar comentarios explicativos. Se comprobó presencia de versión rc2, duración aplicada, modo DESHABILITADO, resultado incierto y diario durable, y ausencia de las frases rc1 que autorizaban HTTP/bypass TLS/ON bajo bloqueo y de la transición automática ENTREGADA→EXPIRADA. Estas comprobaciones no validan los esquemas en ejecución ni sustituyen los casos 16.2.
