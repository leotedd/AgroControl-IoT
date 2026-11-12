# Resultados bloque 4

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Estado
Regresión de ambos motores ejecutada; matriz independiente pendiente. No aprobado automáticamente.

## Comandos y resultados
Resultados: typecheck/build 0; frontend 83/83 (0); MySQL 178/178 y PostgreSQL 178/178 (0); firmware 12/13 (1); escáner 7 coincidencias (1); audit ejecución 6 paquetes afectados (1). Ver PRUEBAS_Y_RESULTADOS.md y resultados-verificacion.json: comandos reproducibles, códigos y totales. Los intentos intermedios fallidos y correcciones se describen allí.

## Desviaciones y límites
Node 24.14.1 validado, Node 22 pendiente; seed inicial sin dispositivo usa advisory lock; la importación local usa pg en transacción en lugar de psql. Publicación bloqueada por seguridad/revisión. El bloque 5 no autoriza DELETE.

## Archivos y SHA-256

- backend/scripts/cambiar-contrasena.ts — b33d31643fa84fef4ef8ccd9184745d0e853a58204acff479b7a096a78620869
- backend/scripts/pruebas-con-bd-temporal.mjs — 8bdc0af08704cbde1d90e7117d962369fd6de82c7e7698cf6bc41373ce8c265f
- backend/scripts/seed.ts — 7f2becb843ff933adbd63bfaa83c436300755f866eb6169353eb0b8ebdbcfe75
- backend/src/modulos/auth.ts — 163911c26600e0ce28317026f44aa40cc1216ea4643fa25a9edeaf6831f3fe21
- backend/src/modulos/iot.ts — df974f3d9d60440e9c88c6472149299025b7a950fc894e3b0e122ada0377a111
- backend/src/modulos/panel.ts — f57881a7d464e3790c46ca9c196e453dc2e5caf930cb6cc497e5b3d81c649d11
- backend/src/modulos/servicio.ts — e11194c38db2dec8dc091dfde7a79d7cf39cbc399a85e00d2bf8c7d4e812d557
- backend/tests/ayudas.ts — 0112e4c0f51d67230fa4dd1cc1e3ad42bbf4fdc0f6308712e2a4cd80ee237788
- backend/tests/integracion.test.ts — a4ac52a6fa6c91817b658ed1a64ad9a9100f249b95842117b3de7ba7f1bbd718
- backend/tests/iot.test.ts — fd637b568a3481d9471536c5b6b6aa9789583dbc4ea5cb5ab18b2d687d808fb9
- backend/tests/panel.test.ts — f6dce31921cfd470e0abaa7015c8ffb1def7f6483cb5f8b33c3cf2a55f848b6d
- backend/tests/portabilidad.test.ts — 819a375628672aa89f55c574d60e071547fdeba2ac8fd575d54b933fbce854c0
- backend/tests/restricciones.test.ts — a0edb453b555023d832a2da8a517b6481e1e5868d4aa59b9d8f2dc88858be147
- backend/tests/safe/cloud.test.ts — 736b22add0fb599ed55274b0e361e8ad35ce988ed055bc5bb2a29ae931df4248
- backend/tests/safe/config.test.ts — f54cf83529e82385020d112a96ead1e849d24952812819e543a5e09f543efcbb
- backend/tests/safe/iot-fast.test.ts — b83172da7876b5b5aa66419e57799b2752f48e7c655da2c9aec7b159bf55f17a
- backend/tests/safe/postgres-config.test.ts — e89bc988a96379c36a02cd62bcce777ec62128fb9a1d5b223ac5124aeb27cc7a
- backend/tests/safe/presencia.test.ts — 550427428e35d611ed65729d796d88e568ea20ca57fff7f417db6d768bb6e2a0
- backend/tests/safe/sql.test.ts — b154f20d0bffb1fdd43bbd76317892415fdf0d1241f1f4a96aad6f756550ee16
- backend/tests/seguridad.test.ts — 6f9c8d12bb007ed38147bba841ad0a950422985a73b40cf01947ce2517ac5b22
