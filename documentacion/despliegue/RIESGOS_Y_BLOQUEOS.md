# Riesgos y bloqueos — despliegue AgroControl-IoT

**Última actualización:** 2026-11-07 00:25, tras la auditoría final de los cambios de Codex.

## Estado de los bloqueos de la auditoría inicial

| ID | Bloqueo original | Estado | Comentario |
|---|---|---|---|
| B-01 | `HOST` sólo loopback | ✅ Resuelto | Acepta `0.0.0.0` y `::`; por defecto `127.0.0.1`. |
| B-02 | Puerto sin `PORT` | ✅ Resuelto | `PORT` tiene prioridad sobre `PUERTO`. |
| B-03 | `trust proxy` fijo | ⚠ Resuelto en código, **pendiente de configurar** | `TRUST_PROXY` acepta IP/CIDR/nombres (`loopback`, `uniquelocal`). Falta el valor real del proveedor. |
| B-04 | Arranque con `tsx` | ✅ Resuelto | `npm run build` + `npm run start:compiled`. |
| B-05 | Vercel compilaría DEMO | ✅ Resuelto | `vercel.json` fija `build:real`/`dist-real`; además `vite build` en modo production ahora es REAL. |
| B-06 | Cookie `Strict` entre dominios | ⚠ Resuelto en diseño | Proxy `/api` en `vercel.json`, pero con dominio de marcador (BL-A). |
| B-07 | Sin `.gitignore` raíz / `test2026` | ✅ Resuelto | Verificado con `git check-ignore`. |
| H-01 | Sin TLS a MySQL | ✅ Resuelto | `DB_SSL`, `DB_SSL_CA`, `rejectUnauthorized: true`, timeout de 10 s. |

## Bloqueos activos

| ID | Bloqueo | Afecta | Responsable |
|---|---|---|---|
| BL-A | `frontend/vercel.json` reenvía `/api` a `https://api.agrocontrol.example` (marcador; `.example` no resuelve). Un despliegue ahora publicaría una UI sin backend. No hay chequeo que lo impida | Producción | Usuario (dominio) + Codex (guard de build) |
| BL-B | No hay proveedor de backend/MySQL elegido ni creado | Producción | Usuario |
| BL-C | `TRUST_PROXY` real desconocido. Con `loopback` (valor de la plantilla) el ESP32 recibe 403 `HTTPS_REQUERIDO`. Un valor como `1` se acepta sin error y produce el mismo fallo | Producción / ESP32 | Codex (validación) + medición en el proveedor |
| BL-D | Esquema, administrador y token del ESP32 no creados en la base remota | Producción | Usuario, con guía |
| BL-E | Sin evidencia E2E: login, refresh, recarga, móvil, `/api` inexistente | Producción | Usuario + Claude |
| BL-F | ESP32: CA del dominio final, aprovisionamiento y validación física | IoT en producción | Usuario (hardware) |
| BL-G | Repo local con `origin` configurado y 0 commits; visibilidad del remoto sin verificar | GitHub | Usuario |

## Riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación / estado |
|---|---|---|---|---|
| R-01 | Fecha límite 07:00 | Alta | Alto | Sólo camino crítico; contingencia: PC + Cloudflare Tunnel (`GUIA_ARRANQUE.md`). |
| R-02 | `TRUST_PROXY` mal configurado ⇒ `/iot` 403 o IP de cliente falsa | **Alta** | Alto | Validar valores en `config.ts` (rechazar números/valores no-IP); medir con prueba de humo antes del ESP32. |
| R-03 | Seed/importación sobre la base local por error | Media | Alto | `DOTENV_CONFIG_PATH` + host explícito + `--simular`; T-07 (`--confirmar-host`) sin implementar. |
| R-04 | Publicar DEMO | Baja | Alto | Mitigado: `build:real` y modo production = REAL; bundle verificado. |
| R-05 | Secretos en GitHub | Baja | Crítico | Escaneo limpio de los 317 candidatos. Repetir escaneo de lo preparado justo antes del primer commit. |
| R-06 | Despliegue con proxy `/api` de marcador | **Alta** si se despliega ya | Alto | BL-A: reemplazar dominio + guard que falle si `VERCEL=1` y queda `.example`. |
| R-07 | Rate limit de login compartido: tras Vercel, `req.ip` es la IP de salida de Vercel si sólo se confía en el proxy del proveedor ⇒ 5 intentos/min para todos | Media | Medio | Decidir si se confía en los rangos de Vercel o se usa una clave por usuario/email para `/auth/login`. |
| R-08 | Plantilla `.env.production.example` no llega a GitHub (ignorada por `backend/.gitignore`) | Alta | Bajo | Añadir `!.env.production.example` en `backend/.gitignore`. |
| R-09 | Documentación contradice el build (README: `build` = DEMO) | Alta | Bajo | Actualizar README y comentario de `fuente.ts`. |
| R-10 | `PERMITIR_ENCENDIDO=true` podría ponerse por error en el panel del proveedor | Baja | Crítico | Seis barreras del firmware siguen en `false` (bloqueo físico independiente). Opcional: rechazar `true` en producción salvo con una segunda variable de confirmación. |
| R-11 | Relé con interfaz eléctrica no validada | Media | **Crítico** | Bomba sin alimentación durante pruebas y demostración. |
| R-12 | CA del ESP32 rotada por el proveedor | Media | Medio | Paquete con 2 raíces. |
| R-13 | Datos personales menores en repo público: usuario de Windows en rutas (`GUIA_ARRANQUE.md`, `verificar-medidor.cjs`), IP LAN privadas en `COORDINACION_FRONTEND_BACKEND.md` | Alta | Bajo | No son secretos. Opcional: sustituirlas por marcadores antes de publicar. |
| R-14 | `.gitignore` sin `coverage/`, `*.sqlite`, `*.db`, `Thumbs.db`, `.DS_Store`, `*.tmp`, `*.sql` de volcados | Baja (ninguno existe hoy) | Medio | Añadirlos antes de que aparezcan. |

## Decisiones que requieren al usuario

1. Elegir el proveedor (recomendado: Railway, backend y MySQL juntos) y autorizar la creación de recursos.
2. Confirmar si GitHub será **público** o privado.
3. Quién hace el primer commit/push, y cuándo.
4. Confirmar que la bomba permanecerá sin alimentación.
