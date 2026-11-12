# Plan de migración reversible — AgroControl-IoT

- **Fecha:** 2026-11-08
- **Arquitectura objetivo (recomendada, pendiente de autorización):** opción B: Render Static Site + Render Free Web Service + PostgreSQL en Supabase Free. El plan C (Oracle + MySQL) se describe en §8.
- **Invariantes en todas las fases:**
  1. La base MySQL local **no se modifica ni se elimina**. Sólo se usan lecturas (`mysqldump --single-transaction`, `SELECT`).
  2. `PERMITIR_ENCENDIDO=false` en todos los entornos. La bomba sin alimentación eléctrica.
  3. Sin migraciones destructivas (`DROP`, `TRUNCATE`, `DELETE` masivo) en ningún destino con datos.
  4. Secretos sólo en los paneles de los proveedores o en un gestor de contraseñas; nunca en el repositorio, en registros ni en documentación.
  5. Cada fase tiene criterio de salida y vuelta atrás. No se avanza sin evidencia.
  6. Commits y push sólo por decisión explícita del usuario. Sin atribución a herramientas de IA.

---

## Fase 0 — Decisiones y preparación (usuario, ≈ 1 h)

| Paso | Detalle | Salida |
|---|---|---|
| 0.1 | Autorizar la arquitectura (B, C o F) y los proveedores | Decisión escrita |
| 0.2 | Decidir si se migran datos históricos o se arranca limpio con seed (ver D-3) | Decisión |
| 0.3 | Crear cuentas (Render, Supabase) con 2FA. **Sin tarjeta** si es posible, para que no haya cobros por exceso (verificar el comportamiento de Render Hobby sin tarjeta) | Cuentas |
| 0.4 | Elegir la región más cercana a Guatemala con latencia baja entre Render y la base: **Render Ohio/Virginia + Supabase us-east** | Región |
| 0.5 | Repositorio GitHub (privado recomendado) y primer commit **hecho por el usuario** tras el escaneo de secretos | Rama `main` |

## Fase 1 — Respaldo y línea base (sólo lectura, ≈ 1 h)

1. **Respaldo lógico completo de MySQL** (lectura consistente, sin bloqueos):
   ```powershell
   mysqldump --single-transaction --routines --triggers --hex-blob --default-character-set=utf8mb4 `
     --set-gtid-purged=OFF -h 127.0.0.1 -u <usuario> -p agrocontrol > respaldo\agrocontrol_2026MMDD.sql
   ```
   - Guardar **fuera del repositorio** (el `.gitignore` ya excluye `*.sql.gz` y `*.dump`, pero no `*.sql`: usar una carpeta fuera del árbol). Cifrar el archivo (7-Zip AES-256) porque contiene hashes de contraseñas y tokens.
   - Calcular y anotar el SHA-256 del respaldo.
2. **Prueba de restauración** del respaldo en un MySQL temporal (el mismo mecanismo de `pruebas-con-bd-temporal.mjs`), nunca sobre `agrocontrol`.
3. **Línea base de integridad** (script de sólo lectura, T-PG-08) que produce `linea_base.json` con:
   - `COUNT(*)` por tabla (17);
   - `MAX(id)` por tabla con identidad;
   - huella por tabla: SHA-256 de las filas canonicalizadas (columnas en orden fijo, fechas ISO-8601 UTC con ms, decimales normalizados, JSON con claves ordenadas), en orden de PK;
   - resultado de `auditarConsistencia()` y de `verificarEsquema()`.

**Salida:** respaldo restaurable verificado + `linea_base.json`. **Vuelta atrás:** no aplica (nada cambió).

## Fase 2 — Portabilidad del código (Codex, 3–5 días; revisión 1 día)

Estrategia: **doble motor temporal**, seleccionado por `DB_MOTOR=mysql|postgres` (por defecto `mysql`), para que el entorno local siga funcionando idéntico durante toda la transición. Tareas detalladas en [TAREAS_PARA_CODEX.md](TAREAS_PARA_CODEX.md).

| Paso | Contenido |
|---|---|
| 2.1 | `database/postgres/schema.sql` traducido según la matriz (identidad, CHECK de ENUM, TIMESTAMPTZ, JSONB, triggers plpgsql, trigger `actualizado_en`, `lower(email)` único) |
| 2.2 | Adaptador en `db.ts`: `?→$n`, `affectedRows`, `insertId` vía `RETURNING`, parsers de tipos, códigos de error reintentables, transacciones |
| 2.3 | Reescritura de las 14 sentencias 🔴 de la matriz §4.2 en versiones portables o específicas por motor |
| 2.4 | `verificacion.ts` por motor (nombres esperados de tablas, triggers y CHECK) |
| 2.5 | Arnés de pruebas con PostgreSQL efímero; **toda la suite (53 + nuevas) debe pasar en ambos motores** |
| 2.6 | Pruebas nuevas específicas: inmutabilidad (trigger) en PostgreSQL, idempotencia concurrente, `FOR UPDATE OF`, `ON CONFLICT`, zona horaria, bigint y numeric, email insensible a mayúsculas |

**Criterio de salida:** CI local verde en MySQL **y** PostgreSQL, *typecheck*, *build*, revisión de auditoría sin hallazgos 🔴. **Vuelta atrás:** `DB_MOTOR=mysql` (por defecto); el código MySQL permanece intacto.

## Fase 3 — Ensayo general en PostgreSQL local o efímero (≈ 0,5 día)

1. Crear el esquema PostgreSQL en una instancia efímera.
2. Ejecutar el **migrador de datos** (T-PG-09) desde el MySQL **local en modo lectura** hacia esa instancia:
   - orden de carga respetando las FK: `usuarios → terrenos → usuario_terreno → cultivos → zonas → dispositivos → sensores → actuadores → configuraciones_control → ordenes_riego → mediciones → eventos_dispositivo → arranques_dispositivo → ciclos_riego → alertas → auditoria → tokens_refresco`;
   - conserva los ids (`OVERRIDING SYSTEM VALUE`) y después aplica `setval` a cada identidad con `MAX(id)`;
   - triggers de inmutabilidad y de `actualizado_en`: durante la carga, `ALTER TABLE … DISABLE TRIGGER USER` (lo permite el propietario de la tabla; `session_replication_role` exige superusuario y no está disponible en Supabase). Se reactivan al terminar y se verifica con `pg_trigger.tgenabled`;
   - `ordenes_riego.cerrada_por_orden_id` (autorreferencia): cargar con NULL y completar en una segunda pasada, ya con el trigger desactivado.
3. **Pruebas de integridad** (T-PG-08 contra el destino): mismas huellas por tabla que la línea base; conteos iguales; `MAX(id)` iguales; identidades > `MAX(id)`; 0 huérfanos FK; los 7 CHECK validados (`ALTER TABLE … VALIDATE CONSTRAINT`); triggers habilitados; `auditarConsistencia()` con los mismos hallazgos que en origen.
4. Arrancar el backend contra el destino y ejecutar el simulador del ESP32 y la prueba de humo HTTP.

**Criterio de salida:** informe de integridad 100 % coincidente. **Vuelta atrás:** se descarta la instancia efímera.

## Fase 4 — Infraestructura en la nube (usuario + guía, ≈ 0,5 día)

| Paso | Detalle |
|---|---|
| 4.1 | Supabase: proyecto, usuario de aplicación **no propietario** con `SELECT, INSERT, UPDATE` y `DELETE` sólo en las 5 tablas actuales (equivale a §8 del esquema MySQL). Esquema creado con el rol propietario |
| 4.2 | Cadena de conexión del *pooler* en **modo sesión** (IPv4, puerto 5432 del *pooler*), `sslmode=verify-full` con la CA de Supabase |
| 4.3 | Render Web Service: build `npm ci --include=dev && npm run build`, start `npm run start:compiled`, `NODE_VERSION` fijada, *health check* `/api/v1/salud`, 1 instancia. Variables: `NODE_ENV=production`, `HOST=0.0.0.0`, `DB_MOTOR=postgres`, `DATABASE_URL`, `DB_SSL_CA`, `JWT_SECRETO` **nuevo**, `CORS_ORIGENES=<origen web>`, `TRUST_PROXY=<medido>`, `PERMITIR_ENCENDIDO=false`, `ENCENDIDO_MAX_S=5`, `IOT_PERMITIR_HTTP_LOCAL=false` |
| 4.4 | Medir `TRUST_PROXY`: con un valor provisional, verificar `req.secure` y `req.ip` mediante la prueba de humo (T-08). Rechazar valores universales |
| 4.5 | Render Static Site: `npm ci --include=dev && npm run build:real`, publicar `dist-real`, reescritura `/*` → `/index.html` y `/api/*` → `https://<backend>.onrender.com/api/*`. **Verificar** que la reescritura actúa como proxy (mismo origen y cookie). Si no lo hace, aplicar el plan alternativo: Express sirve `dist-real` (T-PG-13) |
| 4.6 | Cargar datos: si D-3 = migrar, ejecutar el migrador de la Fase 3 contra Supabase con **confirmación de host** (T-07) y repetir las pruebas de integridad. Si D-3 = limpio, ejecutar el seed remoto y guardar el token del ESP32 en el gestor |
| 4.7 | Prueba de humo pública (T-08): `/salud` 200, login, refresh, recarga, logout, 404 `/api/x`, CORS de origen ajeno 403, ENCENDER rechazado, `/iot` con token inválido 401 |
| 4.8 | Prueba desde el celular con **datos móviles** (no Wi-Fi local) y la PC **apagada** |

**Criterio de salida:** casillas C1–C7 de `CHECKLIST_FINAL.md` con evidencia. **Vuelta atrás:** se apagan los servicios en la nube; el entorno local sigue intacto y operativo.

## Fase 5 — Conmutación del ESP32 (usuario con hardware, ≈ 1 h)

1. Obtener la cadena real: `openssl s_client -connect <backend>.onrender.com:443 -showcerts`. Construir el paquete PEM de raíces (ISRG Root X1 + GTS Root R1 como mínimo; añadir X2 y R4 si caben en 8192 caracteres).
2. **Antes de reaprovisionar**, anotar la URL, la CA y el token actuales del NVS (el token sólo existe en el gestor de contraseñas; no está en el repositorio).
3. Aprovisionar la URL, la CA y el token de producción por USB. Comprobar en el monitor serie: `api GET /salud HTTP=200`, telemetría 200 y lecturas visibles en el panel.
4. Verificar que con `PERMITIR_ENCENDIDO=false` el panel rechaza ENCENDER, que APAGAR se entrega y se confirma, y que el modo AUTOMÁTICO no se entrega.
5. Observar 24 h: la presencia sigue EN_LINEA, sin `SIN_ACK` anómalos, y el consumo de ancho de banda y de base de datos coincide con la estimación.

**Vuelta atrás:** reaprovisionar la URL, la CA y el token anteriores (PC + Cloudflare Tunnel + MySQL local). Los datos generados en la nube durante la prueba pueden exportarse de vuelta con el migrador inverso (opcional, T-PG-09 `--inverso`) o descartarse.

## Fase 6 — Estabilización y retirada controlada (≈ 1 semana de observación)

- Copias: volcado lógico diario `pg_dump` (lo ejecuta el usuario o una tarea programada fuera de Render, p. ej. una Action de GitHub con secretos) hacia almacenamiento privado. Prueba de restauración semanal.
- Retención: agregar `mediciones` de más de 30–90 días a promedios horarios y conservar los datos crudos recientes (requiere decisión D-5 y una tarea con permisos `DELETE` acotados).
- Alertas de uso al 70 % en Render (ancho de banda) y en Supabase (almacenamiento y *egress*).
- Mantener la base MySQL local **sin cambios** como respaldo frío al menos 30 días. Su eventual archivo es decisión del usuario.

---

## Decisiones que requieren autorización

| ID | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D-1 | Arquitectura | B (Render + Supabase) / C (Oracle + MySQL) / F (Railway de pago) / A (Neon Free, sólo demostración) | **B**, con C como alternativa |
| D-2 | Motor | Migrar a PostgreSQL con doble motor temporal / conservar MySQL | Migrar con doble motor (reversible) |
| D-3 | Datos históricos | Migrar todo / arrancar limpio con seed | Migrar: el volumen es pequeño y conserva la auditoría |
| D-4 | Semántica de FK con triggers en PostgreSQL | Aceptar el comportamiento más estricto (baja lógica) / relajar el trigger | Aceptar el más estricto |
| D-5 | Retención de `mediciones` | 30 / 90 / 180 días de datos crudos + agregados | 90 días |
| D-6 | Frecuencia de sondeo del ESP32 en producción | 3 s (actual) / 5 s | 5 s (≈ −40 % de tráfico); APAGAR sigue < 10 s y el firmware limita el riego a 5 s |
| D-7 | Frontend | Render Static + reescritura / Express sirve la SPA / Vercel | Render Static si la reescritura actúa como proxy; si no, Express |
| D-8 | Visibilidad del repositorio | Público / privado | Privado |
| D-9 | Tarjeta de crédito en los proveedores | Sí / no | No (evita cobros por exceso); aceptar la suspensión como modo de fallo |

## Estimación de tiempos

| Fase | Responsable | Duración |
|---|---|---|
| 0 Decisiones y cuentas | Usuario | 1 h |
| 1 Respaldo y línea base | Usuario + Codex (script) | 1–2 h |
| 2 Portabilidad | Codex | 3–5 días |
| 2 Revisión y validación | Auditor | 1 día (en paralelo parcial) |
| 3 Ensayo general | Codex + auditor | 0,5 día |
| 4 Infraestructura | Usuario + guía | 0,5 día |
| 5 ESP32 | Usuario | 1 h + 24 h de observación |
| 6 Estabilización | Todos | 1 semana (no bloquea) |
| **Total hasta producción** | | **≈ 6–8 días hábiles** |

Plan C (Oracle + MySQL): ≈ **1,5–2 días** hasta producción (sin la Fase 2), con más riesgo operativo.

## 8. Variante C — Oracle Always Free con MySQL (sin migrar código)

1. VM (A1 Arm o E2.1.Micro) con Ubuntu LTS; firewall que sólo abre 80/443; SSH sólo con clave.
2. MySQL 8.0.x **local en la VM** (`bind-address=127.0.0.1`), base `agrocontrol` importada con `importar-esquema.ps1` adaptado o `mysql` CLI; usuario `agro_app` con los privilegios del §8 del esquema.
3. Backend como servicio systemd (`node dist/src/server.js`, `HOST=127.0.0.1`), con Caddy delante (TLS automático con Let's Encrypt; dominio propio o DuckDNS). `TRUST_PROXY=loopback` funciona tal cual.
4. Caddy sirve también `dist-real`, con lo que hay mismo origen sin cambios.
5. CA del ESP32: ISRG Root X1 (+ X2).
6. Copias: `mysqldump` diario por cron hacia Object Storage (Always Free, 20 GB), cifrado.
7. Datos: restaurar el respaldo de la Fase 1 (la versión de MySQL es la misma). Integridad comparando la línea base.
