# Tareas para Codex — despliegue de AgroControl-IoT

Coordinador: Claude · Implementador: Codex · Referencias: `AUDITORIA_PRODUCCION.md`, `PLAN_DESPLIEGUE.md`.

## Reglas obligatorias para todas las tareas

1. **No** hacer commits, push, `git init` con remoto, ni crear servicios externos.
2. **No** modificar `backend/.env`, ni la base MySQL local `agrocontrol` (las pruebas usan `npm test`, que levanta un MySQL temporal).
3. **No** cambiar `PERMITIR_ENCENDIDO` (debe seguir `false`) ni ninguna barrera de `firmware-esp32/AgroControl/Settings.h`.
4. **No** escribir secretos en archivos versionables. Los valores van en el panel del proveedor.
5. Mantener intacto el comportamiento de desarrollo (`npm run dev`, `dev:real`, `dev:movil`, túnel local). Todo lo nuevo debe ser **opt-in por variable de entorno**.
6. Al terminar cada tarea, entregar evidencia: comandos ejecutados + salida (pruebas, typecheck) en `documentacion/despliegue/evidencias/T-XX.md`.

---

## P0 — bloquean el despliegue

### T-01 · `.gitignore` raíz e higiene del repositorio
**Problema:** sin `.gitignore` raíz; `test2026/` es otro repo Git con `node_modules` y videos (B-07).
**Hacer:** crear `/.gitignore` que excluya al menos: `node_modules/`, `dist/`, `dist-real/`, `build/`, `coverage/`, `.env`, `.env.*` (con `!.env.example` y `!.env.produccion.example`), `*.tsbuildinfo`, `__pycache__/`, `test2026/`, `firmware-esp32/**/secrets.h`, `firmware-esp32/build/`, `playwright-report/`, `test-results/`, `.vercel/`, `*.log`.
**Aceptación (verificable sin remoto):**
- En una copia temporal (`git init` en el **scratchpad**, nunca en el proyecto) o con `git init` local sin remoto **sólo si el usuario lo autoriza**, `git add -n .` no lista `.env`, `test2026/`, `node_modules/`, `build/`, `dist*/`, `*.pyc`.
- `git check-ignore backend/.env` devuelve la ruta.
- Informe con el tamaño total de lo que se versionaría.

### T-02 · Backend listo para PaaS (HOST, PORT, trust proxy)
**Problema:** B-01, B-02, B-03.
**Hacer en `backend/src/config.ts` y `backend/src/app.ts`:**
- `HOST`: aceptar además `0.0.0.0` y `::`. Valor por defecto sigue `127.0.0.1`.
- Puerto: `PUERTO` y, si no existe, `PORT` (la plataforma lo inyecta).
- Nueva variable `CONFIAR_PROXY` (por defecto `loopback`, comportamiento actual). Valores admitidos: `loopback` o un entero 1–3 (número de saltos). Pasarla a `app.set('trust proxy', …)`.
- En `NODE_ENV=production`: exigir que todos los `CORS_ORIGENES` sean `https:`; registrar al arrancar `HOST`, puerto y `CONFIAR_PROXY` (sin secretos).
**Aceptación:**
- `npm test` del backend: 53 pruebas previas + nuevas, todas en verde.
- Pruebas nuevas: (a) con `CONFIAR_PROXY=1` y `X-Forwarded-Proto: https`, `/api/v1/iot/...` **no** devuelve `HTTPS_REQUERIDO`; (b) con el valor por defecto, una solicitud con `X-Forwarded-Proto: https` desde IP no-loopback sigue rechazada; (c) `HOST=0.0.0.0` es válido; (d) `PORT` se usa cuando falta `PUERTO`; (e) en producción un origen `http://` es rechazado por la configuración.
- `npx tsc --noEmit` sin errores.

### T-03 · Arranque de producción compilado
**Problema:** B-04.
**Hacer:** en `backend/package.json` añadir `"start:prod": "node dist/src/server.js"` y `"engines": { "node": ">=20" }`. Verificar que `npm run build` compila `src` y `scripts` sin depender de `tsx` en tiempo de ejecución, y que `dotenv/config` no falla si no existe `.env` (en la nube no habrá archivo).
**Aceptación:** `npm run build` OK; `node dist/src/server.js` arranca contra el **MySQL temporal de pruebas** (o contra la base local sólo en lectura del esquema; anotar cuál) y `GET /api/v1/salud` → 200. Evidencia en T-03.md.

### T-04 · Frontend: `vercel.json` y compilación REAL obligatoria
**Problema:** B-05, B-06.
**Hacer:** crear `frontend/vercel.json`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "installCommand": "npm ci",
  "buildCommand": "npm run build:real",
  "outputDirectory": "dist-real",
  "rewrites": [{ "source": "/api/:path*", "destination": "https://BACKEND_DOMINIO_PENDIENTE/api/:path*" }]
}
```
- Dejar `BACKEND_DOMINIO_PENDIENTE` como marcador explícito (se rellena tras crear el backend; el dominio no es secreto).
- Añadir un chequeo en `build:real` (script Node pequeño en `frontend/scripts/`) que **falle** si en `dist-real/assets/*.js` aparece `SimuladorDemo` y que falle si `vercel.json` aún contiene `BACKEND_DOMINIO_PENDIENTE` cuando `VERCEL=1`.
**Aceptación:** `npm run build:real` OK; el chequeo pasa; `npm test` 83/83; `npm run dev` sigue en DEMO y `npm run dev:real` en REAL.

### T-05 · Configuración del servicio backend (Railway)
**Hacer:** `backend/railway.json` (o `nixpacks.toml`) con: build `npm ci && npm run build`, start `npm run start:prod`, healthcheck `/api/v1/salud`, 1 réplica, reinicio `ON_FAILURE`. Crear `backend/.env.produccion.example` **sin valores reales** con: `NODE_ENV=production`, `HOST=0.0.0.0`, `CONFIAR_PROXY=2`, `CORS_ORIGENES=https://<proyecto>.vercel.app`, `DB_HOST`, `DB_PUERTO`, `DB_USUARIO`, `DB_CONTRASENA`, `DB_NOMBRE=agrocontrol`, `JWT_SECRETO=<generar>`, `PERMITIR_ENCENDIDO=false`, `ENCENDIDO_MAX_S=5`, `IOT_PERMITIR_HTTP_LOCAL=false`.
**Aceptación:** revisión del coordinador; ningún valor real; `PERMITIR_ENCENDIDO=false` presente.

> **Nota de saltos de proxy:** el tráfico web llega Vercel → Railway → app; el del ESP32 llega Railway → app. Codex debe **medir** (con una ruta temporal de diagnóstico en una prueba, no en producción) qué valor de `CONFIAR_PROXY` hace que `req.ip` sea la IP del cliente en ambos casos, y documentarlo. Si no hay un único valor correcto, proponer clave de rate‑limit basada en el **primer** IP de `X-Forwarded-For` sólo para `/auth/login`.

---

## P1 — necesarias para operar con seguridad

### T-06 · TLS opcional hacia MySQL
`DB_SSL=true|false` (por defecto `false`) y `DB_SSL_CA` opcional (PEM en variable). Pasar `ssl: { rejectUnauthorized: true, ca? }` a `mysql.createPool`. **Aceptación:** pruebas en verde; con `DB_SSL=false` el comportamiento es idéntico al actual.

### T-07 · Salvaguardas para scripts contra la base remota
`seed.ts`, `rotar-token.ts`, `cambiar-contrasena.ts`: imprimir **host:puerto/base** destino y exigir `--confirmar-host <host>` cuando `DB_HOST` no es loopback. Documentar uso con `DOTENV_CONFIG_PATH=.env.produccion` (variable nativa de `dotenv/config`). **Aceptación:** sin el flag, el script aborta sin escribir; con `--simular` nunca escribe.

### T-08 · Prueba de humo de producción
`backend/scripts/prueba-produccion.mjs <URL_BASE>` (sólo lectura): `GET /api/v1/salud` = 200 y `base_datos=OK`; `POST /auth/login` con credenciales falsas = 401; `POST /api/v1/iot/telemetria` sin token = 401 (no 403 `HTTPS_REQUERIDO`); `OPTIONS` con `Origin` ajeno = 403. Opcional con credenciales por variable de entorno: login real y verificar que el panel informa `permitir_encendido:false`. **Nunca** crear órdenes de encendido. **Aceptación:** el script corre contra el backend local y devuelve un resumen PASA/FALLA.

### T-09 · Procedimiento de CA para el ESP32
Script `firmware-esp32/obtener-ca.ps1` (o `.py`) que, dado un dominio, muestre la cadena con `openssl s_client -showcerts`, identifique la **raíz** y arme un paquete PEM (raíz actual + raíz alternativa del mismo proveedor), comprobando ≤ 8192 bytes. Documentar el aprovisionamiento con `ProvisionWifi` (URL `https://<backend>/api/v1`, token, CA). **No** tocar `Settings.h`. **Aceptación:** paquete generado para el dominio real y tamaño reportado.

## P2 — calidad

### T-10 · Mensajes de producción en la UI REAL
Sustituir los textos de desarrollo (`api.ts:63,164`, `Login.tsx:136`) por mensajes para el usuario final cuando `import.meta.env.PROD`. **Aceptación:** 83/83 + pruebas de texto actualizadas.

### T-11 · Cabeceras de seguridad en Vercel
Añadir en `vercel.json` `headers` con `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y una CSP compatible con Google Fonts. **Aceptación:** la app carga sin errores CSP en consola (escritorio y móvil).

### T-12 · Documentación de operación
`documentacion/despliegue/OPERACION.md`: variables, rotación de `JWT_SECRETO` y token del ESP32, respaldos de MySQL en Railway, cómo leer logs `[iot]`.

---

## Orden de ejecución y dependencias

```
T-01 ─┐
T-02 ─┼─► T-05 ─► (usuario crea Railway + MySQL) ─► T-08 contra producción
T-03 ─┘                                   │
T-04 ─────────────► (usuario crea Vercel, rellena dominio) ─► prueba E2E
T-06, T-07 en paralelo; T-09 cuando exista el dominio del backend.
```
