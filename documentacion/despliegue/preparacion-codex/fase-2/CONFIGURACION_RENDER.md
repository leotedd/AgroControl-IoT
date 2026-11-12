# Configuración Render

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Topología y comandos preparados
Un único Web Service sirve API y SPA bajo HTTPS con mismo origen. No crear servicios todavía. Directorio raíz del servicio: raíz del repositorio.

Build del contrato:
```sh
cd frontend && npm ci --include=dev && npm run build:real && cd ../backend && npm ci --include=dev && npm run build
```
Start:
```sh
cd backend && npm run start:compiled
```

Configurar SERVIR_FRONTEND=../frontend/dist-real. La resolución parte del directorio backend, también en la build compilada. Como alternativas preparadas: npm --prefix backend run build:cloud (dependencias ya instaladas) y npm --prefix backend run start:cloud; este último fija HOST=0.0.0.0 y rechaza una bandera de encendido diferente de false.

Health check: /api/v1/salud. HOST=0.0.0.0; PORT lo proporciona Render y tiene prioridad. Una instancia; rate limiting y caché de presencia son en memoria. No activar despliegue automático antes de revisión y autorización.

## Variables
Usar backend/.env.production.example como referencia, sin subir .env real. NODE_ENV=production; DB_MOTOR=postgres; DATABASE_URL del pooler de sesión; DB_SSL=true; DB_SSL_CA PEM real; JWT_SECRETO nuevo; PG_POOL_MAX=5; PG_CONNECTION_TIMEOUT_MS=10000; PG_STATEMENT_TIMEOUT_MS=10000; PG_LOCK_TIMEOUT_MS=5000; PERMITIR_ENCENDIDO=false; ENCENDIDO_MAX_S=5; IOT_PERMITIR_HTTP_LOCAL=false; LIMITES_DESACTIVADOS=false. CORS_ORIGENES debe ser el origen HTTPS exacto aprobado. Sustituir todos los marcadores antes de arrancar.

engines admite Node >=22.12.0 <25. Validado aquí: Node 24.14.1. El contrato propone Node 22 LTS; validar esa versión antes de fijar NODE_VERSION=22 o aprobar expresamente la desviación a la versión validada. No se declara haber probado Node 22.

## Proxy y web
Mantener TRUST_PROXY=loopback hasta medir el entorno real. El diagnóstico sólo se activa temporalmente con DIAGNOSTICO_PROXY=true y fecha ISO futura de hasta 24 h en DIAGNOSTICO_PROXY_HASTA. Medir desde móvil, comprobar secure/IP y repetir con X-Forwarded-For falsificado antes de aceptar saltos:N. No suponer N. Desactivar el diagnóstico después.

Cookie conserva HttpOnly, Secure, Strict y ruta acotada. CSP permite scripts locales, fuentes Google concretas, y estilos inline necesarios para React/Recharts; el script de tema ya es externo. La API nunca cae al HTML. El estado actual del frontend conserva backoff; un mensaje específico de arranque en frío queda pendiente de revisión UX.

## Límites de gratuidad
Render anuncia suspensión tras 15 min sin tráfico y limitaciones de sus instancias Free; no garantiza uso de producción ni continuidad. Comprobar cuotas y comportamiento de cobros en la cuenta antes de autorizar el despliegue. No se creó una cuenta ni servicio. [Render Free](https://render.com/docs/free), [Express en Render](https://render.com/docs/deploy-node-express-app).

## Puerta antes de publicar
Resolver avisos de dependencias, hallazgos del escáner, revisión de bloques y medición TLS/proxy. La existencia de scripts de build no autoriza ejecutar el arranque contra una base real.
