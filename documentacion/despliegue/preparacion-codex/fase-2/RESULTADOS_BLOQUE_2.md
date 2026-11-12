# Resultados bloque 2

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Estado
Implementado y build probado; Node 22 y recorrido HTTPS real pendientes. No aprobado automáticamente.

## Comandos y resultados
Resultados: typecheck/build 0; frontend 83/83 (0); MySQL 178/178 y PostgreSQL 178/178 (0); firmware 12/13 (1); escáner 7 coincidencias (1); audit ejecución 6 paquetes afectados (1). Ver PRUEBAS_Y_RESULTADOS.md y resultados-verificacion.json: comandos reproducibles, códigos y totales. Los intentos intermedios fallidos y correcciones se describen allí.

## Desviaciones y límites
Node 24.14.1 validado, Node 22 pendiente; seed inicial sin dispositivo usa advisory lock; la importación local usa pg en transacción en lugar de psql. Publicación bloqueada por seguridad/revisión. El bloque 5 no autoriza DELETE.

## Archivos y SHA-256

- backend/package-lock.json — b2c3d79a0f4fd4bbd1507bfa99f63a5d687deb061f97bc7dd1b01ca3f8d9f5e8
- backend/package.json — 1b108dcd3c3fa076a74f624c81bf131ddd4e74c7a09d6ae12fe96d9f2927ffc9
- backend/scripts/build-cloud.mjs — a6521de8517e0dcb9288a5415ad3f222a21aceb238352c6be576487060583493
- backend/scripts/copiar-runtime.mjs — 2ccbac8d93e1ab92e8fc9f43a3a3a74da2177fb0a9a03952b7be94b5d8295740
- backend/scripts/humo-temporal.mjs — 780e2e790f1ac15d23ec173ed40e13ea0b17c9cb919d3f12c597cb25b7a75331
- backend/scripts/start-cloud.mjs — 8fc78e278f61bef4c57be3e9a996cfc1df975b561224ae2374f9f4ab5db2f4e1
- backend/src/app.ts — 44094b2722136b26a45700c67a131a02a6072c3fae72bb70c899829dd22f5ff9
- backend/src/frontend.ts — 825c1db4ed36ff3fe96c97cb319ae8badf6e6e5ae71c54b4af51297987a555c7
- backend/tests/safe/cloud.test.ts — 736b22add0fb599ed55274b0e361e8ad35ce988ed055bc5bb2a29ae931df4248
- backend/tsconfig.build.json — 4b9ae38e819453c436080aeeab131c4d1baf771b01a850e71e029674650600f4
- frontend/index.html — 10b1cd0a7c83d7fbe7059edad8a2aefdb4e251d0d7d6c69e6accd3d5eb9fa32c
- frontend/package-lock.json — cd2be6d8666ec9db4cd4dccf1eebee8251c3a769fde22fc872b9a24bd52fecf1
- frontend/package.json — 1a5ff7c7e85547cd98171ec762b147d26dbd8a22ebb64ca387c27dc233e0b6f1
- frontend/public/tema-inicial.js — 28f5ea6d3cb82a26a179942db2e026b0a7245db009da942e93c80fa9e41aba6b
- frontend/scripts/validar-despliegue.mjs — 8a8e24690d2d5043d467b987019d05410c050d72afa812b9796dbf8726acffda
- frontend/scripts/validar-despliegue.test.mjs — d68a5d2b5a4abc2030d4de4910e089d7f4189a008dabdba3da4e92545b061784
- frontend/vite.config.ts — d4b8bee84956d1ba60a6f4f922da11b3d24e140fd61179cff93e095fc35dc0d9
- frontend/vitest.config.ts — 5f16b4ae2ea7b3d8e51f8acd041e6bd5413ed52bb73c49f783cf0865d19cd01c
