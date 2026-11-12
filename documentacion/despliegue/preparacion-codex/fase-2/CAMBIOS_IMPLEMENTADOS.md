# Cambios implementados

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Alcance
Se leyeron ambas auditorías y el contrato normativo 2.0, incluida la revisión 2.1 de CSP. Al inicio no existía el contrato: se hicieron cambios independientes del motor. Tras la reanudación ya existía y se implementó el doble motor según sus decisiones. Los documentos de arquitectura no se editaron. La aprobación independiente de los bloques sigue pendiente.

## Implementación
- MySQL conserva su driver, esquema original y comportamiento por defecto local. PostgreSQL se selecciona con DB_MOTOR=postgres; producción exige declarar el motor. Con NODE_ENV=test sólo se aceptan hosts locales.
- Adaptador común, tipos Con/ConTx, variantes SQL explícitas, parámetros numerados y RETURNING id compatible con MySQL. Transacciones con cliente exclusivo, rollback, liberación y reintentos acotados.
- PostgreSQL 17: 17 tablas, 34 FK, 23 índices secundarios y 11 índices únicos; dos triggers de inmutabilidad y ocho de actualizado_en. Siete CHECK de negocio por nombre y restricciones técnicas adicionales. Se preservó el orden de columnas.
- Verificación de arranque por motor, nombres de CHECK y triggers habilitados. Tamaño PostgreSQL visible en verificar, con avisos al 60/80 % del presupuesto.
- Presencia con caché y condición SQL de 10 s, sin cachear autenticación. Consulta rápida sin transacción cuando no hay órdenes. Caducidad cada 15 s. No se cambia firmware ni el sondeo seguro de 3 s.
- SPA opcional bajo el mismo origen; assets con hash inmutables, HTML revalidable y API sin fallback HTML. Script inicial de tema externo para CSP estricta; Google Fonts limitado a sus dos hosts; HSTS y upgrade sólo en producción.
- TRUST_PROXY admite IP/CIDR, alias y saltos:1..3. Diagnóstico desactivado por defecto, con caducidad en producción. Login 5/min por IP+email más 30/min por IP. Logout conserva los atributos de cookie; JWT y SameSite=Strict no se relajan.
- Seed sintético idempotente para una base PostgreSQL vacía, sin datos del origen ni secretos locales, con control DESHABILITADO, órdenes vacías, telemetría 15 s y sondeo 3 s.
- Arneses con entorno explícito sin dotenv, bases temporales locales, humo del servidor compilado y eliminación limitada a la carpeta temporal propia.

## Dependencias
Se instalaron únicamente las tres nuevas dependencias autorizadas por C-0.6: pg 8.16.3, @types/pg 8.15.5 y embedded-postgres 17.5.0-beta.15. Locks actualizados; sin npm audit fix. engines admite >=22.12.0 <25; las ejecuciones observadas usan Node 24.14.1, no Node 22.

## Límites
La retención/purga de mediciones no está implementada ni habilitada: C-9.4 exige autorización explícita de DELETE. Tampoco se migraron datos, crearon servicios o modificaron secretos reales. El valor de seguridad en plantillas es false; los tests heredados con permiso habilitado sólo lo cambian en memoria dentro del arnés y están nombrados encendido-habilitado-simulado.

## Archivos
Lista completa, estado y SHA-256 en archivos-modificados.json. La línea base inicial cubre sólo parte del árbol; los archivos existentes sin hash inicial se identifican como tales y no se confunden con archivos nuevos. No se incluyen README, configuraciones ni artefactos preexistentes sin evidencia de cambios.

- backend/.env.example
- backend/.env.production.example
- backend/package-lock.json
- backend/package.json
- backend/scripts/build-cloud.mjs
- backend/scripts/cambiar-contrasena.ts
- backend/scripts/comprobar-config-produccion.mjs
- backend/scripts/comprobar-demo.ts
- backend/scripts/copiar-runtime.mjs
- backend/scripts/entorno-pruebas.mjs
- backend/scripts/escanear-secretos.mjs
- backend/scripts/humo-temporal.mjs
- backend/scripts/pruebas-con-bd-temporal.mjs
- backend/scripts/pruebas-con-pg-temporal.mjs
- backend/scripts/seed-demo.ts
- backend/scripts/seed.ts
- backend/scripts/start-cloud.mjs
- backend/scripts/validar-trust-proxy.mjs
- backend/scripts/validar-trust-proxy.test.mjs
- backend/scripts/verificar-entorno.ts
- backend/src/app.ts
- backend/src/config.ts
- backend/src/db.ts
- backend/src/demo.ts
- backend/src/errores.ts
- backend/src/frontend.ts
- backend/src/middlewares/seguridad.ts
- backend/src/modulos/auth.ts
- backend/src/modulos/iot.ts
- backend/src/modulos/panel.ts
- backend/src/modulos/servicio.ts
- backend/src/presencia.ts
- backend/src/server.ts
- backend/src/tareas.ts
- backend/src/util/registro.ts
- backend/src/util/sql.ts
- backend/src/util/trust-proxy.d.mts
- backend/src/util/trust-proxy.mjs
- backend/src/verificacion.ts
- backend/tests/ayudas.ts
- backend/tests/integracion.test.ts
- backend/tests/iot.test.ts
- backend/tests/panel.test.ts
- backend/tests/portabilidad.test.ts
- backend/tests/restricciones.test.ts
- backend/tests/safe/cloud.test.ts
- backend/tests/safe/config.test.ts
- backend/tests/safe/iot-fast.test.ts
- backend/tests/safe/postgres-config.test.ts
- backend/tests/safe/presencia.test.ts
- backend/tests/safe/sql.test.ts
- backend/tests/seguridad.test.ts
- backend/tsconfig.build.json
- backend/vitest.safe.config.ts
- database/postgres/schema.sql
- frontend/index.html
- frontend/package-lock.json
- frontend/package.json
- frontend/public/tema-inicial.js
- frontend/scripts/validar-despliegue.mjs
- frontend/scripts/validar-despliegue.test.mjs
- frontend/vite.config.ts
- frontend/vitest.config.ts

## Reanudación para presentación local

H-06 confirmado corregido mediante build:cloud y arranque aislado del backend compilado. Se añadieron demo:local y demo:comprobar; se probó el navegador con login, cookies Secure/HttpOnly/Strict, recarga y logout. El frontend DEMO quedó iniciado en 127.0.0.1:5173 y se revisó en escritorio/390 px. Ver GUIA_PRESENTACION_LOCAL.md y resultados-verificacion.json. No se repitieron las suites completas anteriores ni se usó MySQL real, hardware o nube.
