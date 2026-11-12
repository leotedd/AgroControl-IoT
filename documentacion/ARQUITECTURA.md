# Arquitectura — AgroControl IoT

Versión 1.0.2 · 2026-10-15 · Alineada con el [contrato API IoT 1.0.2](CONTRATO_API_IOT.md)

## 1. Visión general

```
                         INTERNET (sólo HTTPS)
 ┌──────────────────────┐                    ┌───────────────────────────────────────────────┐
 │ Navegador / móvil    │                    │ Servidor                                      │
 │ React SPA            │ ── /api/v1/* ────► │ ┌─────────────┐  ┌──────────────────────────┐ │
 │ (JWT de usuario)     │                    │ │ Túnel/Proxy │─►│ Backend Express (Node TS) │ │
 └──────────────────────┘                    │ │ TLS (HTTPS) │  │ · API usuario  /api/v1/*  │ │
                                             │ └─────────────┘  │ · API IoT      /api/v1/iot│ │
 ┌──────────────────────┐                    │        ▲         │ · Tareas: caducidad,      │ │
 │ ESP32 (campo)        │                    │        │         │   presencia, alertas      │ │
 │ ┌─ tarea CONTROL ──┐ │                    │        │         │ · Sirve la SPA compilada  │ │
 │ │ sensor·lazo·relé │ │                    │        │         └────────────┬─────────────┘ │
 │ │ diario NVS       │ │ ── /api/v1/iot/* ──┼────────┘                      │ mysql2 (UTC)  │
 │ └──────▲───────────┘ │ token + id_arranque│                  ┌────────────▼─────────────┐ │
 │   colas│             │ TLS verificado     │                  │ MySQL 8                   │ │
 │ ┌──────▼─ tarea RED ┐│                    │                  └──────────────────────────┘ │
 │ │ Wi-Fi·SNTP·HTTPS  ││                    └───────────────────────────────────────────────┘
 │ └───────────────────┘│
 └──────────┬───────────┘
            │ Wi-Fi
   ┌────────▼────────┐        ┌─────────────┐
   │ Hotspot tablet  │──────► │ Servidores  │ SNTP (UDP 123)
   └─────────────────┘        │ NTP públicos│
                              └─────────────┘
```

**Capas**

| Capa | Responsable | Tecnología |
|---|---|---|
| Firmware | Codex (`firmware-esp32/`, `tests/firmware/`) | ESP32 Arduino/FreeRTOS, `WiFiClientSecure` + paquete de CA, SNTP, Preferences (NVS), JSON |
| Backend | Claude (`backend/`) | Node.js 20+ (equipo actual: v24), Express 4, TypeScript, zod, mysql2, jsonwebtoken, bcrypt, helmet, pino |
| Base de datos | Claude (`database/`) | MySQL 8.0.16+ |
| Frontend | Claude (`frontend/`) | React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Recharts |
| Contrato | Mantenido por Claude, leído por ambos | `documentacion/CONTRATO_API_IOT.md` (versiones anteriores en `documentacion/historial/`) |

## 2. Estructura del repositorio

```
AgroControl-IoT/
├── README.md
├── documentacion/
│   ├── ARQUITECTURA.md            ← este documento (incluye ADR)
│   ├── CONTRATO_API_IOT.md        ← contrato firmware ⇄ backend 1.0.2 (fuente de verdad)
│   ├── MODELO_DATOS.md
│   ├── PLAN_IMPLEMENTACION.md
│   └── historial/                 ← versiones anteriores del contrato (rc2)
├── database/
│   ├── schema.sql
│   ├── migrations/                ← (fase 2) migraciones numeradas
│   └── README.md
├── backend/
│   ├── src/
│   │   ├── app.ts · server.ts
│   │   ├── config/                ← variables de entorno validadas con zod
│   │   ├── db/                    ← pool mysql2 (timezone 'Z'), helper de transacciones
│   │   ├── shared/                ← AppError, respuestas, logger, tiempo
│   │   ├── middlewares/           ← requestId, requerirHttps, autenticarUsuario, autenticarDispositivo,
│   │   │                            autorizarTerreno, validar(zod), rateLimit, manejadorErrores
│   │   ├── modules/
│   │   │   ├── auth/ usuarios/ terrenos/ cultivos/ zonas/
│   │   │   ├── dispositivos/      ← registro, tokens (rotación/gracia/revocación), estado en vivo
│   │   │   ├── control/           ← configuración deseada, versiones, reconciliación de modo (9.3)
│   │   │   ├── ordenes/           ← creación serializada, prioridad APAGAR, entrega, ACK inmutable
│   │   │   ├── iot/               ← endpoints /iot (telemetría, órdenes, config, eventos, arranques)
│   │   │   ├── mediciones/ ciclos/ alertas/
│   │   └── jobs/                  ← caducidadOrdenes, presenciaDispositivos
│   ├── scripts/                   ← db-init, db-seed, simulador-esp32
│   ├── tests/                     ← Vitest + Supertest (casos B-x del Anexo B)
│   └── .env.example
├── frontend/
│   └── src/ api/ auth/ components/ features/{dashboard,control,historial,terrenos,...} layouts/ routes/
├── firmware-esp32/                ← CODEX (no tocar)
└── tests/firmware/                ← CODEX (no tocar)
```

Patrón de cada módulo del backend: `routes → controller → service (reglas, transacciones) → repository (SQL parametrizado)`, con `schemas.ts` (zod) como fuente de los tipos.

## 3. Flujos principales

### 3.1 Encender la bomba desde la web
1. El usuario, en modo `MANUAL`, pulsa **Regar 10 s**. La web envía `POST /dispositivos/1/ordenes` (`BOMBA_ENCENDER`, `duracion_s: 10`, `Idempotency-Key`).
2. El backend abre una transacción y bloquea la fila del dispositivo con `FOR UPDATE`. Dentro de ella:
   1. Comprueba permisos y las precondiciones orientativas: en línea, `MANUAL`, sin bloqueo, calibrado, sin apagado pendiente y `duracion_s` ≤ `riego_max_s`.
   2. Cancela el encendido `PENDIENTE` anterior, si lo hay.
   3. Inserta la orden (`PENDIENTE`, TTL 30 s) y la audita.
3. El ESP32, en su siguiente consulta (≤ 3 s), recibe la orden y la orden pasa a `ENTREGADA` con su `id_arranque`.
4. La tarea de red la pasa a la tarea de control, que:
   1. Valida las condiciones de 10.3.
   2. Escribe `INTENCION` en NVS.
   3. Revalida la vigencia, enciende y arma el corte de respaldo.
   4. Escribe `FINAL`.
   5. Envía el ACK `EJECUTADA` con `duracion_aplicada_s`.
5. La web, que consulta `GET /ordenes/{id}` cada segundo, muestra *Ejecutada ✔*. El panel indica `RIEGO_MANUAL` y el tiempo restante.
6. A los 10 s el ESP32 apaga y envía `RIEGO_FINALIZADO` (`DURACION_CUMPLIDA`). El backend cierra el ciclo de riego.

### 3.2 Apagar
1. `POST /ordenes` con `BOMBA_APAGAR`. Se acepta siempre y, en la misma transacción:
   - Cancela los encendidos y rearmes `PENDIENTE`.
   - Si el modo deseado era `AUTOMATICO`, lo cambia a `MANUAL` con una nueva versión de configuración de origen `SISTEMA`.
2. Por actuador sólo se entrega el apagado (la orden de mayor `id`).
3. La tarea de red del ESP32 hace la **recepción** en una sola sección crítica del **cerrojo del relé**: GPIO inactivo, `barrera_apagado`, `inhibir_automatico` y anotación en el **buzón de apagado**. El APAGAR no entra en la cola, así que funciona aunque la cola esté llena. No comprueba vigencia, reloj ni duplicados.
4. Cualquier encendido, manual o automático, pasa por la función única de compromiso de encendido, que lo comprueba todo dentro del mismo cerrojo. Por eso un encendido anterior nunca queda activo después del apagado (`ANULADA_POR_APAGAR`).
5. La tarea de control revisa el buzón antes que la cola y completa todos los efectos: `AUTOMATICO` → `MANUAL`, fin de riego, descanso, desarme del temporizador, una única escritura NVS atómica y anulación de los encendidos en cola. Después envía el ACK `EJECUTADA` desde un anillo persistente propio. Un apagado repetido vuelve a cortar y retransmite el ACK original.

### 3.3 Activar el modo automático
1. `PATCH /actuadores/1/control { modo: "AUTOMATICO" }`. Exige que no haya bloqueo, que la calibración y el hardware estén confirmados, y crea una nueva versión.
2. El ESP32 ve la versión mayor, descarga la configuración, la valida, apaga cualquier riego, la guarda en NVS con CRC y la confirma.
3. La web muestra *Pendiente de aplicar* hasta que la versión aplicada iguala la deseada y el modo efectivo es `AUTOMATICO`.

### 3.4 Reconciliación de modo
Si el ESP32 informa un modo efectivo **menor** que el deseado con la versión al día (por bloqueo, apagado en automático, arranque o rearme), el backend **baja** el modo deseado y crea una versión de origen `SISTEMA`. El servidor nunca sube un modo por su cuenta.

### 3.5 Reinicio del ESP32
Llega un `X-Id-Arranque` nuevo. El backend:
1. Registra el arranque.
2. Pasa las órdenes `ENTREGADA` a `SIN_CONFIRMAR`, sin reentregarlas.
3. Cierra los ciclos abiertos con `REINICIO`.

El firmware, por su parte:
- Arranca en `DESHABILITADO` con la bomba apagada.
- Resuelve las `INTENCION` sin `FINAL` como `RESULTADO_INCIERTO_REINICIO`, con bloqueo preventivo.
- Reenvía los ACK pendientes.

### 3.6 Sin Internet
- El ESP32 sigue regando en `AUTOMATICO` con la configuración de NVS.
- Un riego manual en curso termina al cumplir su duración.
- Se acumulan lecturas y eventos.
- Tras 120 s sin contacto el servidor marca el dispositivo `FUERA_DE_LINEA`. La web deshabilita "Encender", mantiene "Apagar" y muestra el estado de la bomba como "desconocido".

## 4. Concurrencia y consistencia en el backend

| Operación | Mecanismo |
|---|---|
| Crear orden, cambiar control, reconciliar modo | Transacción + `SELECT … FROM dispositivos WHERE id = ? FOR UPDATE`. Serializa por dispositivo, garantiza `id` crecientes en el orden de entrega e impide carreras entre apagar y encender |
| Entregar órdenes (`GET /iot/ordenes`) | Misma serialización. Selecciona la orden entregable de mayor `id` por actuador y actualiza el estado en la transacción |
| ACK | `UPDATE … WHERE id = ? AND dispositivo_id = ? AND estado IN ('ENTREGADA','SIN_CONFIRMAR')`. Si ya es final, compara con el ACK guardado (idempotencia o conflicto) |
| Telemetría | Snapshot condicional por (`id_arranque`, `uptime_ms`); lecturas y eventos con `INSERT IGNORE` (deduplicación) |
| Versión de configuración | `config_version_deseada = config_version_deseada + 1` dentro de la transacción del cambio |

Las reglas normativas completas (pertenencia, límites, orden de bloqueo, reintentos ante interbloqueo, inmutabilidad) están en el contrato, sección 13.1. Esta tabla las resume.

## 5. Tareas en segundo plano

| Tarea | Frecuencia | Acción |
|---|---|---|
| `caducidadOrdenes` | 5 s | `PENDIENTE` vencidas ⇒ `EXPIRADA`. `ENTREGADA` con vigencia + 30 s ⇒ `SIN_CONFIRMAR` y alerta |
| `presenciaDispositivos` | 30 s | Más de 120 s sin contacto ⇒ alerta `DISPOSITIVO_FUERA_DE_LINEA`; se resuelve al volver |

Se ejecutan dentro del proceso (`setInterval`), con una sola instancia. Para escalar, pasarán a un *worker* con `FOR UPDATE SKIP LOCKED`.

## 6. Arquitectura del firmware (requisitos del contrato; implementación de Codex)

```
┌──────────── Tarea CONTROL (alta prioridad, TWDT ≤ 5 s) ───────────┐
│ muestreo ADC (100 ms) → mediana → validez → lazo/histéresis      │
│ cola de órdenes → validación 10.3 → diario NVS (INTENCION) →     │
│ revalidación → GPIO relé + esp_timer de corte → diario (FINAL)   │
│ bloqueos persistentes · descanso · tope compilado                │
└──────────────▲───────────────────────────────┬───────────────────┘
               │ cola: órdenes, configuración   │ cola: estado, eventos, ACK
┌──────────────┴──── Tarea RED (prioridad menor) ▼───────────────────┐
│ Wi-Fi (NVS agro-wifi) → SNTP → HTTPS verificado (NVS agro-api)   │
│ GET órdenes / config · POST telemetría / eventos / ACK            │
│ búferes (100 lecturas, 20 eventos) · backoff con jitter           │
└──────────────────────────────────────────────────────────────────┘
```

Principio: **la tarea de control nunca espera a la red.**
- Un `esp_timer` de respaldo pone el relé en reposo aunque la tarea de control se bloquee, **siempre que el servicio de temporizadores del MCU siga despachando**.
- Es software en el mismo microcontrolador. **No cubre** pánicos, interrupciones deshabilitadas, falta de alimentación de la lógica ni fallos del circuito de potencia (relé soldado, driver en cortocircuito). Esos casos dependen de los watchdogs (reinicio), de la polarización externa del pin y, en una instalación real, de un **corte eléctrico independiente obligatorio** (contrato 10.7, tabla de alcance).

## 7. Despliegue

### 7.1 Prueba de banco / física
- MySQL 8 y el backend en el portátil (MySQL todavía no está instalado en el equipo de desarrollo).
- El backend sirve la SPA compilada: **un solo origen** y sin CORS.
- HTTPS público con **Cloudflare Tunnel** o ngrok. El backend sólo confía en `X-Forwarded-Proto` del túnel local (`trust proxy` limitado a loopback) y rechaza `/iot` sin HTTPS.
- Para no reaprovisionar el ESP32 en cada reinicio del túnel: túnel con nombre o dominio estático de ngrok.
- Aprovisionamiento del ESP32 por USB: `agro-wifi` (`ssid`, `password`) y `agro-api` (`url`, `token`).
- La red de la tablet debe permitir SNTP (UDP 123) además de HTTPS.

### 7.2 Producción (fase 3)
VPS o PaaS con MySQL administrado, proxy inverso con Let's Encrypt, copias de seguridad, monitoreo de `/api/v1/salud`, cifrado de NVS y de flash del ESP32, y RTC/NTS si se requiere hora autenticada.

## 8. Notas de hardware

> Informativo. La implementación y la validación eléctrica corresponden a Codex y al equipo de montaje.

- Sensor D43 a un pin del **ADC1** (GPIO34 en el `Settings.h` de Codex), con salida que no supere la tensión admitida por el ADC.
- Relé en GPIO26, activo en bajo según Codex. Confirmar el módulo y si conmuta con 3.3 V; añadir polarización externa para el arranque. Evitar los GPIO 0, 2, 12 y 15 (*strapping*) y 6–11 (*flash*).
- Bomba con fuente propia, nunca desde un pin del ESP32; diodo de rueda libre si el módulo no lo trae.
- Codex pide no energizar la bomba hasta tener los datos eléctricos y validar el circuito (`firmware-esp32/ENTREGA_FASE_1.md`).

## 9. Registro de decisiones técnicas (ADR)

| ADR | Decisión | Alternativas | Motivo |
|---|---|---|---|
| ADR-001 | HTTPS con *polling* iniciado por el ESP32 | MQTT, WebSocket | Requisito REST/HTTPS. Funciona tras el NAT del hotspot. Latencia de unos 3 s |
| ADR-002 | Control automático y **decisión final de seguridad** en el ESP32 | Control desde el servidor | Funciona sin Internet; ningún fallo del servidor puede encender la bomba de forma insegura |
| ADR-003 | Configuración versionada (estado deseado) + órdenes con TTL | Todo como órdenes | Persistencia y resincronización del modo; acciones que no se ejecutan tarde |
| ADR-004 | Token Bearer por dispositivo (256 bits, SHA-256), rotación con 24 h de gracia | mTLS, HMAC | Simple y seguro sobre TLS; la gracia evita dejar dispositivos inaccesibles |
| ADR-005 | JWT corto + refresh rotativo en cookie HttpOnly | Sesiones en servidor, JWT en localStorage | Resistencia a XSS y revocación |
| ADR-006 | SQL parametrizado con mysql2 + zod, sin ORM | Prisma, TypeORM | Control de transacciones y bloqueos (`FOR UPDATE`), deduplicación |
| ADR-007 | El backend sirve la SPA en las pruebas | Hosts separados | Un solo túnel HTTPS, sin CORS |
| ADR-008 | *Polling* desde la web (3 s) en el prototipo | SSE / WebSocket | Rapidez de implementación; SSE en fase 2 |
| ADR-009 | Nombres en español | Inglés | Coherencia con el dominio |
| ADR-010 | Tope compilado ≤ 600 s + bloqueos persistentes + corte de respaldo `esp_timer` + watchdogs | Confiar en el servidor | Un error de red, del servidor o de configuración no puede dejar la bomba encendida mientras el MCU funcione. **Límite:** ante fallos del propio MCU, de su alimentación o del circuito de potencia, ninguna capa de software lo garantiza; en una instalación real es obligatorio un corte eléctrico independiente |
| ADR-028 | **Cerrojo del relé por actuador + función única de compromiso de encendido** | Comprobaciones independientes en cada camino | El apagado, la barrera y el encendido son mutuamente excluyentes y linealizables; el lazo `AUTOMATICO` no puede saltarse la barrera (rechazo de la 1.0.1, punto 1) |
| ADR-029 | **Buzón de apagado fuera de la cola**, con anillo propio de ACK | APAGAR encolado con prioridad | Los efectos completos de un APAGAR no dependen de la capacidad de la cola ni del diario de encendidos (rechazo de la 1.0.1, punto 2) |
| ADR-030 | **Límite de rearme remoto común a todas las causas `PREVENTIVO`** (`PREVENTIVO_REPETIDO`) y **precondiciones de rearme separadas** de las de encendido | Límite sólo para `TIEMPO_MAXIMO`; precondiciones compartidas | Evita esquivar el límite alternando causas, y permite evaluar un rearme con el bloqueo activo sin dar ningún camino al encendido (puntos 3 y 4) |
| ADR-027 | **Reglas del backend normativas en el contrato (13.1)** e inmutabilidad reforzada con un *trigger* y privilegios mínimos en MySQL | Sólo disciplina de código | La pertenencia, los límites, las transacciones y la inmutabilidad del ACK son verificables (B-19 a B-21) y no dependen únicamente de la implementación |
| ADR-011 | Fechas UTC; reconstrucción por `uptime_ms` | Hora local | Datos coherentes aunque falte NTP al medir |
| **ADR-012** | **`id` de orden entero, creciente y serializado por dispositivo** (≤ 2^53 − 1) | UUID (rc1, rc2) | Decisión aprobada. Permite al firmware una marca de agua persistente de 8 bytes como anti-replay, en lugar de guardar decenas de UUID en NVS |
| **ADR-013** | **Diario durable `INTENCION`/`FINAL` en NVS + ACK inmutable en BD** | Registro volátil | Como máximo un intento por orden ante reinicios; resultado incierto explícito (propuesta rc2 de Codex) |
| **ADR-014** | **APAGAR prioritario**: siempre ejecutable, cancela encendidos pendientes, una orden por actuador y rechazo en lote | Cola FIFO de órdenes | Un encendido obsoleto nunca puede seguir a un apagado |
| **ADR-015** | **Tres modos** en el deseado y en el efectivo, con reconciliación descendente en el servidor | Dos modos deseados (rc2) | Decisión aprobada. La web muestra modo configurado, modo efectivo y estado real sin ambigüedad; el servidor nunca reactiva un modo |
| **ADR-016** | **APAGAR en `AUTOMATICO` ⇒ `MANUAL`** | ⇒ `DESHABILITADO` (rc2) | Decisión aprobada. `MANUAL` no riega por sí solo y permite volver a encender sin reconfigurar |
| **ADR-017** | **Una configuración nueva apaga el riego en curso** | Recalcular el plazo | Regla simple y verificable que garantiza que no se prolonga (propuesta rc2) |
| **ADR-018** | **SNTP + verificación cruzada ±30 s + plazos monotónicos** | RTC o hora manual (rc2) | Exigido por el responsable. La verificación de cadena y host no depende de la hora; el riesgo residual está documentado; RTC/NTS en fase 3 |
| **ADR-019** | **Tareas FreeRTOS separadas de red y control** | Bucle cooperativo único | Una solicitud HTTP de 8 s no puede retrasar el apagado |
| **ADR-020** | **Valores reportados por el firmware en VARCHAR**; valores del servidor en ENUM | Todo ENUM | Un valor nuevo del firmware no hace perder telemetría |
| **ADR-021** | **Valores de banco de Codex** (30/55 %, 15 s, 60 s, 3000/1300) por defecto, marcados como no agronómicos | Valores rc1 (35/55, 120 s, 300 s) | Decisión aprobada: protege la mini bomba durante las pruebas |
| **ADR-022** | **Política de rearme (definitiva en 1.0.1):** `id_bloqueo` persistente; el rearme remoto lleva `id_bloqueo`, `causa` e `inspeccion_confirmada`, que el firmware verifica; condición objetiva de sensor de 10 s; **un rearme remoto por episodio** y escalado a un bloqueo sólo local. En 1.0.2 el límite se unifica para toda causa `PREVENTIVO` y la causa pasa a llamarse `PREVENTIVO_REPETIDO` (ADR-030). `FALLA_CRITICA` y `PERSISTENCIA_NO_DISPONIBLE` sólo en local | Todo local (rc2) / todo remoto | Permite operar en remoto con evidencia verificable. Las órdenes de rearme obsoletas no coinciden con un bloqueo nuevo, y no se puede rearmar indefinidamente una bomba en seco |
| **ADR-023** | **Vigencia TLS obligatoria:** vía A (`MBEDTLS_HAVE_TIME_DATE`) o vía B (verificador de la cadena tras el *handshake*, antes de enviar datos). Sin ninguna, no hay comunicación | Documentar la limitación | Cotejar la hora no detecta un certificado caducado del host correcto (observación P0-1 de Codex) |
| **ADR-024** | **`GET /salud` sin token como primera solicitud** de cada conexión, para validar la hora antes de enviar credenciales | Cotejo después del primer envío con token | El token nunca viaja por una sesión cuya hora no se ha cotejado |
| **ADR-025** | **Coordinador único + camino prioritario de APAGAR + barrera por actuador** (RAM + NVS), comprobada en tres puntos | Sólo cancelación en el servidor y defensa del lote | Cubre los encendidos ya en cola o en validación en el ESP32, que el servidor no puede cancelar (observación P0-3) |
| **ADR-026** | **Los ACK son históricos:** llevan `id_arranque_origen`, nunca reconcilian y sólo actualizan el snapshot si son del arranque actual y más recientes. Excepción de equivalencia para los ACK de APAGAR | Tratar el ACK como estado actual | Evita que un ACK reenviado tras un reinicio sobrescriba el estado actual (observaciones P1-4 y P1-5) |
