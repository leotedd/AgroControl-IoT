# Auditoría de arquitectura — AgroControl-IoT (Fase 1)

- **Fecha:** 2026-11-08
- **Modo:** sólo lectura. No se modificó código, configuración, base de datos ni credenciales. `backend/.env` se consultó únicamente para las banderas no secretas (`PERMITIR_ENCENDIDO=false`, `NODE_ENV=development`, `HOST=127.0.0.1`, `IOT_PERMITIR_HTTP_LOCAL=false`).
- **Objetivo evaluado:** sistema accesible desde teléfonos por Internet con la PC local apagada, a coste cero.
- **Documentos relacionados:** [MATRIZ_COMPATIBILIDAD_POSTGRESQL.md](MATRIZ_COMPATIBILIDAD_POSTGRESQL.md) · [COMPARATIVA_HOSTING_GRATUITO.md](COMPARATIVA_HOSTING_GRATUITO.md) · [PLAN_MIGRACION.md](PLAN_MIGRACION.md) · [RIESGOS_Y_SEGURIDAD.md](RIESGOS_Y_SEGURIDAD.md) · [TAREAS_PARA_CODEX.md](TAREAS_PARA_CODEX.md)

---

## 1. Arquitectura actual (estado verificado)

```
                      PC local (debe estar encendida)
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Vite dev :5174 (REAL) / :5175 (móvil, HTTPS autofirmado)            │
 │        │ proxy /api → http://127.0.0.1:3000                          │
 │        ▼                                                             │
 │  Backend Express + TS (tsx) 127.0.0.1:3000 ── tareas setInterval     │
 │        │ mysql2, pool 10, UTC                                        │
 │        ▼                                                             │
 │  MySQL 8 local · base agrocontrol · 17 tablas · 2 triggers · 7 CHECK │
 └──────────────▲───────────────────────────────────────────────────────┘
                │ Cloudflare Quick Tunnel (HTTPS, URL efímera)
 ESP32 ─HTTPS (CA fijada en NVS)─┘        Celular ─HTTPS─┘
```

| Capa | Tecnología | Observaciones |
|---|---|---|
| Frontend | React 18.3 + Vite 6.2 + Tailwind 4 + Recharts | Dos modos estancos (DEMO/REAL). REAL usa `BASE='/api/v1'` relativo y `credentials:'same-origin'` → **exige que la API se sirva en el mismo origen** que la web. Bundle: ~770 KB sin comprimir (`graficas` 417 KB). Sondeo de estado cada 3 s, alertas cada 10 s. |
| Backend | Node ≥20, Express 4.21, TS 5.7, zod, helmet, express-rate-limit, jsonwebtoken, bcryptjs, mysql2 | 16 rutas de panel, 4 de auth, 6 IoT, `/salud`. Producción compilada (`npm run build` → `start:compiled`). Ya admite `HOST=0.0.0.0`, `PORT`, `TRUST_PROXY`, `DB_SSL`. |
| Tareas en proceso | `setInterval` en `src/tareas.ts` | Caducidad de órdenes cada 5 s y presencia cada 30 s. **Viven dentro del proceso web**: si el servicio duerme, no corren. |
| Base de datos | MySQL 8.0.16+ InnoDB utf8mb4 | 17 tablas, 2 triggers (`trg_ordenes_inmutables`, `trg_ordenes_sin_borrado`), 7 CHECK. El arranque **se niega a iniciar** si no encuentra exactamente esto (`verificacion.ts`). |
| Firmware | ESP32 Arduino 0.3.0-trial, contrato 1.0.2 | `NetworkClientSecure` con CA PEM fijada (≤ 8192 caracteres), URL `https://host[:puerto]/api/v1`, token `agc_dev_…` (51 caracteres). Todo aprovisionado en NVS por USB. Tiempo de espera 8 s y *handshake* 5 s. Rechaza respuestas si `hora_servidor` difiere más de 30 s. Bomba física deshabilitada por 6 compuertas en tiempo de compilación. |
| Pruebas | Vitest 53 (backend, con MySQL temporal) + 83 (frontend) + 47 Node | `pruebas-con-bd-temporal.mjs` arranca `mysqld` desde `C:\Program Files\MySQL`: **dependen de MySQL instalado localmente**. |

## 2. Hallazgos por área

### 2.1 Backend

| ID | Hallazgo | Severidad |
|---|---|---|
| A-01 | Acceso a datos **acoplado a MySQL en todos los módulos**: SQL escrito a mano con marcadores `?`, `insertId`, `affectedRows`, `INSERT IGNORE`, `IF()`, `INTERVAL ? SECOND`, `UPDATE … JOIN`, `UPDATE … ORDER BY … LIMIT`, `UNIX_TIMESTAMP`, códigos de error `ER_*`. No hay capa de repositorio ni ORM. Detalle en la matriz. | Alta (para PostgreSQL) |
| A-02 | `verificacion.ts` consulta `information_schema.TRIGGERS` y `CHECK_CONSTRAINTS` y exige exactamente 7 CHECK. En PostgreSQL `check_constraints` también lista las restricciones NOT NULL, así que el conteo falla y **el servidor no arranca**. | Alta |
| A-03 | `autenticarDispositivo` hace un `UPDATE dispositivos SET ultima_conexion_en` **en cada petición del ESP32** (cada 3 s). Impide que una base *serverless* se suspenda y genera escrituras constantes. | Alta (coste en Neon) |
| A-04 | `bloquearDispositivo` usa `SELECT * … FOR UPDATE` (más de 40 columnas, con JSON `diagnostico`) en cada sondeo de órdenes. Es tráfico innecesario, y relevante con límites de *egress* (Supabase 5 GB). | Media |
| A-05 | Tareas periódicas dentro del proceso web. En un hosting que duerme, no hay caducidad ni alerta `DISPOSITIVO_FUERA_DE_LINEA` mientras nadie haga peticiones. Se recuperan ≤ 30 s después de despertar. | Media |
| A-06 | `HASH_FICTICIO = bcrypt.hashSync(…, 12)` al importar `auth.ts`, más `bcrypt.compare` de coste 12 en JS puro. En 0,1 vCPU (Render Free) se estiman varios segundos por login. Riesgo de superar el `TIEMPO_ESPERA_MS = 8000` del frontend en arranque en frío. | Media |
| A-07 | `TRUST_PROXY` se usa sin validar: el validador estricto existe (`scripts/validar-trust-proxy.mjs`) pero **no está conectado** a `config.ts` (pendiente según `RESULTADOS_CODEX.md`). Un valor incorrecto provoca 403 `HTTPS_REQUERIDO` en el ESP32 o hace que el *rate limit* use la IP equivocada. | Alta |
| A-08 | Límite de login de 5/min **por IP**. Si el frontend pasa por un proxy (reescritura del sitio estático), todos los usuarios pueden compartir la IP del proxy. | Media |
| A-09 | El *build* en Render con `NODE_ENV=production` omite `devDependencies` (`typescript`). Hace falta `npm ci --include=dev && npm run build`. | Media |
| A-10 | Sin `engines.node` en `package.json`: la versión de Node del proveedor queda sin fijar. | Baja |
| A-11 | Sin caso para `ER_DUP_ENTRY` en la clave de idempotencia: dos solicitudes concurrentes con la misma clave dan 500 en lugar de devolver la orden previa. La serialización por `FOR UPDATE` del dispositivo lo hace improbable. | Baja |

### 2.2 Autenticación, cookies, CORS y HTTPS

| Aspecto | Estado | Implicación para el despliegue |
|---|---|---|
| JWT de acceso | HS256, 15 min, en memoria del navegador; `algorithms:['HS256']` fijado | ✅ Correcto. Requiere un `JWT_SECRETO` **nuevo** en producción (≥ 32 caracteres, distinto del local). |
| Refresco | Cookie `agc_refresh` `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, 7 días, rotación por familia con detección de reutilización | ✅ Diseño sólido. **`SameSite=Strict` obliga a mismo sitio.** `onrender.com` está en la *Public Suffix List*: `app.onrender.com` y `api.onrender.com` son **sitios distintos**. Con frontend y backend en servicios separados sin proxy, la cookie no viaja y Safari iOS (ITP) bloquea cookies de terceros. **Conclusión: mismo origen obligatorio** (proxy `/api` o backend que sirva la SPA). |
| CORS | Lista exacta, credenciales, métodos y cabeceras acotados; peticiones sin `Origin` pasan (ESP32) | ✅ Con mismo origen, `CORS_ORIGENES` sólo debe contener el origen público de la web. |
| HTTPS | `/iot` exige `req.secure`, que depende de `trust proxy` + `X-Forwarded-Proto` | ⚠ Depende de A-07: hay que medir la cadena de proxies real del proveedor. |
| Bloqueo de cuenta | Progresivo tras 5 fallos, con tiempo constante | ✅ |
| Permisos | `exigirRol` por terreno (LECTOR < OPERADOR < PROPIETARIO; ADMIN global), 404 si no es miembro | ✅ Revisadas las 16 rutas del panel: todas pasan por `autenticarUsuario` y `exigirRol`. Rotar token y calibrar sensor exigen PROPIETARIO. |
| Encendido | `PERMITIR_ENCENDIDO=false` rechaza ENCENDER y AUTOMÁTICO; `/iot/ordenes` cancela encendidos pendientes; `/iot/configuracion` degrada AUTOMÁTICO→MANUAL; apagado de seguridad si la telemetría informa riego > `ENCENDIDO_MAX_S`+3 s | ✅ Defensa en profundidad verificada en código. |

### 2.3 Endpoints IoT y comunicación del ESP32 con un backend público

| Endpoint | Frecuencia típica | Coste por llamada |
|---|---|---|
| `GET /iot/ordenes` | cada 3 s (`intervalo_ordenes_s`, por defecto 3, rango 2–60) | 1 SELECT + 1 UPDATE de autenticación, más una transacción con `FOR UPDATE` (≈ 5 sentencias) |
| `POST /iot/telemetria` | cada 10 s (`intervalo_telemetria_s`) | ≈ 10–15 sentencias |
| `GET /iot/configuracion` | por ETag (casi siempre 304) | 3–4 SELECT |
| `POST /iot/eventos`, confirmaciones | esporádicas | variable |
| `GET /salud` | al abrir cada sesión TLS | `SELECT 1` |

**Volumen mensual estimado (30 días, 1 ESP32):** ≈ 864 000 sondeos de órdenes + ≈ 259 000 telemetrías ≈ **1,12 M peticiones/mes**, ≈ **10–11 M sentencias SQL/mes** y ≈ **1,5–2,5 GB de salida HTTP** (cabeceras de helmet, rate-limit y CORS ≈ 1–1,3 KB por respuesta).

**Requisitos para conectar el ESP32 a un backend público:**

1. URL `https://<servicio>/api/v1`, aprovisionada en NVS por USB. Es la **única dependencia física de la PC** que queda tras migrar, y sólo hace falta una vez por cambio de URL o CA.
2. **CA:** Render emite con Let's Encrypt y/o Google Trust Services y puede alternar entre ambas. Hay que fijar un paquete de raíces (ISRG Root X1, ISRG Root X2, GTS Root R1, GTS Root R4) en un solo PEM. Debe caber en 8192 caracteres: cuatro raíces ≈ 7,3–7,8 KB, **al límite**. Alternativa: dos raíces (ISRG X1 + GTS R1). Verificar la cadena real con `openssl s_client -showcerts` antes de aprovisionar.
3. **Arranque en frío:** si el servicio duerme, la primera petición tarda 30–60 s y el ESP32 corta a los 5–8 s. El firmware tiene *backoff* y reintenta, así que el sistema converge, aunque con huecos. Mientras el ESP32 esté en línea, sus propias peticiones cada 3 s **mantienen despierto** el servicio de Render.
4. `hora_servidor` con deriva < 30 s: sin problemas en PaaS (NTP gestionado).
5. Rate limit por token (80/min general, 40/min órdenes): suficiente para 20 sondeos/min.

### 2.4 Frontend

| ID | Hallazgo |
|---|---|
| F-01 | `BASE='/api/v1'` relativo: el frontend necesita un proxy de mismo origen. `vercel.json` ya lo modela para Vercel. En Render Static Site hay que usar una regla *Rewrite* `/api/*` → backend (**verificar** que Render admite reescritura a URL externa como proxy) o servir la SPA desde Express (alternativa robusta). |
| F-02 | El guard `validar-despliegue.mjs` sólo actúa con `VERCEL=1`. En Render no protege contra destinos de marcador. |
| F-03 | Sondeo cada 3 s con *backoff* hasta 15 s y timeout de 8 s. En arranque en frío el usuario verá «sin conexión» durante 30–60 s. Hace falta un mensaje específico de «el servidor está despertando». |
| F-04 | El sondeo de alertas y estado mantiene despierto el backend mientras haya un teléfono con la app abierta. Es inofensivo, pero consume ancho de banda (≈ 6 MB por hora abierta). |

## 3. Funcionalidades que dependen de la computadora local

| Funcionalidad | Dependencia actual | Tras el despliegue propuesto |
|---|---|---|
| Base de datos | MySQL en la PC | Gestionada en la nube |
| API backend | `tsx`/`node` en 127.0.0.1:3000 | PaaS |
| Acceso remoto | Cloudflare Quick Tunnel (URL efímera, PC encendida) | Dominio estable del PaaS |
| Web para el celular | `vite --mode movil` con certificado autofirmado | Sitio estático con HTTPS válido |
| Tareas de caducidad y presencia | Proceso local | Proceso del PaaS (se detiene si duerme; ver A-05) |
| Seed, rotar token, cambiar contraseña, rotar JWT | Scripts locales contra MySQL local | Siguen siendo locales, pero apuntan a la base remota con `DOTENV_CONFIG_PATH` (T-07 `--confirmar-host` sigue pendiente) |
| Importar esquema | `importar-esquema.ps1` + cliente `mysql` | Script equivalente para el destino |
| Pruebas backend | `mysqld` local temporal | Requieren un PostgreSQL efímero si se migra (embedded-postgres o Docker) |
| Aprovisionar y compilar el ESP32 | USB + Arduino IDE en la PC | **Sigue requiriendo la PC**, sólo para cambios de firmware, URL, CA o token |
| Copias de seguridad | No hay rutina automatizada | Debe definirse: el plan gratuito de Supabase no incluye copias, y Neon Free sólo ofrece restauración limitada |

## 4. Viabilidad de la arquitectura candidata (Render + Neon)

| Componente | Viable | Comentario |
|---|---|---|
| Frontend en Render Static Site | ✅ | No consume horas de instancia. Requiere la regla de proxy `/api` (F-01). |
| Backend en Render Free | ✅ con reservas | Un único servicio 24/7 consume ≈ 720–744 h de las 750 h/mes del espacio de trabajo: **no admite un segundo servicio web gratuito**. 0,1 vCPU y 512 MB. Duerme tras 15 min sin tráfico. Ancho de banda del plan Hobby: **5 GB/mes** desde el 1 de agosto de 2026 (antes 100 GB); exceso a 0,15 USD/GB. |
| PostgreSQL en Neon Free | ❌ **para 24/7** | 100 CU-h/mes por proyecto con mínimo de 0,25 CU: ≈ **400 h ≈ 16–17 días** de cómputo continuo. Con el ESP32 escribiendo cada 3 s (A-03) y la tarea de caducidad cada 5 s, el cómputo **nunca se suspende** (el umbral de suspensión es de 5 min). Agotada la cuota, la base se detiene hasta el mes siguiente. Neon sólo sirve gratis con uso intermitente o para demostraciones. |

**Veredicto:** la arquitectura candidata es **técnicamente viable** (el código se puede portar a PostgreSQL), pero **Neon Free no cubre un mes de operación 24/7 con el ESP32 activo**. Se recomienda cambiar el proveedor PostgreSQL por uno sin límite de horas de cómputo (Supabase Free) o conservar MySQL en una VM *Always Free* (ver comparativa).

## 5. Recomendación de arquitectura

```
Celular / PC ──HTTPS──► Render Static Site (frontend REAL, dist-real)
                          │ rewrite /api/* (mismo origen → cookie Strict OK)
                          ▼                     [alternativa: Express sirve la SPA]
                 Render Free Web Service (backend Node, 0.0.0.0:$PORT, 1 instancia)
                          │ TLS, pooler en modo sesión (IPv4)
                          ▼
                 PostgreSQL gestionado — Supabase Free (siempre encendido, 500 MB)
                          [Neon: sólo si se acepta el pago (~20 USD/mes) o un uso intermitente]
ESP32 ──HTTPS directo (paquete de CA LE + GTS)──► Render backend /api/v1/iot
```

- **Principio de reversibilidad:** portar a **PostgreSQL estándar** sin funciones exclusivas de un proveedor, de modo que cambiar de Supabase a Neon (u otro) sea sólo cambiar `DATABASE_URL`. Mantener la rama MySQL funcional hasta cerrar la Fase 4 del plan.
- **Alternativa que conserva MySQL (sin migrar el código):** Oracle Cloud Always Free (VM con MySQL 8 + backend + Caddy/Let's Encrypt). Ofrece 100 % de compatibilidad (triggers, CHECK, `utf8mb4_0900_ai_ci`) a cambio de operación manual y riesgo de recuperación de instancias inactivas. Ver [COMPARATIVA_HOSTING_GRATUITO.md](COMPARATIVA_HOSTING_GRATUITO.md).

## 6. Fuentes externas consultadas (2026-11-08)

- Render Free: [render.com/docs/free](https://render.com/docs/free); cambios de planes y ancho de banda: [render.com/blog/better-pricing-for-fast-growing-teams](https://render.com/blog/better-pricing-for-fast-growing-teams)
- Neon: [neon.com/docs/introduction/plans](https://neon.com/docs/introduction/plans), [neon.com/faqs/free-plan-limits-and-quotas](https://neon.com/faqs/free-plan-limits-and-quotas)
- Supabase (fuentes secundarias, **verificar en supabase.com/pricing**): [jetadmin.io](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)
- Aiven MySQL Free retirado: [aiven.io/docs/…/mysql-free-tier-migration-options](https://aiven.io/docs/products/mysql/howto/mysql-free-tier-migration-options)
- TiDB Cloud Starter: [docs.pingcap.com/tidbcloud/serverless-limitations](https://docs.pingcap.com/tidbcloud/serverless-limitations/), [docs.pingcap.com/tidb/stable/mysql-compatibility](https://docs.pingcap.com/tidb/stable/mysql-compatibility)
- Oracle Always Free: [docs.oracle.com/…/FreeTier/resourceref.htm](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)

> Los límites de los planes gratuitos cambian con frecuencia. Varios datos provienen de fuentes secundarias contradictorias (almacenamiento de Neon: 0,5 frente a 1 GB; reducción de Oracle A1 en junio de 2026). **Reconfirmar en los paneles oficiales antes de crear recursos.**
