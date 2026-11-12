# Plan de despliegue — AgroControl-IoT

- **Fecha límite:** 2026-11-07 07:00 (hora de Guatemala). Inicio del plan: ~00:30.
- **Arquitectura objetivo:**

```
Celular / PC ──HTTPS──► Vercel (frontend REAL, dist-real)
                           │ rewrite /api/* (mismo origen → cookies OK)
                           ▼
                 Railway: servicio backend (Node, 0.0.0.0:$PORT, 1 réplica, siempre encendido)
                           │ red privada
                           ▼
                 Railway: MySQL 8 (base `agrocontrol`, 17 tablas + 2 triggers + 7 CHECK)
ESP32 ──HTTPS directo (CA fijada)──► Railway backend /api/v1/iot
```

**Decisión:** Railway para backend + MySQL (sin suspensión, MySQL completo con triggers, un solo proveedor). El ESP32 habla **directo** con Railway (no a través de Vercel). Plan B si Railway no es viable: Render Starter + Aiven MySQL (requiere T-06). Contingencia: PC + Cloudflare Tunnel (ya documentado en `GUIA_ARRANQUE.md`).

## Fases y horario orientativo

| Hora | Fase | Quién | Entregable / salida |
|---|---|---|---|
| 00:30–02:00 | P0 código: T-01, T-02, T-03, T-04, T-05 | Codex | Pruebas en verde + evidencias |
| 01:00–01:30 | Crear repo GitHub **privado**; crear cuenta/proyecto Railway | Usuario | URL del repo; proyecto vacío |
| 02:00–02:20 | Auditoría de los cambios P0 (secretos, DEMO, base local) | Claude | Visto bueno o correcciones |
| 02:20–02:40 | Primer commit y push (usuario o autorizado explícitamente) | Usuario | Rama `main` en GitHub |
| 02:40–03:30 | Railway: MySQL + backend, variables, importar esquema, seed | Usuario (+ guía) | `/api/v1/salud` = 200 público |
| 03:30–04:00 | Vercel: importar `frontend/`, rellenar dominio del backend, desplegar | Usuario + Codex (T-04) | URL vercel.app en MODO REAL |
| 04:00–04:30 | Prueba de humo T-08 + login desde PC y celular (datos móviles) | Usuario + Claude | Evidencia capturas |
| 04:30–05:30 | ESP32: CA (T-09), aprovisionar URL/token/CA, ver telemetría | Usuario (hardware) | Serial `api GET /salud HTTP=200`, lecturas en el panel |
| 05:30–06:30 | P1/P2 restantes si hay tiempo; checklist final | Codex + Claude | `CHECKLIST_FINAL.md` completo |
| 06:30–07:00 | Congelamiento. Sólo correcciones críticas. | Todos | — |

## Prioridades

- **P0 (sin esto no hay producción):** T-01 a T-05, infraestructura (GitHub, Railway, Vercel), esquema + seed remotos.
- **P1 (operar con seguridad):** T-06 a T-09, ESP32 conectado a producción.
- **P2 (calidad):** T-10 a T-12.

## Variables de producción (valores SÓLO en el panel de Railway)

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | inyectada por Railway |
| `CONFIAR_PROXY` | según medición de T-05 (esperado `1` o `2`) |
| `CORS_ORIGENES` | `https://<proyecto>.vercel.app` |
| `DB_HOST` / `DB_PUERTO` / `DB_USUARIO` / `DB_CONTRASENA` | referencias a las variables del servicio MySQL de Railway (red privada) |
| `DB_NOMBRE` | `agrocontrol` |
| `JWT_SECRETO` | nuevo, ≥48 bytes aleatorios; **distinto** del local |
| `PERMITIR_ENCENDIDO` | `false` |
| `ENCENDIDO_MAX_S` | `5` |
| `IOT_PERMITIR_HTTP_LOCAL` | `false` |

## Procedimiento de base de datos remota (no destructivo)

1. En Railway, servicio MySQL → habilitar acceso TCP público temporal (proxy) sólo para la importación.
2. `CREATE DATABASE agrocontrol CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;` (con el cliente MySQL local apuntando al host **remoto**).
3. `powershell -ExecutionPolicy Bypass -File database\importar-esquema.ps1 -Servidor <host-remoto> -Puerto <puerto-remoto> -Usuario root` (pide la contraseña en forma segura; el script rechaza DROP/TRUNCATE).
4. `-SoloComprobar` para verificar 17 tablas / 2 triggers.
5. Seed con archivo separado: `$env:DOTENV_CONFIG_PATH=".env.produccion"; npm run db:seed -- --simular` → revisar el **host destino** impreso → `npm run db:seed` (tras T-07 con `--confirmar-host`). Guardar el token del ESP32 en un gestor de contraseñas.
6. Quitar `$env:DOTENV_CONFIG_PATH` y desactivar el acceso público de MySQL si no se necesita.

La base local **nunca** se toca: todos los comandos remotos llevan host/puerto explícitos o `DOTENV_CONFIG_PATH`.

## Criterio de “en producción”

Se considera desplegado sólo cuando **todas** las casillas P0 de `CHECKLIST_FINAL.md` tengan evidencia (captura, salida de comando o log).
