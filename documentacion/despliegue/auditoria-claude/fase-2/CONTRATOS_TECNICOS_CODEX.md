# Contratos técnicos para Codex — Fase 2

- **Fecha:** 2026-11-09 · **Versión del contrato:** 2.0
- **Carácter:** normativo. «DEBE» y «NO DEBE» son obligatorios. Una desviación sólo es válida si se registra en el informe de resultados con su justificación y la aprueba la revisión de arquitectura.
- **Base:** hallazgos de `auditoria-claude/` (Fase 1) y `preparacion-codex/` (Fase 1), consolidados en [ARQUITECTURA_FINAL.md](ARQUITECTURA_FINAL.md).
- **Prevalencia:** si este documento contradice `TAREAS_PARA_CODEX.md` de la Fase 1, **prevalece este**. Los cambios respecto de la Fase 1 están marcados con **Δ**.

---

## C-0 · Reglas de proceso

| # | Regla |
|---|---|
| C-0.1 | **Propiedad de archivos.** Codex es el único que modifica `backend/`, `frontend/`, `database/postgres/` (nuevo) y `documentacion/despliegue/preparacion-codex/`. La revisión de arquitectura sólo escribe en `documentacion/despliegue/auditoria-claude/fase-2/` y ejecuta sus pruebas independientes en una copia fuera del repositorio. |
| C-0.2 | **NO DEBE** modificarse: `database/schema.sql`, `database/importar-esquema.ps1`, `firmware-esp32/**`, `tests/firmware/**`, `backend/.env`, ni los documentos de la Fase 1 de ambas carpetas. |
| C-0.3 | **Operaciones prohibidas:** crear o modificar recursos en Supabase o Render; conectarse a cualquier base que no sea temporal y local; ejecutar migraciones reales; escribir en la base MySQL `agrocontrol`; commits o push; publicar el repositorio; cambiar credenciales reales; flashear o aprovisionar el ESP32; poner `PERMITIR_ENCENDIDO=true` en un archivo de configuración o plantilla. |
| C-0.4 | Sin secretos en archivos versionables. Las plantillas usan marcadores `<…>`. Ningún log, error ni informe repite valores de `DATABASE_URL`, `DB_CONTRASENA`, `JWT_SECRETO` ni tokens. |
| C-0.5 | Sin firmas ni atribuciones de autoría o coautoría a herramientas de IA en código, comentarios, commits o documentos. |
| C-0.6 | Dependencias nuevas con **versión exacta** (sin `^` ni `~`), publicadas hace al menos dos semanas, y `package-lock.json` actualizado con `npm install --save-exact`. Lista permitida: `pg`, `@types/pg`, `embedded-postgres` (sólo `devDependencies`). Cualquier otra dependencia requiere aprobación previa. |
| C-0.7 | **Entrega por bloques** (§C-12). Cada bloque termina con un informe en `documentacion/despliegue/preparacion-codex/fase-2/RESULTADOS_BLOQUE_<n>.md` con: archivos tocados (ruta + SHA-256), comandos ejecutados, código de salida, totales de pruebas y desviaciones. Sin informe no hay revisión. |

---

## C-1 · Topología de despliegue **Δ**

| # | Contrato |
|---|---|
| C-1.1 | **Un único Render Web Service** sirve la API (`/api/*`) **y** el frontend compilado (todo lo demás) desde el **mismo origen**. Queda descartada la combinación Static Site + reescritura (ver ARQUITECTURA_FINAL §3). |
| C-1.2 | Nueva variable `SERVIR_FRONTEND` (ruta absoluta o relativa al directorio `backend/` de un `dist-real` compilado). Si no existe o está vacía: comportamiento actual, sin servir archivos. Si apunta a una ruta inexistente o sin `index.html`, el arranque **DEBE fallar** con un mensaje claro. |
| C-1.3 | Orden de *middlewares*: `idSolicitud` → registro IoT → `helmet` (CSP de §C-7.6) → CORS → `cookieParser` → rutas `/api/v1/*` → 404 JSON para `/api/*` → estáticos → *fallback* SPA → manejador de errores. **Ninguna ruta `/api/*` DEBE devolver `index.html`.** |
| C-1.4 | Estáticos: `/assets/*` con `Cache-Control: public, max-age=31536000, immutable`; `index.html` con `Cache-Control: no-cache`. Sin listado de directorios (`index: false` en el *fallback*) y sin servir archivos ocultos (`dotfiles: 'ignore'`). El *fallback* SPA sólo responde a `GET`/`HEAD` con `Accept` que incluya `text/html`. |
| C-1.5 | Comandos de Render (se documentan; **no se crean recursos**). Build: `cd frontend && npm ci --include=dev && npm run build:real && cd ../backend && npm ci --include=dev && npm run build`. Start: `cd backend && npm run start:compiled`. *Health check*: `/api/v1/salud`. 1 instancia. `NODE_VERSION` = la versión mayor validada localmente (22 LTS). |
| C-1.6 | `engines.node` en `backend/package.json` y `frontend/package.json` (`">=22 <25"` o el rango validado). |
| C-1.7 | `frontend/scripts/validar-despliegue.mjs`: bloquear marcadores `.example` también cuando `RENDER=true`. `vercel.json` se conserva sin cambios (alternativa futura, no activa). |

## C-2 · Configuración **Δ**

| Variable | Tipo/validación | Por defecto | Notas |
|---|---|---|---|
| `DB_MOTOR` | `mysql` \| `postgres` | `mysql` | Selecciona el adaptador. En `NODE_ENV=production` **DEBE** declararse explícitamente; si falta, el arranque falla. |
| `DATABASE_URL` | URL `postgres://` o `postgresql://` | — | Obligatoria si `DB_MOTOR=postgres`. **NO DEBE** imprimirse. Los mensajes de validación indican sólo «inválida» o «ausente». |
| `DB_SSL_CA` | PEM (acepta `\n` literales) | — | Para PostgreSQL: si `NODE_ENV=production`, **DEBE** haber TLS con `rejectUnauthorized: true`. Con `sslmode` en la URL, la configuración explícita `ssl` del *driver* prevalece; documentar la interacción y probarla. |
| `PG_POOL_MAX` | entero 1–10 | `5` | El modo sesión del *pooler* de Supabase tiene un límite bajo de clientes. |
| `PG_CONNECTION_TIMEOUT_MS` | 1000–30000 | `10000` | |
| `PG_STATEMENT_TIMEOUT_MS` | 1000–60000 | `10000` | Se aplica por conexión (`SET statement_timeout`). |
| `PG_LOCK_TIMEOUT_MS` | 500–30000 | `5000` | `SET lock_timeout`. |
| `SERVIR_FRONTEND` | ruta | — | §C-1.2 |
| `TRUST_PROXY` | ver C-2.1 | `loopback` | **Validación estricta integrada en `config.ts`** (cierra T-14). |
| `DB_HOST`…`DB_SSL` (actuales) | sin cambios | | Sólo para `DB_MOTOR=mysql`. |

- **C-2.1 `TRUST_PROXY` Δ:** se aceptan (a) los alias `loopback`, `linklocal`, `uniquelocal`; (b) IP o CIDR con prefijo > 0; (c) **nuevo:** `saltos:N` con N entero de 1 a 3, que se convierte al **número** N en `app.set('trust proxy', N)`. Se rechazan `true`, `false`, números sueltos, `*`, `0.0.0.0/0`, `::/0` y vacíos. La forma `saltos:N` existe porque en PaaS la cadena de proxies es fija y el puerto de la aplicación no es accesible sin pasar por ella. El valor real para Render se **mide** (C-2.2) y nunca se supone.
- **C-2.2 Diagnóstico de proxy:** `DIAGNOSTICO_PROXY=true` (desactivado por defecto; en `production` sólo se acepta si además `DIAGNOSTICO_PROXY_HASTA=<ISO-8601>` es una fecha futura de como máximo 24 h) habilita `GET /api/v1/diagnostico/proxy`. Devuelve **sólo** `{ ip, ips, secure, protocolo, saltos_xff }` del propio solicitante, sin otras cabeceras ni datos del servidor. Debe tener una prueba que verifique que, sin la variable, responde 404.
- **C-2.3 Guardas de entorno de prueba:** con `NODE_ENV=test` y `DB_MOTOR=postgres`, el host de `DATABASE_URL` **DEBE** ser `127.0.0.1`, `::1` o `localhost`. En caso contrario, el proceso aborta antes de conectar. Lo mismo para `DB_HOST` con `mysql`.
- **C-2.4 Plantillas:** actualizar `.env.example` y `.env.production.example` con las variables nuevas como marcadores. `PERMITIR_ENCENDIDO=false` y `DB_MOTOR=postgres` en la de producción.

## C-3 · Capa de acceso a datos **Δ**

| # | Contrato |
|---|---|
| C-3.1 | Interfaz única exportada por `src/db.ts` (o `src/db/index.ts`): `filas`, `fila`, `ejecutar`, `transaccion`, `bloquearDispositivo`, `cerrarBd`, tipo `Con`. Los módulos **NO DEBEN** importar `mysql2` ni `pg` directamente, ni usar `con.query` (eliminar los 3 usos en `panel.ts:201, 355, 356`). Los tipos `PoolConnection` en firmas de `iot.ts`/`servicio.ts` pasan a un tipo propio `ConTx`. |
| C-3.2 | **Marcadores:** el SQL de la aplicación se sigue escribiendo con `?`. El adaptador PostgreSQL los traduce a `$1…$n` ignorando `?` dentro de literales `'…'` (con `''` escapado), identificadores `"…"` y comentarios. **DEBE** tener pruebas unitarias puras: literal con `?`, `''`, comentario `--`, operadores JSONB `?`/`?|` (**prohibidos** en el SQL de la aplicación; el traductor los rechaza con un error explícito). |
| C-3.3 | `ejecutar()` devuelve `{ affectedRows, insertId }`. En PostgreSQL, `affectedRows = rowCount` (filas coincidentes, igual que mysql2 con `CLIENT_FOUND_ROWS`, que es su valor por defecto) e `insertId = rows[0].id` sólo si la sentencia termina en `RETURNING id`. Un INSERT cuyo `insertId` se use **DEBE** escribirse con `RETURNING id` final. Como MySQL 8 no admite `RETURNING`, el adaptador MySQL **DEBE** quitar ese sufijo exacto antes de ejecutar y tomar `insertId` del `ResultSetHeader`. Probarlo en ambos motores. |
| C-3.4 | **Tipos devueltos (PostgreSQL):** `setTypeParser` de int8 (20) → `number` con error si supera 2^53−1; numeric (1700) → `number`; timestamptz → `Date`; jsonb → objeto. Ningún `bigint` JS ni string numérico debe llegar a una respuesta JSON. Las respuestas HTTP **DEBEN** ser byte a byte equivalentes entre motores en los campos de contrato (ver la prueba V-API de la matriz). |
| C-3.5 | **Transacciones:** cliente exclusivo del pool entre `BEGIN` y `COMMIT/ROLLBACK`, liberado en `finally`. Nivel **READ COMMITTED** (por defecto en PostgreSQL), no SERIALIZABLE. Reintento de la **transacción completa** hasta 3 veces sólo ante `40P01` (deadlock) y `40001` (serialización). `55P03` (lock_timeout) y `57014` (statement_timeout) **no** se reintentan: se mapean a 503 `SERVICIO_NO_DISPONIBLE`. MySQL conserva su comportamiento actual. |
| C-3.6 | **Orden de bloqueo invariante:** toda transacción que toque órdenes, actuadores o configuración de un dispositivo **DEBE** ejecutar `bloquearDispositivo` como primera sentencia, igual que hoy. Prueba de concurrencia obligatoria (V-TX-*). |
| C-3.7 | `bloquearDispositivo` deja de usar `SELECT *`: lista las columnas que usan sus llamadores (ver OPTIMIZACION_IOT §3). |
| C-3.8 | `FOR UPDATE` con JOIN **DEBE** usar `FOR UPDATE OF <alias>` en PostgreSQL: `iot.ts` (entrega de órdenes, `OF o`) y `servicio.ts` (`actualizarControl`, `OF a, cc`). En MySQL se mantiene la sintaxis actual: el adaptador recibe la variante por motor o se usa una función `sqlPorMotor({ mysql, postgres })`. |
| C-3.9 | Conexión PostgreSQL: al crear cada conexión física, `SET TimeZone='UTC'`, `SET statement_timeout`, `SET lock_timeout`. Se usa el *pooler* en **modo sesión** (no transacción), así que los `SET` de sesión son válidos. No usar sentencias preparadas con nombre. |
| C-3.10 | Mapeo de errores (`errores.ts`): «caído» = códigos de red + `57P01`, `57P03`, `53300`, `08000`, `08001`, `08003`, `08006`, `55P03`, `57014`. Violación de unicidad `23505` y `ER_DUP_ENTRY` en la clave de idempotencia → devolver la orden previa (cierra A-11). Excepción `P0001` de los triggers → 500 registrado como `INMUTABILIDAD_VIOLADA` (es un error de programación, nunca del cliente). |

## C-4 · Esquema PostgreSQL **Δ**

Archivo nuevo: `database/postgres/schema.sql`, ejecutable con `psql -v ON_ERROR_STOP=1 --single-transaction`, sin `DROP`, `TRUNCATE` ni `\connect`. PostgreSQL **17** (versión de Supabase; las pruebas usan la misma versión mayor).

### C-4.1 Tipos (decisiones cerradas)

| MySQL | PostgreSQL | Restricción añadida (prefijo) |
|---|---|---|
| `INT UNSIGNED AUTO_INCREMENT` (PK) | `INTEGER GENERATED BY DEFAULT AS IDENTITY` | — (2^31 es suficiente; documentado) |
| `BIGINT UNSIGNED AUTO_INCREMENT` (PK) | `BIGINT GENERATED BY DEFAULT AS IDENTITY` | `ordenes_riego`: `ck_rango_ordenes_id CHECK (id <= 9007199254740991)` |
| FK `INT UNSIGNED` | `INTEGER` | — |
| `INT UNSIGNED` no FK (`config_version_*`, `descanso_min_s`, `riego_*_s`, `duracion_s`, `seq`…) | `BIGINT` | `ck_rango_<tabla>_<col> CHECK (col BETWEEN 0 AND 4294967295)` |
| `SMALLINT UNSIGNED` | `INTEGER` | `ck_rango_<tabla>_<col> CHECK (col BETWEEN 0 AND 65535)` si no está ya cubierto por un CHECK de negocio |
| `BIGINT UNSIGNED` no PK (`uptime_ms`, ids referenciados) | `BIGINT` | `ck_rango_… CHECK (col >= 0)` |
| `TINYINT UNSIGNED` | `SMALLINT` | `CHECK (col BETWEEN 0 AND 255)` |
| `TINYINT` booleano | `SMALLINT` | `ck_bool_<tabla>_<col> CHECK (col IN (0,1))` (los NULL siguen permitidos donde lo eran) |
| `ENUM(...)` | `TEXT` | `ck_enum_<tabla>_<col> CHECK (col IN (...))` |
| `DATETIME(3)` | `TIMESTAMPTZ(3)` | — |
| `DEFAULT CURRENT_TIMESTAMP(3)` | `DEFAULT now()` | — |
| `ON UPDATE CURRENT_TIMESTAMP(3)` (**8 tablas**: usuarios, terrenos, cultivos, zonas, dispositivos, sensores, actuadores, configuraciones_control) | Función `fn_tocar_actualizado_en()` + trigger `trg_<tabla>_actualizado_en BEFORE UPDATE` | Δ La Fase 1 decía 10 por error; son 8 |
| `DECIMAL(p,s)` | `NUMERIC(p,s)` | — |
| `JSON` | `JSONB` | — |
| `VARCHAR(n)`, `CHAR(n)`, `TEXT` | iguales | — |
| `UNIQUE KEY uq_usuarios_email (email)` (colación ci) | `CREATE UNIQUE INDEX uq_usuarios_email ON usuarios (lower(email))` | Además, la aplicación **DEBE** normalizar a minúsculas en toda escritura (seed y cambiar-contraseña) |

### C-4.2 Nombres invariantes

- Las 17 tablas, todas las columnas, los índices (`ix_*`, `uq_*`) y las FK (`fk_*`) conservan **exactamente** el nombre MySQL.
- Los **7 CHECK de negocio** conservan nombre y semántica: `ck_dispositivos_intervalos`, `ck_dispositivos_tope`, `ck_sensores_calibracion` (sin `CAST AS SIGNED`), `ck_cc_histeresis`, `ck_cc_rangos`, `ck_ordenes_ttl`, `ck_ordenes_duracion`.
- Restricciones técnicas nuevas sólo con prefijos `ck_enum_`, `ck_rango_` y `ck_bool_`, que nunca chocan con los 7 de negocio.
- Triggers: `trg_ordenes_inmutables`, `trg_ordenes_sin_borrado` (funciones `fn_ordenes_inmutables`, `fn_ordenes_sin_borrado`) y 8 × `trg_<tabla>_actualizado_en`.

### C-4.3 Triggers de inmutabilidad

- Traducción **cláusula por cláusula** de (a)–(e) del trigger MySQL; `<=>` → `IS NOT DISTINCT FROM`; `SIGNAL` → `RAISE EXCEPTION '<mismo mensaje>' USING ERRCODE = 'P0001'`.
- El trigger **NO DEBE** consultar `pg_trigger_depth()`, `session_replication_role` ni ninguna variable de sesión que permita saltarlo.
- **Semántica FK (decisión D-4, aprobada en ARQUITECTURA_FINAL §5):** en PostgreSQL las acciones referenciales disparan triggers. Se acepta el comportamiento más estricto: no se puede borrar un usuario o dispositivo con órdenes; la retirada es por baja lógica (`usuarios.activo=0`, `dispositivos.estado='DESHABILITADO'`). Documentarlo en un comentario del esquema y cubrirlo con la prueba V-TRG-09.

### C-4.4 Privilegios (referencia comentada, no se ejecuta)

Rol propietario `agro_owner` (DDL) y rol de aplicación `agro_app`: `USAGE` en el esquema; `SELECT, INSERT, UPDATE` en todas las tablas; `USAGE, SELECT` en las secuencias de identidad; `DELETE` sólo en `tokens_refresco`, `usuario_terreno`, `cultivos`, `zonas`, `terrenos` y, **sólo tras aprobar C-9.4**, en `mediciones`.

## C-5 · Verificación de arranque por motor **Δ**

| # | Contrato |
|---|---|
| C-5.1 | `verificacion.ts` compara **por nombre**, no por conteo: 17 tablas esperadas (ambos motores); triggers esperados por motor (MySQL: 2; PostgreSQL: 2 + 8); CHECK de negocio esperados: los 7 nombres exactos. En PostgreSQL usar `pg_catalog` (`pg_class`, `pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'`, `pg_constraint WHERE contype='c'`), restringido a `current_schema()`. |
| C-5.2 | En PostgreSQL, además: comprobar que los dos triggers de inmutabilidad están **habilitados** (`tgenabled='O'`). Si están deshabilitados, el arranque falla. |
| C-5.3 | `InformeEsquema.checks` pasa a ser la lista de nombres encontrados; mantener el mensaje de arranque actual con los conteos para ambos motores. |
| C-5.4 | Las consultas de `auditarConsistencia` y `contarDatos` deben ser portables o específicas por motor (`now() - interval '5 minutes'`). |

## C-6 · Reescritura de SQL

Aplicar la lista de `MATRIZ_COMPATIBILIDAD_POSTGRESQL.md` §4.2 (Fase 1), con estas precisiones:

| # | Contrato |
|---|---|
| C-6.1 | `INSERT IGNORE` → `INSERT … ON CONFLICT (<columnas exactas de la UNIQUE>) DO NOTHING` en PostgreSQL. **NO DEBE** usarse `ON CONFLICT DO NOTHING` sin objetivo. MySQL conserva `INSERT IGNORE`. |
| C-6.2 | Intervalos parametrizados: `now() + (? * interval '1 second')` (o `minute`, `hour`, `day`). `NOW(3)` → `now()` en PostgreSQL. |
| C-6.3 | `IF(c, a, b)` → `CASE WHEN c THEN a ELSE b END`. Los parámetros booleanos se envían como booleanos JS y se castean (`?::boolean`) en PostgreSQL. |
| C-6.4 | `UPDATE ciclos_riego c JOIN actuadores a …` → `UPDATE ciclos_riego c SET … FROM actuadores a WHERE a.id = c.actuador_id AND …`; `TIMESTAMPDIFF(SECOND,…)` → `floor(extract(epoch from (now() - c.iniciado_en)))::bigint`. |
| C-6.5 | `UPDATE … ORDER BY … LIMIT 1` → `UPDATE ciclos_riego SET … WHERE id = (SELECT id FROM ciclos_riego WHERE … ORDER BY iniciado_en DESC, id DESC LIMIT 1 FOR UPDATE)`. Se añade `id DESC` como desempate determinista **en ambos motores**. |
| C-6.6 | Agregación del historial: `floor(extract(epoch from medido_en) / ?) * ?` y `count(*) FILTER (WHERE estado <> 'OK')`. El resultado numérico se convierte a `number` (C-3.4). |
| C-6.7 | `rotarToken` (`servicio.ts:294`): conservar el orden de las asignaciones y añadir un comentario: en PostgreSQL todas las expresiones del SET leen la fila antigua, en MySQL de izquierda a derecha; con este orden el resultado coincide en ambos motores. Prueba V-SQL-07. |
| C-6.8 | `GREATEST` se mantiene: la columna es NOT NULL y no le afecta la diferencia en el manejo de NULL. |
| C-6.9 | No se introducen funciones exclusivas de Supabase (RLS, `auth.*`, extensiones). PostgreSQL estándar 17. |

## C-7 · Autenticación, cookies y seguridad HTTP

| # | Contrato |
|---|---|
| C-7.1 | La cookie `agc_refresh` conserva **exactamente** `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`. **NO DEBE** cambiarse a `None` ni `Lax`. |
| C-7.2 | `res.clearCookie` se llama con los mismos atributos (`httpOnly, secure, sameSite: 'strict', path`) para que el borrado sea fiable en todos los navegadores. |
| C-7.3 | JWT: HS256 fijado, acceso de 15 min y `sub` numérico. No cambiar. |
| C-7.4 | Límite de login: clave `sha256(ip + ':' + emailNormalizado)` con 5/min, más un tope global por IP de 30/min. Sin email válido, la clave es la IP. Respuesta 429 idéntica en ambos casos. |
| C-7.5 | CORS: sin cambios de lógica. Con mismo origen, `CORS_ORIGENES` en producción = el origen público del servicio Render (exacto, `https://`). |
| C-7.6 | **(rev. 2.1)** CSP del HTML servido: `default-src 'self'; script-src 'self' '<sha256 del script de tema>'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Motivos: (a) `frontend/index.html` contiene un `<script>` en línea que aplica el tema guardado antes de pintar. Con `script-src 'self'` el navegador lo bloquea (aparece un destello claro y un error de CSP). Opciones válidas: moverlo a un archivo `/tema-inicial.js` (preferido, sin hash que mantener) o añadir su hash calculado en la build. (b) La build usa Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`). Se permiten sólo esos dos hosts, no `https:` genérico. La prueba **DEBE** usar el `index.html` real de la build, no uno sintético. `upgrade-insecure-requests` sólo en `production`, para no romper las pruebas locales por HTTP. HSTS de helmet activo sólo en `production`. |
| C-7.7 | `/api/v1/salud` no añade versión, motor ni detalles internos. Puede incluir `base_datos: OK/NO_DISPONIBLE` (como hoy). |

## C-8 · Contrato IoT y seguridad de la bomba (invariantes)

| # | Contrato |
|---|---|
| C-8.1 | El contrato API IoT **1.0.2 no cambia**: rutas, cuerpos, códigos, cabeceras (`Authorization`, `X-Id-Arranque`, `ETag`) y semántica de deduplicación, ACK y entrega. |
| C-8.2 | `PERMITIR_ENCENDIDO=false` en todas las plantillas y en el entorno de pruebas por defecto. Las pruebas que necesiten `true` lo hacen **sólo en memoria**, dentro del proceso de prueba, contra una base temporal y sin red fuera de loopback. Deben estar agrupadas y nombradas `encendido-habilitado-simulado`. |
| C-8.3 | Se conservan las defensas del servidor: rechazo de ENCENDER y AUTOMÁTICO, cancelación de ENCENDER pendientes en `/iot/ordenes`, degradación AUTOMÁTICO→MANUAL en `/iot/configuracion` y apagado de seguridad. **Las pruebas existentes de estas defensas DEBEN pasar en ambos motores.** |
| C-8.4 | **Δ `intervalo_ordenes_s` ≤ 3.** El firmware corta el riego si pasan más de 4 s sin una respuesta correcta de la API (`ApiLeaseMs=4000` en `ManualSafety.h`) y no acelera el sondeo durante un riego. La aplicación **DEBE** rechazar (422) cualquier valor de `intervalo_ordenes_s` > 3 si en el futuro se expone, y el seed de demostración usa 3. Se anula la propuesta D-6 de la Fase 1 (5 s). |
| C-8.5 | Ningún cambio en el firmware ni en `tests/firmware/` en esta fase. |

## C-9 · Optimización IoT (detalle en [OPTIMIZACION_IOT.md](OPTIMIZACION_IOT.md))

| # | Contrato |
|---|---|
| C-9.1 | **Presencia con umbral:** `ultima_conexion_en`/`ultima_ip` se escriben sólo si han pasado ≥ 10 s desde la última escritura, cambió la IP o cambió el arranque. Caché en memoria `Map<dispositivoId, {t, ip}>` más una condición SQL de respaldo (`WHERE … AND (ultima_conexion_en IS NULL OR ultima_conexion_en < now() - interval '10 seconds' OR ultima_ip IS DISTINCT FROM ?)`). La autenticación (SELECT del token) **no** se cachea. |
| C-9.2 | **Tarea de caducidad:** intervalo 15 s (antes 5 s). Es seguro porque la entrega ya filtra `expira_en > now()`. La tarea de presencia se mantiene en 30 s. |
| C-9.3 | **Telemetría del seed de demostración:** `intervalo_telemetria_s = 15`. No se cambia el valor por defecto del esquema. |
| C-9.4 | **Retención y agregación** (bloque 5, requiere la aprobación explícita del permiso DELETE en `mediciones`): tabla `mediciones_hora` (sensor_id, hora `TIMESTAMPTZ`, lecturas, invalidas, promedio, minimo, maximo; PK (sensor_id, hora)), agregación idempotente con `ON CONFLICT DO UPDATE` y purga de datos crudos de más de `RETENCION_CRUDO_DIAS` (por defecto 30) en lotes de ≤ 5000 filas, sólo de horas ya agregadas. El historial **DEBE** combinar ambos orígenes de forma transparente para el contrato de `/sensores/:id/mediciones`. |
| C-9.5 | **Nunca se descartan:** eventos (`eventos_dispositivo`), ACK, alertas, auditoría, arranques ni lecturas con `estado <> 'OK'` dentro de la ventana de retención. La purga sólo afecta a `mediciones` crudas antiguas ya agregadas. |
| C-9.7 | **Camino rápido en `GET /iot/ordenes`** (O-2): comprobación sin bloqueo de órdenes entregables. Si no hay ninguna, se responde sin transacción ni `FOR UPDATE`. Si hay alguna, incluido un ENCENDER pendiente con el flag en `false`, se sigue el camino actual completo. Prueba V-IOT-01. Bloque 1. |
| C-9.8 | (Opcional) Sin cabecera CSP en las respuestas JSON de `/api/*` (O-6); el resto de cabeceras de helmet se conserva. Bloque 2. |
| C-9.9 | Purga diaria de `tokens_refresco` caducados o revocados hace más de 7 días (O-7). Bloque 5. |
| C-9.6 | Indicador de tamaño de base en `npm run verificar` (PostgreSQL: `pg_database_size`), con aviso al 60 % y al 80 % de `LIMITE_BD_MB` (por defecto 500). |

## C-10 · Pruebas

| # | Contrato |
|---|---|
| C-10.1 | `scripts/pruebas-con-pg-temporal.mjs`: PostgreSQL 17 vía `embedded-postgres` (versión exacta), en una carpeta temporal del sistema, con puerto libre, escuchando sólo en `127.0.0.1`, contraseña aleatoria por ejecución y borrado de la carpeta al terminar (también ante error o Ctrl+C). Importa `database/postgres/schema.sql` y ejecuta Vitest con `DB_MOTOR=postgres`. |
| C-10.2 | Scripts: `npm test` (MySQL, sin cambios), `npm run test:pg`, `npm run test:todos` (ambos en secuencia; falla si falla cualquiera). |
| C-10.3 | **Toda la suite existente (53 pruebas)** pasa en ambos motores sin que se debilite ninguna aserción. Si una prueba contiene SQL de MySQL, se hace portable. Cualquier `skip` o `todo` por motor requiere justificación en el informe y aprobación. |
| C-10.4 | Pruebas nuevas obligatorias: las marcadas como «Codex» en [MATRIZ_VALIDACION_POSTGRESQL.md](MATRIZ_VALIDACION_POSTGRESQL.md). |
| C-10.5 | Prohibido en pruebas: conectar a `agrocontrol` real, usar `backend/.env` (el arnés **DEBE** pasar un entorno explícito y no cargar dotenv), red fuera de loopback, instancias del ESP32 o simulador contra un servidor no temporal. |
| C-10.6 | Frontend: `npm test` y `npm run build:real` verdes; prueba de la CSP (C-7.6) con la build servida por Express (supertest + revisión del HTML). |
| C-10.7 | Escaneo de secretos antes de cada entrega: script `scripts/escanear-secretos.mjs` (sin dependencias) sobre los archivos no ignorados por Git. Patrones: `agc_dev_[A-Za-z0-9_-]{20,}`, `postgres(ql)?://[^<\s]+:[^<\s]+@`, `-----BEGIN (RSA |EC )?PRIVATE KEY`, `JWT_SECRETO=[^<\s]`, `DB_CONTRASENA=[^<\s]`, `eyJ[A-Za-z0-9_-]{20,}\.`. Salida: sólo archivo y línea, nunca el valor. |

## C-11 · Reversibilidad a MySQL

| # | Contrato |
|---|---|
| C-11.1 | `DB_MOTOR=mysql` (por defecto) **DEBE** comportarse como antes del cambio: la suite MySQL y el arranque contra el esquema MySQL actual (sin modificarlo) siguen verdes. |
| C-11.2 | No hay migración de datos en esta fase: la base de demostración es **nueva** y se crea con seed. El migrador MySQL→PostgreSQL (T-PG-09 de la Fase 1) queda **diferido**. |
| C-11.3 | Ninguna funcionalidad nueva (retención, `mediciones_hora`) puede volver obligatoria la versión PostgreSQL: en MySQL, la retención queda desactivada salvo que se implemente con su propio DDL en `database/migrations/` (fuera de alcance ahora). |

## C-12 · Bloques de entrega y puertas de revisión

| Bloque | Contenido | Puerta de revisión |
|---|---|---|
| 1 | C-2 (`TRUST_PROXY`, guardas, plantillas), C-7.2, C-7.4, C-9.1, C-9.2, C-10.7 | Suite MySQL verde + pruebas nuevas |
| 2 | C-1 (servir SPA, CSP, comandos, engines), C-7.6, C-10.6 | Build REAL + supertest + CSP |
| 3 | C-3, C-4, C-5, C-10.1–C-10.2 | Esquema PostgreSQL importa; arranque verifica; arnés funcional |
| 4 | C-6, C-10.3–C-10.4 | Suite completa en ambos motores + matriz V-* |
| 5 | C-9.3–C-9.6 | Retención probada en PostgreSQL temporal |
| 6 | Guía de despliegue Render/Supabase (documento, sin crear recursos) | Revisión documental |

Ningún bloque se considera aprobado sin la revisión independiente descrita en [INFORME_SUPERVISION.md](INFORME_SUPERVISION.md).
