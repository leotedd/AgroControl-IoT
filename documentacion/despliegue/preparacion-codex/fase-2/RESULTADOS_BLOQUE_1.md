# Resultados bloque 1

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Estado
Implementado para revisión; escaneo con coincidencias pendientes. No aprobado automáticamente.

## Comandos y resultados
Resultados: typecheck/build 0; frontend 83/83 (0); MySQL 178/178 y PostgreSQL 178/178 (0); firmware 12/13 (1); escáner 7 coincidencias (1); audit ejecución 6 paquetes afectados (1). Ver PRUEBAS_Y_RESULTADOS.md y resultados-verificacion.json: comandos reproducibles, códigos y totales. Los intentos intermedios fallidos y correcciones se describen allí.

## Desviaciones y límites
Node 24.14.1 validado, Node 22 pendiente; seed inicial sin dispositivo usa advisory lock; la importación local usa pg en transacción en lugar de psql. Publicación bloqueada por seguridad/revisión. El bloque 5 no autoriza DELETE.

## Archivos y SHA-256

- backend/.env.example — 0bb23536f45b766779274f6729458a4e9bfff403423d2ea6158b3b955e54d302
- backend/.env.production.example — bbc2d95372b6b3a38a97499b89bb23e34a77270d833f53b8783df4108b3a2f6f
- backend/scripts/comprobar-config-produccion.mjs — 9d67e74669ff9697d8e4add72bfa6596913e33fd9b674f45ae923d4a057ff2c1
- backend/scripts/escanear-secretos.mjs — 69dd8ccf39359034f07c6d66424544422d7f5ff5645e13c1e89be8ca6880d339
- backend/scripts/validar-trust-proxy.mjs — 74de2e9755f9ea0dfbdf728787d8c8dad5738062b2f73dc2646632e02e72c06c
- backend/scripts/validar-trust-proxy.test.mjs — a7f89d0f53a3070d4a2a2622d1a799299892771807f3acf70d14c813d4cfea93
- backend/src/config.ts — 3dcf243e9de179aed0692d985d40f887e5912a6e676e1199ec6c70260764c431
- backend/src/middlewares/seguridad.ts — 8bfdebd5ad96db10f786a129b408601a9f49b7b4d7d628b111f0b3f5d38fa518
- backend/src/modulos/auth.ts — 163911c26600e0ce28317026f44aa40cc1216ea4643fa25a9edeaf6831f3fe21
- backend/src/presencia.ts — e03a6d014b015c9237dc5795250fbf0a8eb35385e9e282ef86f7e3a1cc103a1c
- backend/src/tareas.ts — ab1caaf24c385fc68d84e0a1e2e56527985267968b1b14678fe819d71f725a19
- backend/src/util/trust-proxy.d.mts — e0ab28ed7d39f7940e2d6db442350c78ebe68dc3b1eb56c1d0107480356681e7
- backend/src/util/trust-proxy.mjs — d0d4228fb9b23d7212737f07acd4c741d74bcd991e848826a5294577041eaa47
- backend/tests/safe/cloud.test.ts — 736b22add0fb599ed55274b0e361e8ad35ce988ed055bc5bb2a29ae931df4248
- backend/tests/safe/config.test.ts — f54cf83529e82385020d112a96ead1e849d24952812819e543a5e09f543efcbb
- backend/tests/safe/iot-fast.test.ts — b83172da7876b5b5aa66419e57799b2752f48e7c655da2c9aec7b159bf55f17a
- backend/tests/safe/postgres-config.test.ts — e89bc988a96379c36a02cd62bcce777ec62128fb9a1d5b223ac5124aeb27cc7a
- backend/tests/safe/presencia.test.ts — 550427428e35d611ed65729d796d88e568ea20ca57fff7f417db6d768bb6e2a0
- backend/tests/safe/sql.test.ts — b154f20d0bffb1fdd43bbd76317892415fdf0d1241f1f4a96aad6f756550ee16
- backend/tests/seguridad.test.ts — 6f9c8d12bb007ed38147bba841ad0a950422985a73b40cf01947ce2517ac5b22
- backend/tsconfig.build.json — 4b9ae38e819453c436080aeeab131c4d1baf771b01a850e71e029674650600f4
- backend/vitest.safe.config.ts — 2f5fce61bbc5f9f850adac7602e15c244bfd7f0e21ebe7792bb361ba7a15c0b5
- frontend/vite.config.ts — d4b8bee84956d1ba60a6f4f922da11b3d24e140fd61179cff93e095fc35dc0d9
- frontend/vitest.config.ts — 5f16b4ae2ea7b3d8e51f8acd041e6bd5413ed52bb73c49f783cf0865d19cd01c
