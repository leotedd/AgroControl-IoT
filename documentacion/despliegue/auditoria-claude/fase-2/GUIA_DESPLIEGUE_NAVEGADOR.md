# Guía de despliegue desde el navegador — Render Free + Supabase Free

- **Fecha:** 2026-11-12 · Revisión de preparación final (supervisión independiente).
- **Alcance:** demostración con datos **sintéticos** en una base PostgreSQL **nueva**. La MySQL local no se toca ni se migra.
- **Estado:** preparado y verificado en simulación local. **El despliegue real no se ha ejecutado ni verificado.**

## 0. Veredicto de la revisión

| Pregunta | Veredicto | Motivo |
|---|---|---|
| ¿Subir a GitHub? | **APTO** | 395 archivos incluidos; ninguno es `.env`, clave, certificado, respaldo ni volcado de base de datos. Las 7 coincidencias del escáner son falsos positivos (ver §7). Sin coautorías de IA |
| ¿Desplegar en Render? | **APTO para una demostración con datos sintéticos**, con las condiciones de §8 | Build limpio y arranque de producción verificados contra PostgreSQL 17 con TLS de verificación completa, sin MySQL ni `.env` |

## 1. Evidencias (2026-11-12)

| Verificación | Resultado |
|---|---|
| Copia limpia con sólo los archivos que Git incluiría + **Build Command exacto** | Salida 0 (`frontend/dist-real` y `backend/dist`, incluido `trust-proxy.mjs`) |
| Typecheck del backend · pruebas seguras · pruebas del frontend | OK · 56/56 · 83/83 |
| **Start Command exacto** contra PostgreSQL 17 temporal con TLS (CA propia y rol mínimo `agro_app`) | **26/26 comprobaciones** |
| …de ellas, base de datos | Esquema de 17 tablas, 10 triggers y 7 CHECK. Una CA ajena es rechazada. Seed creado, idempotente y rechazado sin `--confirmar-host` |
| …de ellas, web | Salud 200. SPA en modo REAL con fallback de rutas. La API devuelve JSON, nunca HTML. CSP sin script en línea y con Google Fonts permitido |
| …de ellas, sesión | Login 200. Cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. Refresh 200. CORS de otro origen → 403 |
| …de ellas, bomba e IoT | Encender → 409 `ENCENDIDO_DESHABILITADO`. IoT sin token → 401. IoT por HTTP → 403 |
| …de ellas, aislamiento | Logs sin secretos. Ningún intento de conexión a MySQL |
| MySQL local | 17/17 tablas idénticas a la línea base del 9 de noviembre (lectura en transacción de solo lectura) |
| Firmware | 31 archivos idénticos a la línea base. `enableAutomaticAtBoot=false` y `manualBenchEnabled=false` con `static_assert` |

**No verificado (requiere los servicios reales):**
- certificado y nombre de host del pooler de Supabase;
- proxy de Render (`TRUST_PROXY`);
- cookies en un móvil real por HTTPS;
- arranque en frío y cuotas reales;
- Node 22, porque se validó Node 24.14.1.

## 2. Supabase — crear la base nueva (navegador)

1. En supabase.com, crea un proyecto nuevo:
   - región: la más cercana a la de Render (p. ej. *East US*);
   - contraseña de base de datos: genera una nueva y guárdala en tu gestor;
   - si aparece la opción **Enable Data API**, desactívala.
2. En **SQL Editor → New query**, ejecuta en este orden:
   1. **Rol de aplicación.** Sustituye el marcador por una contraseña nueva y larga, que no se guarda en el repositorio:
      ```sql
      CREATE ROLE agro_app LOGIN PASSWORD '<contraseña nueva de agro_app>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ```
   2. **Esquema.** Pega el contenido completo de `database/postgres/schema.sql` y ejecútalo. Debe terminar sin errores.
   3. **Permisos mínimos.** Son las 4 líneas comentadas del final del esquema, sin el `-- `:
      ```sql
      GRANT USAGE ON SCHEMA public TO agro_app;
      GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO agro_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agro_app;
      GRANT DELETE ON tokens_refresco, usuario_terreno, cultivos, zonas, terrenos TO agro_app;
      ```
   4. **Cerrar la API pública de Supabase** (decisión D2-03: se recomienda esta opción en lugar de RLS, porque RLS sin políticas también bloquearía a `agro_app`):
      ```sql
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
      ```
   5. **Comprobación**, que debe devolver 17:
      ```sql
      SELECT count(*) FROM information_schema.tables WHERE table_schema='public';
      ```
3. En **Connect → Session pooler**, anota el host (`aws-0-<región>.pooler.supabase.com`), el puerto (5432) y el identificador del proyecto (`<ref>`). La URL de la aplicación usa el usuario `agro_app.<ref>`:
   `postgresql://agro_app.<ref>:<contraseña>@<host-pooler>:5432/postgres`
   No uses el pooler de transacciones (puerto 6543).
4. En **Database → Settings → SSL Configuration**, descarga el certificado (CA). Su contenido PEM será `DB_SSL_CA`.

## 3. Seed de la demostración (una sola vez, desde tu PC)

Render Free no ofrece consola, así que el seed se ejecuta una vez desde tu PC, con las variables **sólo en esa terminal** y sin usar `backend/.env`. El script no lee `.env` ni imprime secretos. PowerShell, desde la raíz del repositorio, después de `npm --prefix backend run build`:

```powershell
$env:NODE_ENV='production'; $env:DB_MOTOR='postgres'; $env:DB_SSL='true'
$env:DATABASE_URL='<URL del session pooler con agro_app>'
$env:DB_SSL_CA=Get-Content -Raw '<ruta del certificado descargado>'
$env:JWT_SECRETO='<el mismo secreto nuevo que pondrás en Render>'
$env:PERMITIR_ENCENDIDO='false'
$env:DEMO_ADMIN_CONTRASENA='<contraseña nueva de 16+ caracteres para entrar a la demo>'
node backend/dist/scripts/seed-demo.js --aplicar --confirmar-host=<host-pooler exacto>
Remove-Item Env:DEMO_ADMIN_CONTRASENA, Env:DATABASE_URL, Env:JWT_SECRETO
```

Salida esperada: «Demo sintética creada». Usuario de la demo: `admin@demo.invalid`. El seed crea un ESP32 ficticio cuyo token no se muestra a nadie, así que ningún equipo físico puede conectarse.

## 4. Render — crear el servicio (navegador)

**New → Web Service → conectar el repositorio de GitHub.**

| Campo | Valor |
|---|---|
| Root Directory | *(vacío: raíz del repositorio)* |
| Runtime | Node |
| Instance Type | **Free** |
| Build Command | `cd frontend && npm ci --include=dev && npm run build:real && cd ../backend && npm ci --include=dev && npm run build` |
| Start Command | `cd backend && npm run start:compiled` |
| Health Check Path | `/api/v1/salud` |
| Auto-Deploy | Off (al principio) |

## 5. Variables de entorno de Render

**Secretas** (escríbelas sólo en el panel de Render):

| Variable | Contenido |
|---|---|
| `DATABASE_URL` | URL del session pooler con `agro_app.<ref>` (§2.3) |
| `DB_SSL_CA` | PEM completo de la CA de Supabase. Se aceptan saltos de línea reales o `\n` |
| `JWT_SECRETO` | Nuevo; no reutilices el local. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |

**No secretas:**

| Variable | Valor |
|---|---|
| `NODE_VERSION` | `24.14.1` (versión validada) |
| `NODE_ENV` | `production` |
| `DB_MOTOR` | `postgres` |
| `DB_SSL` | `true` |
| `HOST` | `0.0.0.0` |
| `SERVIR_FRONTEND` | `../frontend/dist-real` |
| `CORS_ORIGENES` | `https://<nombre-del-servicio>.onrender.com` (exacto, sin barra final) |
| `TRUST_PROXY` | `loopback` hasta medirlo (§6) |
| `PERMITIR_ENCENDIDO` | `false` |
| `ENCENDIDO_MAX_S` | `5` |
| `IOT_PERMITIR_HTTP_LOCAL` | `false` |
| `LIMITES_DESACTIVADOS` | `false` |
| `DIAGNOSTICO_PROXY` | `false` |
| `PG_POOL_MAX` | `5` |
| `PG_CONNECTION_TIMEOUT_MS` | `10000` |
| `PG_STATEMENT_TIMEOUT_MS` | `10000` |
| `PG_LOCK_TIMEOUT_MS` | `5000` |

**No definas `PORT`** (lo pone Render). **No definas `DEMO_ADMIN_CONTRASENA`** en Render.

## 6. Primer despliegue y pruebas de aceptación

1. **Manual Deploy.** En los logs debe aparecer: `postgres PostgreSQL 17… · 17 tablas · 10 triggers · 7 CHECKs` y `Encendido remoto de la bomba: DESHABILITADO`.
2. `https://<servicio>.onrender.com/api/v1/salud` debe responder `"base_datos":"OK"`.
3. Desde el móvil, con datos móviles:
   - abre la URL y verifica que aparece «MODO REAL»;
   - inicia sesión;
   - recarga la página: la sesión debe seguir abierta (cookie de refresco);
   - abre el enlace desde WhatsApp: debe cargar y restaurar la sesión.
4. **Medición del proxy** (procedimiento de `SEGURIDAD_DESPLIEGUE.md` §2.1):
   1. Pon `DIAGNOSTICO_PROXY=true` y `DIAGNOSTICO_PROXY_HASTA=<ahora + 2 h, ISO>`.
   2. Consulta `/api/v1/diagnostico/proxy`.
   3. Fija `TRUST_PROXY=saltos:N`.
   4. Repite la consulta con un `X-Forwarded-For` falsificado.
   5. Vuelve a poner `DIAGNOSTICO_PROXY=false`.
5. Intenta encender la bomba desde el panel: debe aparecer el rechazo `ENCENDIDO_DESHABILITADO`.

## 7. Escáner de secretos — clasificación de las 7 coincidencias

| Archivo:línea | Clasificación |
|---|---|
| `backend/scripts/rotar-jwt.ts:23,31` | Código que **genera** un secreto aleatorio. No contiene ningún valor |
| `documentacion/CONTRATO_API_IOT.md:210` y los 3 contratos de `historial/` | Marcador `agc_dev_` seguido de un único carácter repetido (ejemplo) |
| `auditoria-claude/fase-2/CONTRATOS_TECNICOS_CODEX.md:184` | Descripción de los patrones del escáner |

Además, el escaneo propio de los 395 archivos encontró:
- **Correos:** sólo de ejemplo (`*.local`, `*.invalid`, `ejemplo.com`).
- **IPs:** sólo privadas de laboratorio.
- **Archivos sensibles:** ningún `.env`, `.pem`, `.key`, volcado ni respaldo, y ningún archivo de más de 1 MB.
- **Capturas:** las de `documentacion/evidencias/` muestran datos DEMO.

## 8. Condiciones y pendientes

| # | Pendiente | Gravedad | Resolución |
|---|---|---|---|
| P-1 | Dependencias de ejecución con avisos de seguridad. Altas: express, body-parser, path-to-regexp, mysql2, zod. Moderada: qs. Las críticas (vitest, tinypool) son sólo de desarrollo y no se despliegan | Alta para uso público prolongado; aceptable para una demo corta con datos sintéticos | Tarea separada (Codex): `express@4.22.3`, `mysql2@3.24.6` y nueva regresión con `npm run test:todos`. `zod@4` es un cambio mayor: evaluarlo aparte |
| P-2 | `TRUST_PROXY=loopback` en Render: `req.ip` es la IP del proxy, así que los límites de peticiones se comparten entre todos los usuarios (login 30/min y panel 300/min globales) | Media | Medición §6.4 y `saltos:N` |
| P-3 | CA y host del pooler de Supabase no probados contra el servicio real | Media | Si falla el TLS, el arranque responde salud 503 (falla de forma segura). Revisar la CA descargada |
| P-4 | Node 22 no validado | Baja | Usar `NODE_VERSION=24.14.1` |
| P-5 | El texto de ayuda de la pantalla de integración menciona un túnel a `127.0.0.1:3000` | Baja (cosmética) | Ajuste de texto en una fase posterior |
| P-6 | Retención y purga no implementadas (DELETE en mediciones no autorizado) | Baja | Menos de 100 MB al año. Decidir más adelante |
| P-7 | Supabase pausa el proyecto tras 7 días sin actividad. Render se duerme a los 15 min (arranque en frío de 30–60 s) | Informativa | Abrir la demo unos minutos antes de presentarla |

## 9. Volver atrás

Suspender o borrar el servicio de Render y pausar el proyecto de Supabase. La MySQL local y el modo local (`DB_MOTOR=mysql` por defecto) siguen funcionando sin cambios.
