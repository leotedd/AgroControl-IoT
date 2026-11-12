# Matriz de validación PostgreSQL

- **Fecha:** 2026-11-09
- **Propósito:** criterios verificables para aprobar la portabilidad. Cada fila tiene un responsable de la evidencia: **Codex** (prueba automatizada en el repositorio) o **Rev** (revisión independiente de arquitectura, ejecutada en una copia aislada fuera del repositorio).
- **Entorno:** exclusivamente PostgreSQL 17 temporal en `127.0.0.1` (C-10.1) y MySQL temporal (arnés existente). Nunca Supabase ni la MySQL `agrocontrol`.
- **Estado inicial de todas las filas:** ⏳ pendiente. La columna «Estado» se actualiza en [INFORME_SUPERVISION.md](INFORME_SUPERVISION.md).

## 1. Esquema (V-DDL)

| ID | Verificación | Criterio de aceptación | Resp. |
|---|---|---|---|
| V-DDL-01 | Tablas | Las 17 tablas existen en PostgreSQL con los mismos nombres | Codex + Rev |
| V-DDL-02 | Columnas | Mismo conjunto y orden de columnas por tabla; tipo según C-4.1; misma nulabilidad | Rev (comparación automática de `information_schema.columns` entre los dos esquemas temporales) |
| V-DDL-03 | Valores por defecto | Mismos valores por defecto lógicos (0, 1, 'ACTIVO', 3000, 30.0…) | Rev |
| V-DDL-04 | PK y UNIQUE | Mismas columnas y orden; `uq_usuarios_email` sobre `lower(email)` | Rev |
| V-DDL-05 | Índices secundarios | Los 23 `ix_*` y las 11 `UNIQUE` con las mismas columnas y orden | Rev |
| V-DDL-06 | FK | Las 34 FK con los mismos nombres, columnas, tabla referenciada y acción `ON DELETE` (CASCADE / SET NULL / RESTRICT) | Rev |
| V-DDL-07 | CHECK de negocio | Los 7 nombres existen; la expresión es equivalente (revisión manual) | Rev |
| V-DDL-08 | Restricciones técnicas | Cada ENUM, UNSIGNED y booleano tiene su `ck_enum_`/`ck_rango_`/`ck_bool_` | Rev |
| V-DDL-09 | Triggers | 2 de negocio + 8 `actualizado_en`, todos habilitados (`tgenabled='O'`) | Codex + Rev |
| V-DDL-10 | Importación | `psql --single-transaction -v ON_ERROR_STOP=1` sobre una base vacía: OK; segunda ejecución: falla sin modificar nada (no idempotente por diseño, sin DROP) | Rev |
| V-DDL-11 | Sin elementos prohibidos | El archivo no contiene `DROP`, `TRUNCATE`, `\connect`, `session_replication_role` ni `pg_trigger_depth` | Rev (grep) |

## 2. Restricciones CHECK (V-CHK): tabla de casos frontera, ejecutada en **ambos motores**

| ID | Restricción | Debe aceptar | Debe rechazar |
|---|---|---|---|
| V-CHK-01 | `ck_dispositivos_intervalos` | telemetría 5 y 3600; órdenes 2 y 60 | telemetría 4 y 3601; órdenes 1 y 61 |
| V-CHK-02 | `ck_dispositivos_tope` | NULL, 1, 600 | 0, 601 |
| V-CHK-03 | `ck_sensores_calibracion` | (3000,1300); (21,221); (4074,3874) | (20,1300); (3000,4075); (1500,1400) (diferencia 100); (1300,1499) |
| V-CHK-04 | `ck_cc_histeresis` | inicio 30 / parada 35 | 30 / 34,9 |
| V-CHK-05 | `ck_cc_rangos` | inicio 0 y 95; parada 5 y 100; riego 5 y 600; descanso 5 y 86400 | inicio 95,1; parada 4,9; riego 4 y 601; descanso 4 y 86401 |
| V-CHK-06 | `ck_ordenes_ttl` | 10, 900 | 9, 901 |
| V-CHK-07 | `ck_ordenes_duracion` | NULL, 1, 600 | 0, 601 |
| V-CHK-08 | ENUM | Cada valor permitido | Un valor fuera de la lista (p. ej. `rol='ROOT'`) |
| V-CHK-09 | UNSIGNED | 0 y máximo del rango | −1 y máximo + 1 |
| V-CHK-10 | Booleanos | 0, 1 (y NULL donde aplique) | 2, −1 |

Resp.: **Codex** (pruebas parametrizadas que se ejecutan en ambos motores; en MySQL, V-CHK-08/09/10 las garantiza el tipo).

## 3. Triggers e inmutabilidad (V-TRG): ambos motores salvo indicación

| ID | Caso | Esperado | Resp. |
|---|---|---|---|
| V-TRG-01 | UPDATE de `dispositivo_id`, `actuador_id`, `tipo`, `parametros`, `ttl_s`, `origen`, `solicitada_por`, `idempotency_key`, `creada_en`, `expira_en` o `id` | Error con el mensaje «campo de identidad o contenido inmutable» | Codex |
| V-TRG-02 | `parametros` reescrito con el mismo JSON y otro orden de claves | **Permitido** en PostgreSQL (igualdad JSONB); documentar que en MySQL el resultado depende de la normalización JSON (MySQL también normaliza) | Codex |
| V-TRG-03 | Escritura única: `entregada_en`, `id_arranque_entrega`, `cancelada_en`, `cancelada_por`, `cerrada_por_orden_id`, `motivo_cierre`: NULL→valor permitido; valor→otro valor rechazado; valor→mismo valor permitido | Según la descripción | Codex |
| V-TRG-04 | Estado final (`EJECUTADA`, `RECHAZADA`, `FALLIDA`, `EXPIRADA`, `CANCELADA`) → otro estado | Rechazado | Codex |
| V-TRG-05 | `SIN_CONFIRMAR` → `EJECUTADA` (ACK tardío) | Permitido | Codex |
| V-TRG-06 | Con `resultado` no nulo, cambiar cualquiera de los 12 campos del ACK | Rechazado; probar al menos `resultado`, `ack_cuerpo` y `confirmada_en` | Codex |
| V-TRG-07 | `ack_conflictos` o `intentos_entrega` decrecientes | Rechazado; crecientes permitido | Codex |
| V-TRG-08 | `DELETE FROM ordenes_riego` directo | Rechazado | Codex |
| V-TRG-09 | (PostgreSQL) `DELETE` de un usuario con órdenes, o de un dispositivo con órdenes | Rechazado por el trigger (D-4). (MySQL) usuario: permitido por la FK SET NULL; dispositivo: RESTRICT de terreno, no aplica | Codex |
| V-TRG-10 | Flujo completo de la API (crear → entregar → ACK → ACK repetido equivalente → ACK conflictivo) | Sin errores del trigger; `ack_conflictos` = 1 | Codex (prueba existente en ambos motores) |
| V-TRG-11 | `actualizado_en` cambia en un UPDATE de las 8 tablas, y no cambia en INSERT | Igual en ambos motores (comparar `>`) | Codex |
| V-TRG-12 | Los triggers no se pueden saltar: el rol `agro_app` no puede ejecutar `ALTER TABLE … DISABLE TRIGGER` | Error de permisos | Rev (con roles creados en el PostgreSQL temporal) |

## 4. Transacciones y bloqueos (V-TX)

| ID | Escenario | Criterio | Resp. |
|---|---|---|---|
| V-TX-01 | 10 `POST /dispositivos/:id/ordenes` concurrentes (mismo dispositivo, claves distintas) | Sin 500; ids estrictamente crecientes en orden de creación; reemplazos coherentes (`cerrada_por_orden_id`) | Codex |
| V-TX-02 | Misma `Idempotency-Key` ×5 en paralelo | Una única orden; las 5 respuestas devuelven el mismo id (cubre `23505`) | Codex |
| V-TX-03 | ACK concurrente de la misma orden ×3 (equivalentes) | Una escritura del ACK; las demás «repetido» | Codex |
| V-TX-04 | `GET /iot/ordenes` concurrente con `crearOrden` | Sin deadlock no resuelto; la orden aparece en ≤ 1 ciclo | Codex |
| V-TX-05 | Telemetría con reconciliación de modo + PATCH de control simultáneos | Sin deadlock; versión de configuración monótona | Codex |
| V-TX-06 | Bloqueo retenido > `lock_timeout` (sesión de prueba que sostiene `FOR UPDATE`) | 503 `SERVICIO_NO_DISPONIBLE` en ≤ ~5 s; no hay reintento infinito | Codex |
| V-TX-07 | Error SQL dentro de una transacción | ROLLBACK completo, cliente liberado, el pool no se agota tras 20 repeticiones | Codex |
| V-TX-08 | Revisión de código: toda transacción con órdenes, actuadores o configuración empieza por `bloquearDispositivo` | 0 excepciones | Rev |
| V-TX-09 | Revisión: ningún `try/catch` de errores SQL dentro de `transaccion()` que continúe | 0 casos | Rev |

## 5. Identificadores, tipos y tiempo

| ID | Verificación | Criterio | Resp. |
|---|---|---|---|
| V-ID-01 | La secuencia de órdenes no retrocede ni se repite tras ROLLBACK | Crecientes (con huecos permitidos) | Codex |
| V-ID-02 | Orden con id cercano a 2^53−1 (secuencia ajustada en el temporal) | Respuesta JSON con número exacto; con 2^53 o más, `ck_rango_ordenes_id` lo rechaza | Codex |
| V-TYPE-01 | Ninguna respuesta JSON contiene ids, conteos ni humedades como string | Prueba que recorre las respuestas de todas las rutas del panel y del IoT | Codex |
| V-TYPE-02 | `DECIMAL(4,1)` ida y vuelta: 30,0; 55,5; 99,9; NULL | Igual en ambos motores | Codex |
| V-TYPE-03 | JSONB: `parametros`, `datos`, `diagnostico`, `ack_cuerpo` ida y vuelta | Objeto equivalente | Codex |
| V-TIME-01 | Fechas con milisegundos: `creada_en`, `expira_en`, `medido_en` | `iso()` devuelve `…sssZ` idéntico al valor enviado | Codex |
| V-TIME-02 | Proceso con `TZ=America/Guatemala` | Las respuestas siguen siendo UTC | Codex |
| V-TIME-03 | `expira_en = now() + ttl` | Diferencia con el TTL < 1 s | Codex |

## 6. SQL reescrito (V-SQL): ambos motores

| ID | Sentencia | Criterio |
|---|---|---|
| V-SQL-01 | Telemetría duplicada (mismo `id_arranque` + `seq`) | `duplicadas` correcto; no hay segunda fila |
| V-SQL-02 | Lectura con FK inválida (forzada en la prueba) | **Error**, no se silencia (PostgreSQL); documentar la diferencia con MySQL |
| V-SQL-03 | Reinicio del dispositivo: `UPDATE … FROM` cierra los ciclos abiertos con `duracion_s` correcta (±1 s) | OK |
| V-SQL-04 | `RIEGO_FINALIZADO` cierra sólo el ciclo abierto más reciente | OK con dos ciclos abiertos |
| V-SQL-05 | Bloqueo progresivo de login (`CASE` + intervalo en minutos) | 5.º fallo → 1 min; 6.º → 2 min |
| V-SQL-06 | Calibración con y sin confirmar (`CASE` en `calibrado_por`/`calibrado_en`) | Sólo se rellenan al confirmar |
| V-SQL-07 | Rotación de token con gracia 0 y 24 h | Gracia 24 h: el anterior conserva el hash viejo y caduca a +24 h; gracia 0: NULL |
| V-SQL-08 | Historial agregado (`hora`, `día`) | Mismos buckets, promedios e inválidas en ambos motores con el mismo conjunto de datos |
| V-SQL-09 | `PATCH /actuadores/:id/control` con sensor NULL | 200 en PostgreSQL (regresión del LEFT JOIN `FOR UPDATE`) |
| V-SQL-10 | Traductor `?`→`$n` | Pruebas unitarias de C-3.2; rechaza los operadores JSONB `?` |

Resp.: **Codex**; **Rev** repite V-SQL-08 y V-SQL-09 de forma independiente.

## 7. API y autenticación (V-API / V-AUTH)

| ID | Verificación | Criterio | Resp. |
|---|---|---|---|
| V-API-01 | Equivalencia de respuestas: misma secuencia de solicitudes (seed + simulador) contra el backend en MySQL y en PostgreSQL | JSON idéntico salvo ids aleatorios (uuid), horas y `X-Request-Id` | Rev (script en la copia aislada) |
| V-API-02 | `/api/x` devuelve 404 JSON; `/ruta-spa` devuelve el HTML; `/assets/*` con caché inmutable | OK | Codex |
| V-AUTH-01 | Login → cookie con atributos exactos (C-7.1) | `Set-Cookie` coincide literalmente | Codex |
| V-AUTH-02 | Refresh con rotación; reutilización del token viejo revoca la familia | OK en ambos motores | Codex (existente) |
| V-AUTH-03 | Logout borra la cookie con los mismos atributos | `Set-Cookie` de expiración con `Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict` | Codex |
| V-AUTH-04 | Email con mayúsculas: el login funciona; un duplicado con otras mayúsculas falla | OK | Codex |
| V-AUTH-05 | Límite de login IP+email (C-7.4) | Según el contrato | Codex |
| V-AUTH-06 | Navegador real (Chromium, perfil móvil) contra la build servida por Express en HTTPS local, con `TRUST_PROXY` y un proxy TLS local | Login, recarga (refresh con cookie), logout | Rev |

## 8. Seguridad de la bomba (V-BOMBA): ambos motores

| ID | Verificación | Criterio | Resp. |
|---|---|---|---|
| V-BOMBA-01 | `PERMITIR_ENCENDIDO=false` (por defecto): `POST` de ENCENDER | Rechazado (código actual) | Codex (existente) |
| V-BOMBA-02 | Modo AUTOMÁTICO solicitado | Rechazado | Codex (existente) |
| V-BOMBA-03 | ENCENDER pendiente creado con el flag en `true` y servidor relanzado con `false` | `/iot/ordenes` lo cancela y no lo entrega | Codex (existente) |
| V-BOMBA-04 | `/iot/configuracion` con AUTOMÁTICO en la base | Entrega MANUAL | Codex (existente) |
| V-BOMBA-05 | Telemetría con bomba encendida > `ENCENDIDO_MAX_S`+3 s | Se crea BOMBA_APAGAR de seguridad | Codex (existente) |
| V-BOMBA-06 | Ningún archivo versionable contiene `PERMITIR_ENCENDIDO=true` | 0 coincidencias (las pruebas lo fijan sólo en memoria) | Rev |
| V-BOMBA-07 | Firmware sin cambios | SHA-256 de `firmware-esp32/**` igual a la línea base | Rev |

## 9. Aislamiento y preservación

| ID | Verificación | Criterio | Resp. |
|---|---|---|---|
| V-ISO-01 | Las pruebas PostgreSQL usan sólo `127.0.0.1` y un directorio temporal | Revisión del arnés + guarda C-2.3 probada (un host remoto aborta) | Rev |
| V-ISO-02 | El arnés no carga `backend/.env` | Revisión + prueba con un `.env` señuelo inválido | Rev |
| V-ISO-03 | MySQL `agrocontrol` intacta | Huellas por tabla de sólo lectura iguales a la línea base **en las tablas que no escribe el tráfico local**; véase el procedimiento en INFORME_SUPERVISION §3 | Rev |
| V-ISO-04 | `database/schema.sql`, `importar-esquema.ps1` y los documentos de la Fase 1 sin cambios | SHA-256 igual a la línea base | Rev |
| V-SEC-01 | Escaneo de secretos (C-10.7) + escaneo independiente | 0 hallazgos en archivos no ignorados | Codex + Rev |

## 10. Criterio global de aprobación

La portabilidad se declara **APROBADA** sólo si:
1. todas las filas V-* están en ✅, o en ⚠ con una desviación aprobada por escrito;
2. `npm run typecheck` (backend y frontend), `npm run build` (backend), `npm run build:real` (frontend), `npm test` (MySQL), `npm run test:pg` y `npm test` del frontend terminan con código 0 **en la ejecución independiente de la revisión**, no sólo según el informe de Codex;
3. V-ISO-03, V-ISO-04, V-BOMBA-06/07 y V-SEC-01 están en ✅.
