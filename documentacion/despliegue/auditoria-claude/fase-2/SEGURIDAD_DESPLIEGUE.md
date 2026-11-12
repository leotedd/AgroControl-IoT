# Seguridad del despliegue — Render + Supabase

- **Fecha:** 2026-11-09 · Complementa `auditoria-claude/RIESGOS_Y_SEGURIDAD.md` (Fase 1).

## 1. Modelo de amenazas resumido

| Activo | Amenaza | Control |
|---|---|---|
| Bomba física | Encendido remoto no autorizado | `PERMITIR_ENCENDIDO=false` (servidor) + 6 compuertas de compilación del firmware + lease de 4 s + tope de 5 s + temporizador de hardware. **Independiente de la nube** |
| Sesiones web | Robo o fijación de sesión, CSRF | JWT de acceso en memoria (15 min) + cookie de refresco `HttpOnly; Secure; SameSite=Strict; Path` acotado, con rotación por familia. Mismo origen |
| Token del ESP32 | Suplantación del dispositivo | 256 bits, SHA-256 en BD, sólo por HTTPS, `X-Id-Arranque` obligatorio, rotación con gracia |
| Base de datos | Exfiltración o manipulación | TLS `verify-full`, rol de aplicación de mínimo privilegio, triggers de inmutabilidad, sin exposición directa a Internet desde la aplicación |
| Secretos | Fuga en el repositorio o en logs | Variables sólo en el panel de Render; escaneo C-10.7; mensajes sin eco |
| Disponibilidad | Agotar cuotas gratuitas (DoS económico) | *Rate limit* por token o IP, optimización IoT, alarmas de uso, sin tarjeta (suspensión en lugar de cobro) |

## 2. HTTPS y proxy

| Punto | Requisito | Estado |
|---|---|---|
| TLS público | Render termina TLS (Let's Encrypt / Google Trust Services) | Proveedor |
| `req.secure` | Depende de `trust proxy` + `X-Forwarded-Proto` del proxy de Render | **Pendiente de medición** (C-2.2) |
| `TRUST_PROXY` | Validación estricta integrada en `config.ts` | ✅ Integrada por Codex (`src/util/trust-proxy.mjs`, 15 casos en `tests/safe/config.test.ts`). ⚠ Falta la forma `saltos:N` (C-2.1): sin ella, en Render hay que expresar la confianza como CIDR, y el rango del proxy de Render no está publicado. Ver RS2-01 |
| Suplantación de `X-Forwarded-Proto` | Un cliente fuera de `TRUST_PROXY` no debe conseguir `req.secure` | ✅ Cubierto por la prueba de Codex («no confía en X-Forwarded-Proto … fuera de TRUST_PROXY») |
| Acceso al puerto sin proxy | En Render el contenedor sólo es accesible a través de su proxy | Proveedor. Condición necesaria para usar `saltos:N` |
| HSTS | helmet en `production` | Hoy helmet se aplica en todos los entornos (también `upgrade-insecure-requests`). Ver H-03 |

### 2.1 Procedimiento para medir `TRUST_PROXY` en Render (fase de despliegue, no ahora)

1. Desplegar con `TRUST_PROXY=loopback` y `DIAGNOSTICO_PROXY=true` + `DIAGNOSTICO_PROXY_HASTA=<+2 h>`.
2. `GET /api/v1/diagnostico/proxy` desde el móvil (datos móviles): anotar `ips`, `saltos_xff`, `secure=false`.
3. Fijar `TRUST_PROXY=saltos:N` con el N que hace que `ip` sea la IP pública del móvil y `secure=true`.
4. Repetir la prueba enviando `X-Forwarded-For: 1.2.3.4` falsificado: `ip` **no** debe ser `1.2.3.4`. Si lo es, N es demasiado alto.
5. Quitar `DIAGNOSTICO_PROXY` y volver a desplegar.

## 3. Autenticación y cookies con el despliegue elegido

| Verificación | Resultado del análisis |
|---|---|
| ¿Funciona `SameSite=Strict`? | **Sí**, porque la web y la API comparten el origen `https://<svc>.onrender.com` (AD-03). Las peticiones `fetch('/api/v1/auth/refresh', {credentials:'same-origin'})` son *same-site* y la cookie viaja |
| Navegación desde un enlace externo (WhatsApp, correo) | La primera navegación *top-level* cross-site **no** envía cookies `Strict`. No afecta: la SPA carga y luego ejecuta `fetch` same-origin a `/auth/refresh`, que sí lleva la cookie. **Verificar en V-AUTH-06** con un enlace abierto desde otra aplicación del móvil |
| `Secure` | El origen público es HTTPS. En local, Chrome acepta `Secure` en `http://localhost` |
| `Path=/api/v1/auth` | La cookie no viaja a `/api/v1/iot` ni al panel: reduce la exposición |
| Logout | `clearCookie` sólo indica `path`. Los navegadores borran por nombre + dominio + ruta, así que funciona. C-7.2 pide los mismos atributos por robustez |
| CSRF | `SameSite=Strict` + JSON + CORS de lista exacta. El panel usa un Bearer en memoria (no automático): el CSRF clásico no aplica a las rutas del panel; `/auth/refresh` sólo devuelve un token al propio origen |
| JWT | HS256 fijado (la prueba de Codex verifica el rechazo de HS384); `JWT_SECRETO` **nuevo** en producción, ≥ 48 bytes, distinto del local |
| *Rate limit* de login | Por IP (5/min). Con Render como único proxy y `TRUST_PROXY` correcto, `req.ip` es el cliente. C-7.4 añade la clave IP+email para no penalizar a quienes comparten NAT o hotspot |

## 4. CORS

Con mismo origen, el navegador no envía `Origin` en GET y sí en POST/PATCH. `CORS_ORIGENES` en producción = `https://<svc>.onrender.com` exacto; cualquier otro origen recibe 403 (verificado por la prueba de Codex). El firmware no envía `Origin` y pasa autenticado por token.

## 5. CSP y cabeceras del frontend servido por Express

| ID | Hallazgo (revisión del bloque 2 en curso) | Severidad | Evidencia |
|---|---|---|---|
| **H-01** | El `index.html` real contiene un `<script>` en línea (aplicación del tema antes de pintar). La CSP por defecto de helmet (`script-src 'self'`) **lo bloquea**: destello de tema claro en modo oscuro y error de CSP en la consola. La prueba de Codex usa un `index.html` sintético y no lo detecta | Media (funcional, no de seguridad) | Ejecución independiente: build REAL servida por `crearApp()`; hash `sha256-Y+U46s…` no presente en la CSP (§INFORME_SUPERVISION) |
| H-02 | Google Fonts: la CSP por defecto de helmet lo permite (`style-src https:`, `font-src https:`), pero de forma genérica. C-7.6 lo restringe a los dos hosts de Google | Baja | Misma ejecución |
| H-03 | `upgrade-insecure-requests` y HSTS de helmet se aplican también fuera de `production` | Baja | Cabecera observada en `NODE_ENV=test` |
| H-04 | `frame-ancestors 'self'` (helmet) frente a `'none'` del contrato | Baja | Misma ejecución |

## 6. Endpoints IoT

| Control | Estado |
|---|---|
| Sólo HTTPS (`requerirHttps`) | ✅ Verificado por la prueba de Codex: HTTP → 403 `HTTPS_REQUERIDO` |
| Token obligatorio, formato estricto | ✅ (401 sin token aunque haya HTTPS simulado) |
| Límite por token | 80/min general, 40/min órdenes: suficiente para 20 sondeos/min |
| Cuerpo ≤ 16 KB | ✅ |
| Sin enumeración entre dispositivos | ✅ 404 idéntico para una orden de otro dispositivo (contrato P-3) |
| Diagnóstico de proxy | Desactivado por defecto; con caducidad obligatoria en producción (C-2.2) |

## 7. Base de datos (Supabase)

- Conexión sólo desde el backend. La URL de Supabase **nunca** llega al frontend (`VITE_*`) ni al firmware.
- `sslmode=verify-full` + `DB_SSL_CA`. Prohibido `rejectUnauthorized:false`.
- Rol `agro_app` sin DDL, sin `ALTER TABLE` (no puede desactivar triggers) y sin `DELETE` histórico (C-4.4).
- La API REST/PostgREST de Supabase queda **sin uso**. No se publica la clave `anon`. Se recomienda activar RLS sin políticas en todas las tablas del esquema `public`: deniega el acceso por la API de Supabase y no afecta al rol propietario de la conexión directa. Esto se decide en la fase de despliegue (D2-03), porque `agro_app` necesitaría `BYPASSRLS` o políticas.

## 8. Secretos

| Secreto | Dónde vive | Rotación para el despliegue |
|---|---|---|
| `JWT_SECRETO` | Panel de Render | Nuevo (no reutilizar el local) |
| `DATABASE_URL` (incluye la contraseña de `agro_app`) | Panel de Render | Nueva, generada en Supabase |
| `DB_SSL_CA` | Panel de Render (no es secreto, pero es configuración) | — |
| Contraseña del administrador de la demostración | Gestor del usuario; seed por variable temporal | Nueva |
| Token del ESP32 de la demostración | Gestor del usuario; NVS del dispositivo (fase futura) | Nuevo (el local sigue siendo válido sólo contra la MySQL local) |

El escaneo de secretos independiente se ejecuta en cada puerta (V-SEC-01).

## 9. Riesgos de seguridad abiertos de la Fase 2

| ID | Riesgo | P×I | Acción |
|---|---|---|---|
| RS2-01 | Sin `saltos:N`, `TRUST_PROXY` en Render requiere un CIDR desconocido; la tentación sería poner `uniquelocal` sin medir | 4×4 | Implementar C-2.1 y el procedimiento §2.1 |
| RS2-02 | Pruebas existentes que activan `PERMITIR_ENCENDIDO` en memoria | 1×5 | C-8.2: aisladas, contra base temporal y sin red; revisión V-BOMBA-06 |
| RS2-03 | CSP rompe el tema (H-01) o, si se relaja con `'unsafe-inline'`, debilita la protección contra XSS | 3×2 | Mover el script a un archivo (C-7.6) |
| RS2-04 | API de Supabase expuesta sin RLS | 2×4 | §7, decisión D2-03 |
| RS2-05 | `start-cloud.mjs` fuerza `NODE_ENV=production` y `PERMITIR_ENCENDIDO=false`: correcto, pero `SERVIR_FRONTEND` apunta a `frontend/dist`, no a `dist-real` | 1×2 | Aceptable si la build `production` es REAL (verificado: 0 `SimuladorDemo`, contiene «MODO REAL»). Documentar en la guía |
