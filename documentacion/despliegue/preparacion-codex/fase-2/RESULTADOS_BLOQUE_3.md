# Resultados bloque 3

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Estado
Implementado; importación y arranque locales probados. No aprobado automáticamente.

## Comandos y resultados
Resultados: typecheck/build 0; frontend 83/83 (0); MySQL 178/178 y PostgreSQL 178/178 (0); firmware 12/13 (1); escáner 7 coincidencias (1); audit ejecución 6 paquetes afectados (1). Ver PRUEBAS_Y_RESULTADOS.md y resultados-verificacion.json: comandos reproducibles, códigos y totales. Los intentos intermedios fallidos y correcciones se describen allí.

## Desviaciones y límites
Node 24.14.1 validado, Node 22 pendiente; seed inicial sin dispositivo usa advisory lock; la importación local usa pg en transacción en lugar de psql. Publicación bloqueada por seguridad/revisión. El bloque 5 no autoriza DELETE.

## Archivos y SHA-256

- backend/scripts/entorno-pruebas.mjs — 473aaafd8d69079e12d8caef326e4e4e4bd61c38f57d5359dd47f6a60b4ac9b6
- backend/scripts/pruebas-con-pg-temporal.mjs — bfbc4fc8a319110117c3ebd26acf13045026664dee5eff06a672d86e89988e05
- backend/src/db.ts — bdebc01d6add5b7c50f04e61d194bbb25026683b2ea4bc2275f531d673595bdf
- backend/src/util/sql.ts — ca92886fd2e704e65becc29a9a7afb6631df1002a74d2bf856543ce50dce28c0
- backend/src/verificacion.ts — 811d9de20069dcb71ab23a28fb3c931514d6c044291664a696dad6efb77ca4e0
- database/postgres/schema.sql — 0c249eb6e15726f74b17f582590781a36441e2c6d803e096ef50a8759fb7d008
