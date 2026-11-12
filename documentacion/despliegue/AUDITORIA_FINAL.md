# Auditoría final de los cambios de Codex

- **Fecha:** 2026-11-07 00:20–00:25 · **Auditor:** Claude · Modo: sin commits, push, despliegues ni cambios en la base de datos.
- **Fuentes:** `RESULTADOS_CODEX.md`, `GUIA_PRODUCCION.md` y el estado actual de los archivos.

## 1. Archivos modificados por Codex

| Archivo | Cambio | Veredicto |
|---|---|---|
| `/.gitignore` (nuevo) | Excluye entornos, claves, builds, dependencias, reportes y `/test2026/` | ✅ (observaciones R-08, R-14) |
| `backend/src/config.ts` | `HOST` +`0.0.0.0`/`::`; `PORT`>`PUERTO`; `TRUST_PROXY`; `DB_SSL`/`DB_SSL_CA`; en producción fuerza `IOT_PERMITIR_HTTP_LOCAL=false` y `LIMITES_DESACTIVADOS=false` | ✅ con observación: `TRUST_PROXY` sin validar formato |
| `backend/src/app.ts` | `trust proxy` ← `TRUST_PROXY` | ✅ |
| `backend/src/db.ts` | TLS opcional con `rejectUnauthorized: true`; `connectTimeout` de 10 s | ✅ |
| `backend/.env.production.example` (nuevo) | Plantilla sin secretos, `PERMITIR_ENCENDIDO=false` | ✅ contenido / ⚠ no se versiona |
| `backend/scripts/comprobar-config-produccion.mjs` (nuevo) | Prueba de configuración sin BD | ✅ PASS |
| `backend/scripts/pruebas-con-bd-temporal.mjs` | Fija `DB_SSL=false` y `TRUST_PROXY=loopback` | ✅ |
| `frontend/vite.config.ts` | Modo `production` ⇒ REAL | ✅ (documentación desactualizada) |
| `frontend/vercel.json` (nuevo) | `build:real`, `dist-real`, proxy `/api`, fallback SPA | ❌ destino de marcador |

No cambiaron: módulos `auth`, `iot`, `panel`, `servicio`, `cors`, `seguridad`; `Settings.h` ni el resto del firmware; `schema.sql`.

## 2. Verificación reproducida por Claude

Codex no pudo ejecutar las pruebas (EPERM). Claude las ejecutó:

| Comando | Resultado |
|---|---|
| `backend: npm run typecheck` / `npm run build` | OK / OK |
| `backend: node scripts/comprobar-config-produccion.mjs` | PASS |
| `backend: npm test` (MySQL temporal aislado) | **53/53** |
| `frontend: npx vitest run` | **83/83** |
| `frontend: npm run build:real` | OK; 0 `SimuladorDemo`; contiene “MODO REAL” |
| Prueba de `TRUST_PROXY` sobre `crearApp()` | `true` y `0.0.0.0/0` dan error (bien); `uniquelocal` y CIDR funcionan; **`1` se acepta y no confía en nadie** (a corregir) |

## 3. Los 6 puntos pedidos

| Punto | Estado |
|---|---|
| HOST | ✅ |
| PORT | ✅ |
| TRUST_PROXY | ⚠ implementado; falta validar el formato y el valor real del proveedor |
| TLS MySQL | ✅ |
| Vercel `build:real` | ✅ verificado |
| Proxy `/api` | ❌ apunta a `https://api.agrocontrol.example` |

## 4. Correcciones pedidas a Codex (pequeñas, sin infraestructura)

1. **T-13 (P0):** guard de build: si `VERCEL=1` y `vercel.json` contiene `.example`, que el build falle.
2. **T-14 (P1):** validar `TRUST_PROXY` en `config.ts`: aceptar sólo `loopback`, `linklocal`, `uniquelocal`, IP o CIDR válidos; rechazar números, `true` y `0.0.0.0/0`, con una prueba unitaria.
3. **T-15 (P2):** `backend/.gitignore`: añadir `!.env.production.example`. `.gitignore` raíz: `coverage/`, `*.sqlite`, `*.db`, `Thumbs.db`, `.DS_Store`, `*.tmp`.
4. **T-16 (P2):** README y comentario de `fuente.ts`: `npm run build` ahora genera REAL.
5. **T-08 / T-07 (P1):** prueba de humo de producción y `--confirmar-host` (siguen pendientes).

## 5. Conclusiones

### A. GitHub público: **APTO, con condiciones**

No hay secretos en los 317 archivos candidatos. `.env`, claves del fixture TLS, builds y `test2026/` están excluidos. El firmware no contiene credenciales Wi-Fi ni API: todo se aprovisiona en NVS. Condiciones:

1. Repetir el escaneo sobre lo preparado (`git diff --cached`) justo antes del primer commit.
2. Decidir si se aceptan los datos personales menores: usuario de Windows en rutas e IP LAN privadas (R-13). No son secretos.
3. Recomendado, no bloqueante: T-15, para que la plantilla de producción quede publicada y los ignores sean más completos.
4. Sólo se revisaron a mano 2 de las 162 capturas PNG. Si el repo será público, hay que hojearlas.

### B. Producción: **NO APTO**

Falta:

1. **Dominio real del backend** en `frontend/vercel.json`, más el guard T-13.
2. **Proveedor elegido y creado** (backend persistente + MySQL ≥ 8.0.16 con triggers), con autorización del usuario.
3. **`TRUST_PROXY` real** medido en el proveedor y T-14. Sin esto el ESP32 recibe 403.
4. **Variables de producción** en el panel: `JWT_SECRETO` nuevo, `CORS_ORIGENES` exacto, `DB_*`, `DB_SSL` y `PERMITIR_ENCENDIDO=false`.
5. **Esquema importado** en la base nueva, más administrador y token del ESP32.
6. **Evidencia E2E** (checklist C1–C7): login, refresh, recarga, celular con datos móviles y encendido rechazado.
7. **ESP32**: CA, aprovisionamiento y telemetría en producción (D1–D5), con la bomba sin alimentación (D6).
