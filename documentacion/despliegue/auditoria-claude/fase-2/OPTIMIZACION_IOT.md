# Optimización IoT — escrituras, tráfico, almacenamiento y retención

- **Fecha:** 2026-11-09 · Contratos asociados: C-3.7, C-8.4, C-9.1–C-9.6 de [CONTRATOS_TECNICOS_CODEX.md](CONTRATOS_TECNICOS_CODEX.md).
- **Objetivo:** que un ESP32 24/7 quepa holgadamente en Render Free (5 GB/mes) y Supabase Free (500 MB, ≈ 5 GB de *egress*) **sin perder eventos críticos ni degradar la seguridad local**.

## 1. Restricción dura descubierta: lease de la API en el firmware

`firmware-esp32/AgroControl/ManualSafety.h`: `ApiLeaseMs = 4000`. Durante un riego, `Policy::network()` exige una respuesta correcta de la API hace menos de 4 s. Si no la hay, `tick()` apaga con `Stop::Api` y **bloquea** (`latched_`). `MonitorRuntime.h` no acelera el sondeo de órdenes durante el riego (`nextCommands_ = now + commandSeconds`).

| `intervalo_ordenes_s` | Consecuencia durante un riego manual |
|---|---|
| 2 | Margen amplio (2 s + latencia) |
| **3 (actual)** | Margen ≈ 0,5–0,9 s con la latencia Guatemala→Render us-east más la transacción. **Aceptable**; vigilar en la prueba física futura |
| ≥ 4 | **Corte y bloqueo sistemáticos** de todo riego a los 4 s |

**Decisión AD-07:** `intervalo_ordenes_s` ≤ 3. La propuesta D-6 de la Fase 1 (5 s) queda **anulada**. Toda la reducción de tráfico se consigue en el servidor, no espaciando el sondeo.

> Observación para una fase futura de firmware (fuera de alcance): acelerar el sondeo mientras haya un riego activo, o renovar el lease con un latido ligero, daría margen sin aumentar el tráfico en reposo.

## 2. Línea base del tráfico (1 ESP32, 30 días)

| Flujo | Frecuencia | Peticiones/mes | Sentencias por petición (hoy) | Escrituras por petición (hoy) |
|---|---|---|---|---|
| `GET /iot/ordenes` | 3 s | 864 000 | ≈ 6 (autenticación 2 + transacción 4) | **2–3**: `UPDATE ultima_conexion_en`, `UPDATE … CANCELADA` (0 filas si no hay nada), y en PostgreSQL **`SELECT … FOR UPDATE` escribe el bloqueo en la tupla (genera WAL)** |
| `POST /iot/telemetria` | 10 s → **15 s** (seed) | 259 200 → 172 800 | ≈ 12–15 | ≈ 6 (lectura, sensor, dispositivo, *snapshot* de actuador, alertas) |
| Tarea de caducidad | 5 s → **15 s** | 518 400 → 172 800 consultas | 2 | 0–1 |
| Tarea de presencia | 30 s | 86 400 | 1 + N | 0–1 |

## 3. Medidas de optimización

| ID | Medida | Ahorro estimado | Riesgo y salvaguarda |
|---|---|---|---|
| O-1 (C-9.1) | **Presencia con umbral:** `ultima_conexion_en` se escribe sólo si pasaron ≥ 10 s, cambió la IP o cambió el arranque (caché en memoria + condición SQL) | De 1,12 M a ≈ 260 000 escrituras/mes (−77 %) | EN_LINEA (≤ 30 s) y FUERA_DE_LINEA (> 120 s) siguen siendo exactos con un error ≤ 10 s. Con varias instancias sólo aumentan las escrituras; nunca son incorrectas |
| O-2 (nuevo, **C-9.7**) | **Camino rápido en `GET /iot/ordenes`:** antes de abrir la transacción, una consulta sin bloqueo `SELECT 1 FROM ordenes_riego WHERE dispositivo_id=? AND expira_en > now() AND (estado='PENDIENTE' OR (estado='ENTREGADA' AND id_arranque_entrega=?)) LIMIT 1`. Si no hay nada, se responde `ordenes: []` con `config_version_deseada` (lectura simple) **sin transacción ni `FOR UPDATE`** | Elimina ≈ 860 000 transacciones con bloqueo al mes (≈ 99 % de los sondeos en reposo) | **Equivalente al comportamiento actual:** una orden creada justo después de la comprobación se entrega en el siguiente sondeo (≤ 3 s), igual que si el sondeo hubiera llegado un instante antes. Si existe un ENCENDER pendiente con el flag en `false`, la comprobación lo encuentra y entra en el camino lento, que lo cancela (la defensa se conserva). Pruebas: V-BOMBA-03 y una nueva V-IOT-01 |
| O-3 (C-3.7) | `bloquearDispositivo` sin `SELECT *`. Columnas necesarias: `id, terreno_id, uid, estado, id_arranque_actual, config_version_deseada, config_version_aplicada, hardware_confirmado, tope_riego_s, ultima_conexion_en` | ≈ −1 KB por transacción de *egress* de base (excluye JSON `diagnostico` y `config_rechazo_errores`) | Comprobar con `tsc` y pruebas que ningún llamador lee otra columna |
| O-4 (C-9.2) | Caducidad cada 15 s | −67 % de consultas de la tarea | La entrega ya filtra `expira_en > now()`: una orden vencida nunca se entrega aunque la tarea no haya pasado. `SIN_CONFIRMAR` se marca con ≤ 15 s de retraso adicional (alerta informativa) |
| O-5 (C-9.3) | `intervalo_telemetria_s = 15` en el seed de demostración | −33 % de telemetría y mediciones | Resolución del historial de 15 s, suficiente para humedad del suelo. Los eventos son independientes del intervalo |
| O-6 (opcional, **C-9.8**) | Desactivar la cabecera CSP de helmet en las respuestas JSON de `/api/*` (la CSP sólo tiene sentido en HTML), conservando las demás cabeceras | ≈ 350 B × 1 M ≈ 0,35 GB/mes | Ninguno: el JSON no se interpreta como documento. `X-Content-Type-Options: nosniff` se conserva |
| O-7 (nuevo, **C-9.9**) | Purga de `tokens_refresco` caducados o revocados hace más de 7 días (tarea diaria; `DELETE` ya permitido en esa tabla) | Evita un crecimiento ilimitado (≈ 96 filas/día por sesión activa) | La detección de reutilización sólo necesita tokens no caducados. Los caducados se rechazan igualmente por fecha |

### 3.1 Lo que NO se optimiza (garantías)

- La **autenticación** del token se consulta en cada petición. No hay caché, para que una revocación o rotación se aplique de inmediato.
- **Eventos** (`eventos_dispositivo`), **ACK**, **alertas**, **auditoría** y **arranques**: se escriben siempre, sin muestreo ni descarte.
- **Mediciones con `estado <> 'OK'`** dentro de la ventana de retención: nunca se descartan ni se filtran.
- No se aplica banda muerta ni muestreo de lecturas en el servidor: cambiaría la semántica de `recibidas` del contrato 1.0.2.
- El contrato IoT 1.0.2 no cambia.

## 4. Presupuesto resultante

| Recurso | Antes | Después (estimado) | Límite | Uso |
|---|---|---|---|---|
| Salida HTTP de Render | ≈ 1,5–2,5 GB | ≈ 1,2–1,6 GB (ESP32) + 0,3 GB (móvil) + carga de la SPA (≈ 370 KB gzip por carga en frío; los *assets* inmutables quedan en caché) | 5 GB | ≈ 35 % |
| Transacciones con bloqueo | ≈ 1,1 M/mes | ≈ 10 000/mes (sólo con órdenes reales y telemetría con reconciliación) | — | — |
| Escrituras en BD | ≈ 3–4 M/mes | ≈ 1,2 M/mes | — | — |
| *Egress* de Supabase | ≈ 2–3 GB | ≈ 0,4–0,8 GB | ≈ 5 GB | ≈ 15 % |

## 5. Almacenamiento, retención y agregación

### 5.1 Estimación de tamaño (PostgreSQL)

| Tabla | Filas/mes | Bytes/fila con índices (est.) | MB/mes |
|---|---|---|---|
| `mediciones` (15 s) | 172 800 | ≈ 200 | ≈ 35 |
| `mediciones_hora` | 720 por sensor | ≈ 120 | < 0,1 |
| `eventos_dispositivo` | ≈ 1 000–5 000 | ≈ 400 | ≈ 2 |
| `auditoria` | ≈ 1 000–3 000 | ≈ 300 | ≈ 1 |
| `tokens_refresco` (con purga) | ≈ 3 000 vivas | ≈ 250 | ≈ 0,8 estable |
| Resto | despreciable | | < 1 |

### 5.2 Política (AD-08)

| Dato | Retención | Mecanismo |
|---|---|---|
| `mediciones` crudas | **30 días** (`RETENCION_CRUDO_DIAS`) | Tarea diaria: (1) agrega las horas cerradas a `mediciones_hora` con `ON CONFLICT DO UPDATE` (idempotente); (2) borra los datos crudos de más de 30 días **sólo** de horas ya agregadas, en lotes de ≤ 5000, y deja un registro en `auditoria` con la cantidad |
| `mediciones_hora` | 365 días (revisable) | Purga anual opcional; ≈ 8 760 filas por sensor y año |
| Eventos, alertas, auditoría, órdenes, ciclos, arranques | **Sin purga** en la demostración | Volumen bajo; las órdenes son inmutables por diseño |
| `tokens_refresco` | 7 días tras caducar o revocarse | O-7 |

**Régimen estacionario estimado:** ≈ 35 MB de crudo + < 2 MB de agregados + ≈ 3 MB/mes de eventos y auditoría → **< 100 MB en el primer año**, frente a un límite de 500 MB. Alarmas al 60 % (300 MB) y al 80 % (400 MB) con `LIMITE_BD_MB` (C-9.6).

### 5.3 Historial transparente para el contrato

`GET /sensores/:id/mediciones`:
- `agrupacion=crudo`: sólo dentro de la ventana de retención. Si `desde` es anterior, devuelve lo disponible y `meta.recorte_retencion = true` (campo **adicional** y opcional, compatible hacia atrás).
- `agrupacion=hora|dia`: combina `mediciones_hora` (antes del límite de retención) con la agregación al vuelo sobre los datos crudos (después). Para `dia`, se agregan las horas. Promedios ponderados por `lecturas`.

### 5.4 Permiso requerido

La purga necesita `DELETE` en `mediciones` para `agro_app`. Hoy el diseño de privilegios lo prohíbe expresamente (§8 del esquema MySQL). **Requiere la confirmación del usuario antes del bloque 5.** Sin esa confirmación, la alternativa es ejecutar la purga con el rol propietario desde una tarea manual. Para la demostración, < 100 MB en un año hace que la retención no sea urgente.

## 6. Pruebas asociadas (se añaden a la matriz)

| ID | Prueba | Resp. |
|---|---|---|
| V-IOT-01 | Camino rápido: sin órdenes → 0 transacciones (espía sobre `transaccion`); con una orden PENDIENTE → camino lento y entrega; con ENCENDER pendiente y flag `false` → cancelación | Codex |
| V-IOT-02 | Umbral de presencia: 3 sondeos en 2 s → 1 escritura; cambio de IP → escritura inmediata; estado EN_LINEA correcto | Codex |
| V-IOT-03 | Retención: datos de 31 días → agregados correctos y crudo purgado sólo en horas agregadas; repetir la tarea no duplica | Codex |
| V-IOT-04 | Historial combinado: mismos promedios que sin purga en el rango solapado | Codex |
| V-IOT-05 | Medición de tráfico: 10 min de simulador contra el backend temporal; bytes de respuesta por petición antes y después | Rev |
