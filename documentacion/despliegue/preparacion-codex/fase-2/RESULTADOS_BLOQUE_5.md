# Resultados bloque 5

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Estado
Seed y tamaño implementados; retención y purga NO implementadas por C-9.4. No aprobado automáticamente.

## Comandos y resultados
Resultados: typecheck/build 0; frontend 83/83 (0); MySQL 178/178 y PostgreSQL 178/178 (0); firmware 12/13 (1); escáner 7 coincidencias (1); audit ejecución 6 paquetes afectados (1). Ver PRUEBAS_Y_RESULTADOS.md y resultados-verificacion.json: comandos reproducibles, códigos y totales. Los intentos intermedios fallidos y correcciones se describen allí.

## Desviaciones y límites
Node 24.14.1 validado, Node 22 pendiente; seed inicial sin dispositivo usa advisory lock; la importación local usa pg en transacción en lugar de psql. Publicación bloqueada por seguridad/revisión. El bloque 5 no autoriza DELETE.

## Archivos y SHA-256

- backend/scripts/comprobar-demo.ts — 11c19540473956b690e47500b82994be8944318d51f8799e82590524b92cb7b7
- backend/scripts/seed-demo.ts — 014143a0561591dd825527d290fe4b81f003b6f389d523b2ce0c705fcde77d19
- backend/src/demo.ts — 0394d322e9a58b73b619a45c91447722cfe2fc5f41038d772f16cdeddf42772a
- backend/src/verificacion.ts — 811d9de20069dcb71ab23a28fb3c931514d6c044291664a696dad6efb77ca4e0
