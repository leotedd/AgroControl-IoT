# Checklist final — AgroControl-IoT en producción

Marcar sólo con **evidencia**. Sin evidencia = no hecho.
**Última actualización:** 2026-11-07 00:25 — auditoría final de los cambios de Codex (Claude). Ver `AUDITORIA_FINAL.md`.

Leyenda: ✅ verificado con evidencia · ⚠ hecho con observaciones · ☐ pendiente · ❌ falla

## A. Código

| # | P | Verificación | Evidencia | Estado |
|---|---|---|---|---|
| A1 | P0 | `.gitignore` raíz; candidatos sin `.env`, `test2026/`, `node_modules/`, `build/`, `dist*/` | `git ls-files --others --exclude-standard` → 317 archivos (~20 MB, 162 PNG de evidencias). `git check-ignore`: `backend/.env`, `test2026/`, `frontend/dist-real/`, `backend/dist/`, `firmware-esp32/build/`, `tests/firmware/build/fixture/*.pem` ignorados | ✅ |
| A1b | P2 | Plantilla `backend/.env.production.example` versionada | **No**: la ignora `backend/.gitignore:4` (`.env.*`), que prevalece sobre la excepción de la raíz | ⚠ |
| A2 | P0 | Backend: pruebas y typecheck | `npm test` → **53/53** (MySQL temporal aislado, apagado y borrado al final); `npm run typecheck` OK; `npm run build` OK — ejecutado por Claude 00:22 | ✅ |
| A3 | P0 | Frontend: pruebas y typecheck | `npx vitest run` → **83/83**; typecheck incluido en `build:real` OK — Claude 00:23 | ✅ |
| A4 | P0 | `HOST` 0.0.0.0/::, `PORT` > `PUERTO`, `TRUST_PROXY` configurable | `config.ts:10-12,41`; `app.ts:32`; `comprobar-config-produccion.mjs` → PASS | ⚠ ver A4b |
| A4b | P1 | `TRUST_PROXY` rechaza valores inválidos | `true` y `0.0.0.0/0` → error al arrancar (bien). **`1` se acepta en silencio y no confía en nadie** ⇒ `/iot` respondería 403 sin aviso | ⚠ |
| A5 | P0 | Arranque compilado sin `tsx` | `npm run build` OK; script `start:compiled` = `node dist/src/server.js`. Arranque real con BD no probado | ⚠ |
| A6 | P0 | `frontend/vercel.json`: `build:real`, `dist-real`, proxy `/api` | Presente. **El destino es el marcador `https://api.agrocontrol.example`** y nada impide desplegar con él | ❌ |
| A7 | P0 | Bundle REAL sin simulador | `npm run build:real` (00:23): 0 apariciones de `SimuladorDemo`; contiene “MODO REAL” | ✅ |
| A8 | P0 | Ningún secreto en archivos versionables | Búsqueda en los 317 candidatos: tokens `agc_dev_` de 43 caracteres, claves privadas, JWT, contraseñas asignadas, tokens de GitHub/API. Sólo un valor de prueba ficticio en `backend/tests/integracion.test.ts:21`. 2 de 162 PNG revisados a mano, sin datos sensibles | ✅ |
| A9 | P0 | Bomba no habilitable por configuración | `PERMITIR_ENCENDIDO` por defecto `false`; `.env` local y la plantilla de producción en `false`; `Settings.h` sin cambios desde 2026-10-16 (6 barreras `false`); módulos `iot/servicio/panel` sin cambios | ✅ |
| A10 | P0 | Base local `agrocontrol` intacta | Codex declara no haber hecho migraciones ni seed; las pruebas de Claude usaron un MySQL temporal. Los scripts que tocan BD no se modificaron | ✅ |
| A11 | P1 | Prueba de humo de producción (T-08) | No implementada | ☐ |
| A12 | P1 | Salvaguarda `--confirmar-host` en seed/rotación (T-07) | No implementada (la guía lo cubre por procedimiento) | ☐ |
| A13 | P2 | Documentación coherente | README/`fuente.ts` dicen “`npm run build` → DEMO”; ahora `vite build` (modo production) genera **REAL** | ⚠ |

## B. Infraestructura (usuario)

| # | P | Verificación | Evidencia | Estado |
|---|---|---|---|---|
| B1 | P0 | Repo GitHub creado; `main` subido | `.git` local creado 00:17 con `origin` = repo de GitHub del usuario; **0 commits**. Visibilidad del repo remoto sin verificar | ☐ |
| B2 | P0 | Proveedor de backend y MySQL elegido y creado | Sin decisión ni recursos | ☐ |
| B3 | P0 | Esquema importado en la base nueva (17 tablas / 2 triggers / 7 CHECK) | — | ☐ |
| B4 | P0 | `https://<backend>/api/v1/salud` → 200 | — | ☐ |
| B5 | P0 | `TRUST_PROXY` con IP/CIDR reales del proveedor, medido | — | ☐ |
| B6 | P0 | Seed remoto, token ESP32 guardado fuera del repo | — | ☐ |
| B7 | P0 | Vercel: root `frontend`, dominio del backend en `vercel.json`, desplegado | — | ☐ |
| B8 | P0 | `CORS_ORIGENES` = origen exacto de Vercel de producción | — | ☐ |

## C. Funcional (pendiente: depende de B)

| # | P | Verificación | Estado |
|---|---|---|---|
| C1 | P0 | PC: login en Vercel, UI con “MODO REAL” | ☐ |
| C2 | P0 | Celular con datos móviles: login y panel; 375/390/768 px | ☐ |
| C3 | P0 | Recarga conserva la sesión (cookie `agc_refresh` en el dominio de Vercel, `Path=/api/v1/auth`) | ☐ |
| C4 | P0 | Encender bomba → `ENCENDIDO_DESHABILITADO` | ☐ |
| C5 | P1 | `/api/inexistente` devuelve JSON de la API, no `index.html` | ☐ |
| C6 | P1 | Rate limit de login no compartido entre usuarios detrás de Vercel | ☐ |
| C7 | P0 | Funciona con la PC del usuario apagada | ☐ |

## D. ESP32 físico

| # | P | Verificación | Estado |
|---|---|---|---|
| D1 | P1 | CA del dominio final, ≤ 8192 bytes | ☐ |
| D2 | P1 | NVS aprovisionado (URL `https://<backend>/api/v1`, token, CA) | ☐ |
| D3 | P1 | Serial `api GET /salud HTTP=200`, estado `CONECTADO` | ☐ |
| D4 | P1 | Humedad visible en el panel de producción | ☐ |
| D5 | P1 | Desconexión → alerta a ~2 min; reconexión la resuelve | ☐ |
| D6 | P0 | Bomba **sin alimentación** en todas las pruebas | ☐ |

## E. Cierre

| # | Verificación | Estado |
|---|---|---|
| E1 | Respaldo (`mysqldump`) de la base remota fuera del repo | ☐ |
| E2 | Acceso público a MySQL deshabilitado o restringido | ☐ |
| E3 | Documentación de operación | ⚠ `GUIA_PRODUCCION.md` existe; falta procedimiento específico del proveedor |
