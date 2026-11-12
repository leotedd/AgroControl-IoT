# CONFIGURACION RENDER NEON

Fecha: 2026-11-08. Estado: propuesta para revisión de arquitectura; sin implementar migración.

## Propuesta, no configuración activa
Backend como Web Service de Render. HOST=0.0.0.0; el código ya toma PORT antes de PUERTO. Desde raíz backend: build futuro npm ci --include=dev && npm run build; start npm run start:compiled; health check /api/v1/salud. Son comandos para una fase aprobada, no se ejecutaron ni instalaron dependencias. Fijar Node compatible tras validar build. [Render Web Services](https://render.com/docs/web-services).

Frontend: build npm ci && npm run build desde frontend; salida dist. Vite activa fuente real en production y sólo proporciona proxy de API durante desarrollo. Un Static Site no adquiere ese proxy de Vite al publicar; validar la solución de mismo origen antes de crear servicios. [Render Static Sites](https://render.com/docs/static-sites).

## Variables backend
| Variable | Propuesta sin credenciales | Estado |
|---|---|---|
| NODE_ENV | production | Ya admitida |
| HOST | 0.0.0.0 | Ya admitida |
| PORT | Inyectada por Render | Ya admitida; no fijar PUERTO contra PORT |
| TRUST_PROXY | <CIDR o política de proxy verificada> | Nunca copiar marcador; determinar ruta real, no true/0.0.0.0/0 |
| CORS_ORIGENES | https://panel.agrocontrol.example | Origen exacto ilustrativo; reemplazar por dominio aprobado |
| JWT_SECRETO | <secreto aleatorio externo de al menos 32 caracteres> | Secret del proveedor; conservar o rotar con plan de sesiones |
| PERMITIR_ENCENDIDO | false | Obligatorio |
| ENCENDIDO_MAX_S | 5 | Tope adicional; no habilita bomba |
| IOT_PERMITIR_HTTP_LOCAL | false | Producción fuerza false |
| LIMITES_DESACTIVADOS | false | Producción fuerza false |
| DATABASE_URL | <URL PostgreSQL pooled del rol de aplicación> | NUEVA; el código actual no la utiliza |
| DATABASE_URL_DIRECT | <URL PostgreSQL directa del rol de migración> | NUEVA; sólo herramienta administrativa, no navegador/firmware |
| PG_POOL_MAX | 5 como valor inicial de ensayo | NUEVA; dimensionar según réplicas y conexiones disponibles |
| PG_CONNECTION_TIMEOUT_MS | 10000 como propuesta | NUEVA |
| PG_IDLE_TIMEOUT_MS | 30000 como propuesta | NUEVA |

DB_HOST, DB_PUERTO, DB_USUARIO, DB_CONTRASENA, DB_NOMBRE, DB_SSL y DB_SSL_CA pertenecen al adaptador MySQL actual. No sustituirlos por datos Neon mientras siga activo mysql2. SEED_ADMIN_* son de aprovisionamiento, no necesarios para operación normal. No almacenar secretos en VITE_*, documentación o firmware versionado.

## Neon y transporte
Propuesta pg por TCP con pool pequeño y URL pooled de Neon para aplicación; URL directa para DDL, importación y respaldo. Neon utiliza pooling por transacción: no depender de SET de sesión persistente entre transacciones; establecer UTC por rol/base o SET LOCAL en transacción. Configurar TLS con validación de certificado/hostname sin rejectUnauthorized=false y probar la interacción de sslmode de URL con opciones del driver elegido. [Neon pooling](https://neon.com/docs/connect/connection-pooling).

Roles separados: propietario/migrador y aplicación sin DDL ni borrado histórico; conceder uso de esquema y secuencias cuando corresponda. Resolver privilegios DELETE por tabla según esquema fuente. Configurar tiempos máximos de consulta/bloqueo, límite global de conexiones, región cercana, respaldo y retención según plan contratado. No se verificó una cuenta ni disponibilidad de planes.

## HTTPS, proxy, cookies y CORS
El middleware IoT exige req.secure: validar que sólo el proxy real aporte X-Forwarded-Proto confiable. El validador de TRUST_PROXY existente aún no está integrado. Comprobar req.ip y rate limiting detrás del proxy; múltiples instancias requieren revisar límites en memoria y ejecución duplicada de tareas. No confiar en cualquier cliente ni exponer un puerto que permita saltarse el proxy.

La cookie agc_refresh ya es HttpOnly, Secure, SameSite=Strict, path=/api/v1/auth; frontend llama /api/v1 con credentials=same-origin. Preferencia técnica pendiente de arquitectura: servir frontend y /api bajo un mismo origen HTTPS mediante proxy/servidor aprobado. Revisar reenvío de Set-Cookie, ruta y Origin. CORS permite credenciales y lista exacta, pero no resuelve por sí solo las cookies de distintos sitios.

Si se eligen orígenes separados: cambiar base API y credentials=include; decidir SameSite según sitios reales (None+Secure para cross-site), revisar CSRF/Origin y bloqueo de cookies de terceros. Un subdominio diferente es otro origen aunque pueda ser el mismo sitio. No aplicar ese cambio sin diseño y pruebas. Revisar clearCookie con atributos consistentes.

Salud actual sólo hace SELECT 1; arranque verifica esquema y luego activa tareas escritoras. No arrancar un backend de ensayo apuntando al origen real. Proponer cierre SIGTERM que espere solicitudes/tareas antes de pool.end; observar reconexión, suspensión y latencia del hosting antes de usar automatización IoT.

## ESP32
No conecta a PostgreSQL. Usa URL HTTPS con /api/v1 exacto, token Bearer, X-Id-Arranque y CA aprovisionados en NVS (agro-api). Usar dominio estable, puerto 443, cadena CA válida y reloj SNTP válido; ensayar rotación de certificados y reconexión con fixture. No usar setInsecure. La salud también valida el transporte. Mantener hardwareConfirmed=false, manualBenchEnabled=false y enableAutomaticAtBoot=false observados en Settings.h; no aprovisionar, flashear ni enviar órdenes en esta fase. Cambiar URL/token/CA del equipo requiere autorización posterior.
