# INVENTARIO DEPENDENCIAS

Fecha: 2026-11-08. Estado: propuesta para revisión de arquitectura; sin implementar migración.

## Alcance y evidencia
Inspección de archivos locales, sin leer backend/.env ni conectar a bases o hardware. No se encontraron AGENTS.md aplicables en la raíz inspeccionada. El repositorio muestra sus carpetas principales como no rastreadas; git diff por sí solo no sirve como evidencia de conservación. Claude mantiene la responsabilidad de arquitectura. Sólo se escriben estos documentos.

## Backend
ESM, Express 4.21.2 y TypeScript 5.7.3. Ejecución actual: tsx src/server.ts; compilación: tsc -p tsconfig.build.json; ejecución compilada: node dist/src/server.js. Dependencias declaradas: mysql2 3.12.0, bcryptjs 2.4.3, cookie-parser 1.4.7, dotenv 16.4.7, express-rate-limit 7.5.0, helmet 8.0.0, jsonwebtoken 9.0.2, zod 3.24.1. Pruebas: Vitest 3.0.5 y Supertest 7.0.0. Son versiones de package.json; no constituyen auditoría de vulnerabilidades ni comprobación del árbol instalado.

No hay driver PostgreSQL declarado. Propuesta pendiente: pg y sus tipos, con versiones fijadas y lockfile revisado. No instalar en esta fase. No se propone introducir ORM para traducir SQL automáticamente.

## Mapa funcional
| Archivo o grupo | Responsabilidad y dependencia |
|---|---|
| backend/src/db.ts | Pool mysql2, tipos, parámetros ?, insertId/affectedRows, UTC y reintentos |
| backend/src/config.ts | Variables DB_* y política de producción |
| backend/src/server.ts | Verificación MySQL obligatoria al arrancar; inicia tareas que escriben |
| backend/src/verificacion.ts | Catálogos MySQL, 17 tablas, dos triggers, siete CHECK y consistencia |
| backend/src/modulos/auth.ts | Usuarios, refresh, expiraciones y bloqueo progresivo |
| backend/src/modulos/iot.ts | Telemetría, deduplicación, entrega, ACK, eventos y ciclos; tipo PoolConnection |
| backend/src/modulos/servicio.ts | órdenes y configuración bajo bloqueo; tipo PoolConnection |
| backend/src/modulos/panel.ts | Lecturas, agregaciones, control y llamadas directas a query |
| backend/src/middlewares/seguridad.ts | Autenticación, arranques y UPDATE JOIN |
| backend/src/util/registro.ts | Alertas y auditoría |
| backend/src/tareas.ts | Expiración cada 5 s y presencia cada 30 s; escritura |
| backend/src/app.ts | Salud SELECT 1, CORS, proxy y límites |
| backend/src/errores.ts | Clasificación de errores MySQL/red |
| backend/tests/*.ts | Fixtures y aserciones con SQL MySQL; escriben |
| database/schema.sql | DDL MySQL 8.0.16+, charset, collation, triggers y privilegios |
| database/importar-esquema.ps1 | Importación real mediante cliente mysql; no ejecutar |
| database/migrations/README.md | Convenciones; no hay migraciones SQL incrementales en esa carpeta |

## Scripts y operación
- scripts/seed.ts: verifica BD y crea diez grupos de registros en transacción; rechaza base poblada. --simular también conecta. Puede mostrar un token nuevo; no ejecutar ni capturar como evidencia pública.
- scripts/verificar-entorno.ts: consulta esquema y consistencia; lectura, pero no ejecutado contra datos reales.
- scripts/pruebas-con-bd-temporal.mjs: inicializa MySQL temporal con root sin contraseña, importa esquema y elimina su carpeta al finalizar. No usa servicio habitual, pero excede la restricción de escritura exclusiva de esta fase y las pruebas cambian la bandera de encendido en memoria.
- scripts/rotar-token.ts, rotar-jwt.ts y cambiar-contrasena.ts: operaciones sobre secretos/estado; no ejecutar.
- scripts/simulador-esp32.ts, prueba-http.mjs, prueba-proxy-movil.mjs, iniciar-movil.mjs: conectividad o arranque operativo; no ejecutar contra entorno real.
- scripts/comprobar-config-produccion.mjs: prueba sin BD pero requiere dist previamente compilado; no ejecutada para evitar generar dist fuera del directorio autorizado.
- scripts/validar-trust-proxy.mjs y su prueba: validador puro preparado, aún no integrado en config.ts.

Frontend: React 18.3.1, Vite 6.2.0, TypeScript 5.7.3; las llamadas relativas y cookies condicionan la topología del despliegue. Firmware: Settings.h y SecureTransport.h condicionan HTTPS/NVS; no requieren conectarse directamente a Neon.

## Referencias adicionales
backend/package.json, backend/package-lock.json, backend/.env.example, backend/.env.production.example, backend/README.md, backend/ENTREGA_BACKEND.md, database/README.md y README.md contienen configuración o instrucciones MySQL. backend/.env existe pero su contenido queda excluido. El catálogo de consultas adjunto cubre también archivos sin la palabra MySQL que importan el adaptador.
