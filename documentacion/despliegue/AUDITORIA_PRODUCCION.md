# Auditoría de producción — AgroControl-IoT

- **Fecha:** 2026-11-07, 00:15–00:30 (hora local del equipo)
- **Modo:** sólo lectura. No se modificó código fuente, `.env`, base de datos ni firmware.
- **Auditor:** Claude (arquitecto/coordinador). Implementador: Codex.

## 0. Evidencia verificada en esta auditoría

| Comprobación | Resultado | Cómo |
|---|---|---|
| TypeScript backend | ✅ sin errores | `cd backend; npx tsc --noEmit` |
| TypeScript frontend | ✅ sin errores | `cd frontend; npx tsc --noEmit` |
| Pruebas frontend | ✅ 83/83 (7 archivos) | `cd frontend; npx vitest run` |
| Pruebas backend | ⏸ no re-ejecutadas (53/53 según el usuario) | levantan un MySQL temporal; no hacía falta para la auditoría |
| Build REAL sin simulador | ✅ `dist-real` no contiene `SimuladorDemo` | `grep` sobre `frontend/dist-real/assets/*.js` |
| Secretos en archivos versionables | ✅ ninguno encontrado | búsqueda de `agc_dev_…` reales, claves privadas, `.env` |
| `backend/.env` ignorado | ✅ por `backend/.gitignore` | — |
| Repositorio Git | ❌ la raíz **no** es un repositorio y **no tiene `.gitignore`** | — |

## 1. Arquitectura real

```
Navegador (PC / celular)
   │  HTTPS, mismo origen, /api/v1/* relativo (credentials: same-origin)
   ▼
Frontend React 18 + Vite 6 (modo fijado en compilación: DEMO o REAL)
   │  en desarrollo: proxy de Vite → http://127.0.0.1:3000
   ▼
Backend Express 4 + TypeScript (tsx) — escucha SÓLO en loopback
   │  mysql2 pool (10 conexiones, UTC)        │ tareas en proceso (setInterval 5 s / 30 s)
   ▼                                           ▼
MySQL 8 local, base `agrocontrol` (17 tablas, 2 triggers, 7 CHECK)

ESP32 ──HTTPS (CA fijada en NVS, URL https://…/api/v1, token Bearer agc_dev_…)──► túnel (Cloudflare/ngrok) ──► backend loopback
```

- **Frontend ↔ Backend:** rutas relativas `/api/v1`; JWT de acceso (15 min) en memoria + cookie de refresco `agc_refresh` (HttpOnly, Secure, **SameSite=Strict**, path `/api/v1/auth`, 7 días, rotación con detección de reutilización).
- **Backend ↔ MySQL:** pool mysql2, sin opción TLS. Al arrancar verifica tablas, triggers y CHECKs; si falta algo, **no arranca**.
- **ESP32 ↔ Backend:** cliente HTTP/1.1 propio sobre `NetworkClientSecure` con `setCACert` (CA en NVS), valida fechas del certificado, exige `hora_servidor` a ±30 s. `/api/v1/iot/*` exige `req.secure` (HTTPS) salvo excepción de simulador local.
- **Diseño actual = PC del usuario + túnel.** Todo el endurecimiento (HOST loopback, `trust proxy: loopback`) asume ese diseño. Es correcto para él, pero **bloquea** un despliegue en PaaS.

## 2. Bloqueos para producción (P0)

| ID | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| B-01 | `HOST` sólo acepta `127.0.0.1`, `::1`, `localhost` | `backend/src/config.ts:9` (`z.enum`) | En un contenedor PaaS el backend no es alcanzable (debe escuchar en `0.0.0.0`). |
| B-02 | Puerto sólo desde `PUERTO`; las plataformas inyectan `PORT` | `backend/src/config.ts:8` | El servicio escucha en un puerto distinto al que enruta la plataforma. |
| B-03 | `trust proxy` fijo en `'loopback'` | `backend/src/app.ts:31` | Detrás del proxy de la plataforma `req.secure=false` ⇒ **todo `/api/v1/iot` responde 403 `HTTPS_REQUERIDO`** al ESP32. Además `req.ip` = IP del proxy ⇒ el límite de login (5/min) se comparte entre **todos** los usuarios y la auditoría registra IPs falsas. |
| B-04 | `npm start` usa `tsx` (devDependency) | `backend/package.json` | Arranque de producción frágil; debe compilarse (`npm run build`) y ejecutarse `node dist/src/server.js`. |
| B-05 | `npm run build` del frontend compila **DEMO** | `frontend/package.json`, `vite.config.ts:10` | El comando por defecto de Vercel publicaría el simulador. Debe usarse `build:real` → `dist-real`. |
| B-06 | Cookie de refresco `SameSite=Strict` + frontend y backend en dominios distintos | `backend/src/modulos/auth.ts:33` | Si el frontend (vercel.app) llama directo al backend (otro dominio), la cookie no viaja ⇒ la sesión se pierde al recargar. **Solución sin tocar auth:** *rewrite* de Vercel `/api/*` → backend (mismo origen para el navegador). |
| B-07 | Sin `.gitignore` en la raíz; carpeta `test2026/` es **otro repositorio Git** con `node_modules`, reportes y videos | `test2026/.git` | Un `git add .` en la raíz arrastraría un repo anidado ajeno, binarios y artefactos. |
| B-08 | No existe infraestructura: ni GitHub remoto, ni hosting de backend, ni MySQL en la nube | — | Requiere intervención y autorización del usuario. |

## 3. Hallazgos P1 / P2

| ID | Prioridad | Hallazgo | Evidencia |
|---|---|---|---|
| H-01 | P1 | Sin opción TLS hacia MySQL (`ssl`). Necesaria si la base está fuera de la red privada del proveedor. | `backend/src/db.ts:9` |
| H-02 | P1 | `schema.sql` hace `USE agrocontrol;` y el importador fija la base a `agrocontrol`. En la nube hay que crear esa base (no usar la base por defecto del proveedor, p. ej. `railway`). | `database/schema.sql:16`, `importar-esquema.ps1:41` |
| H-03 | P1 | El esquema usa **triggers** y CHECKs, y el backend se niega a arrancar sin ellos. Proveedores sin triggers (TiDB Serverless, PlanetScale/Vitess) son **incompatibles**. | `backend/src/verificacion.ts:10-11` |
| H-04 | P1 | Las tareas de fondo (`caducarOrdenes` 5 s, `revisarPresencia` 30 s) corren en el proceso web ⇒ requiere **un proceso siempre encendido y una sola réplica**. Descarta funciones serverless (Vercel Functions) para el backend. | `backend/src/tareas.ts` |
| H-05 | P1 | El seed y la rotación de token leen `backend/.env` ⇒ riesgo de sembrar en la base local o en la remota por error. Hay que separar `.env.produccion` (ya cubierto por el patrón `.env.*` del `.gitignore`) y usar `DOTENV_CONFIG_PATH`. | `backend/scripts/seed.ts` |
| H-06 | P1 | El ESP32 necesita la **CA raíz** real del dominio de producción en NVS. Si la plataforma cambia de CA, el ESP32 queda `TLS_ERROR`. Conviene cargar un paquete con 2 raíces (p. ej. ISRG Root X1 + la alternativa del proveedor; límite 8192 bytes). | `firmware-esp32/AgroControl/SecureTransport.h:31` |
| H-07 | P2 | Mensajes de la UI REAL orientados a desarrollo (“¿Está en marcha (npm run dev en backend/)?”, “Añádalo a CORS_ORIGENES en backend/.env”, “use npm run dev:movil”). | `frontend/src/datos/api.ts:63,164`, `Login.tsx:136` |
| H-08 | P2 | Sin cabeceras de seguridad propias en el frontend estático (CSP/HSTS); Vercel sirve HTTPS+HSTS por defecto en `*.vercel.app`. | — |
| H-09 | P2 | Sin monitoreo externo de `/api/v1/salud`. | — |
| H-10 | P2 | Cada *preview deployment* de Vercel tiene otro origen ⇒ el backend lo rechazará (`ORIGEN_NO_PERMITIDO`). Correcto por seguridad; sólo funcionará el dominio de producción. | `backend/src/middlewares/cors.ts` |

## 4. Revisión de seguridad

| Área | Estado | Comentario |
|---|---|---|
| JWT | ✅ | HS256 explícito en `verify`, 15 min, secreto ≥32 caracteres con chequeo de entropía. |
| Refresco | ✅ | Token aleatorio, sólo SHA-256 en BD, rotación por uso, revocación de familia ante reutilización. |
| Cookies | ⚠ | Correctas para mismo origen. Exigen el *rewrite* de Vercel (B-06). |
| CORS | ✅ | Lista exacta, sin comodines, credenciales sólo a orígenes listados. Producción: `CORS_ORIGENES=https://<proyecto>.vercel.app`. |
| HTTPS | ⚠ | Lógica correcta; depende de `trust proxy` (B-03). |
| Login | ✅/⚠ | Bloqueo progresivo, tiempo constante, rate limit 5/min. ⚠ por IP falsa tras proxy (B-03). |
| Token ESP32 | ✅ | Formato estricto, hash SHA-256, rotación con gracia, `X-Id-Arranque` obligatorio, límite por token. |
| Errores | ✅ | Sin trazas al cliente. |
| Secretos en repo | ✅ | Ninguno. `.env` ignorado; `secrets.h` ignorado en firmware. |
| Cabeceras | ✅ | `helmet()`, `x-powered-by` deshabilitado, `Cache-Control: no-store` en API. |

## 5. Seguridad de la bomba y desconexión

**Capas que impiden encender hoy (todas verificadas en código):**

1. **Firmware (compilación):** `manualBenchEnabled=false`, `relay3v3Compatible=false`, `relayBootOffVerified=false`, `hardwareConfirmed=false`, `enableAutomaticAtBoot=false` con `static_assert` (`Settings.h`). Con estas barreras el GPIO26 no se habilita y toda orden ON se rechaza.
2. **Servidor – panel:** `BOMBA_ENCENDER` ⇒ 409 `ENCENDIDO_DESHABILITADO` si `PERMITIR_ENCENDIDO=false` (`servicio.ts:153`).
3. **Servidor – entrega al ESP32:** con `PERMITIR_ENCENDIDO=false` cancela cualquier `BOMBA_ENCENDER` pendiente antes de entregarla (`iot.ts:246-262`).
4. **Servidor – modo:** `AUTOMATICO` se degrada a `MANUAL` en la configuración entregada (`iot.ts:360`).
5. **Tope de duración:** `ENCENDIDO_MAX_S` (1–15, por defecto 5) + tope de 5 s del firmware; vigilante del servidor ordena `APAGAR` si la telemetría reporta la bomba encendida más de `max + 3 s` (`iot.ts:218`).

**Ante desconexión:** el firmware tiene apagado por pérdida de comunicación y prioridad OFF; el servidor marca órdenes `SIN_CONFIRMAR` / `EXPIRADA` y alerta `DISPOSITIVO_FUERA_DE_LINEA` a los 120 s.

**Riesgo residual (documentado por el propio firmware, `RELE_OFF_ONLY.md`):** la interfaz eléctrica del relé (entrada a 5 V vs GPIO 3,3 V, polarización durante reset/bootloader) **no está verificada**; “UNTOUCHED no asegura que el relé esté físicamente apagado”. **Recomendación:** durante la demostración, la bomba debe estar **sin alimentación** o desconectada del relé. **No** cambiar ninguna barrera ni `PERMITIR_ENCENDIDO`.

## 6. Alternativas de hosting (backend + MySQL)

Precios aproximados a la fecha de conocimiento del auditor: **confirmar en la página del proveedor antes de contratar.**

| Opción | Backend siempre encendido | MySQL con triggers | Suspensión | Costo aprox. | Veredicto |
|---|---|---|---|---|---|
| **Railway (Hobby)** — backend + MySQL en el mismo proyecto | ✅ | ✅ (MySQL 8 completo) | No | ~US$5/mes (incluye uso hasta ese monto) | **Recomendada.** Un solo panel, red privada backend↔MySQL, HTTPS con Let's Encrypt, despliegue desde GitHub. |
| Render (Starter) + Aiven MySQL (free) | ✅ (Starter) | Verificar privilegios de trigger en Aiven | Aiven free puede apagarse por inactividad | ~US$7/mes + 0 | Alternativa. Dos proveedores, TLS a MySQL obligatorio (H-01). |
| Render Free | ⚠ se duerme a los 15 min sin tráfico (el ESP32 lo mantiene despierto; arranque en frío 30–60 s si el ESP32 cae) | — (no ofrece MySQL) | Sí | 0 | No apto para IoT continuo. |
| Fly.io + MySQL en volumen | ✅ | ✅ (autogestionado) | Configurable | ~US$2–5/mes | Más trabajo operativo; no recomendable con la fecha límite. |
| VPS (DigitalOcean/Hetzner/Oracle Free) | ✅ | ✅ | No | 0–6 US$/mes | Requiere administrar SO, TLS y respaldos. Fuera de plazo. |
| Vercel Functions para el backend | ❌ (sin `setInterval`, conexiones efímeras) | — | — | — | **Incompatible** (H-04). |
| TiDB Serverless / PlanetScale | — | ❌ sin triggers | — | — | **Incompatible** (H-03). |
| Seguir en la PC + Cloudflare Tunnel | Depende de la PC | ✅ | Si la PC se apaga | 0 | No cumple “independiente de la computadora”. Sólo plan de contingencia. |

## 7. Requisitos para Vercel con datos reales

1. *Root directory* del proyecto: `frontend`.
2. *Build command*: `npm run build:real`; *Output directory*: `dist-real` (fijarlo en `frontend/vercel.json`, no sólo en el panel).
3. *Rewrite* `/api/:path*` → `https://<backend-produccion>/api/:path*` (mismo origen para el navegador; resuelve cookies y CORS).
4. Backend con `CORS_ORIGENES=https://<proyecto>.vercel.app` (Vercel reenvía la cabecera `Origin` del navegador).
5. Backend con `trust proxy` que contemple **dos saltos** para tráfico web (Vercel → proveedor → app) y uno para el ESP32. Ver T-02.
6. Prueba de aceptación: en el bundle publicado no aparece `SimuladorDemo` y la UI muestra “MODO REAL”.
