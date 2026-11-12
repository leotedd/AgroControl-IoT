# Esquema PostgreSQL

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Archivo e importación
Archivo separado: database/postgres/schema.sql. No se cambió database/schema.sql ni el importador MySQL. Se importa en una base vacía con transacción y fallo ante error; los arneses lo hicieron mediante pg, equivalente a agrupar la importación en BEGIN/COMMIT. El comando psql futuro es:

```text
psql --single-transaction -v ON_ERROR_STOP=1 --file=database/postgres/schema.sql
```

No ejecutarlo contra una base real en esta fase. No contiene instrucciones destructivas ni mecanismos para saltarse triggers. La segunda importación debe fallar por objetos existentes; no es un migrador idempotente.

## Estructura
17 tablas, mismo orden de columnas, 34 FK, 23 índices ix_* y 11 índices únicos. Nombres, nulabilidad, relaciones y acciones del origen se conservan. Identity BY DEFAULT sustituye AUTO_INCREMENT. PK/FK de INT pasan a INTEGER por decisión de arquitectura, con capacidad menor que INT UNSIGNED; no hay importación histórica en esta fase. Los otros unsigned tienen restricciones de rango. Booleanos siguen como 0/1, ENUM como TEXT con CHECK, fechas TIMESTAMPTZ(3), JSONB y NUMERIC. Email tiene índice único sobre lower(email).

Los siete CHECK de negocio son: ck_dispositivos_intervalos, ck_dispositivos_tope, ck_sensores_calibracion, ck_cc_histeresis, ck_cc_rangos, ck_ordenes_ttl y ck_ordenes_duracion. Las restricciones técnicas usan ck_enum_, ck_rango_ y ck_bool_. MySQL TINYINT por sí solo no garantiza 0/1: PostgreSQL es más estricto en ese aspecto, sin modificar el origen.

## Inmutabilidad
fn_ordenes_inmutables traduce las cláusulas (a)–(e): identidad y contenido, escritura única, terminales, primer ACK y contadores no decrecientes. fn_ordenes_sin_borrado rechaza borrado directo. Igualdad nula con IS NOT DISTINCT FROM; errores P0001. No hay bypass por profundidad de trigger o variable de sesión.

En PostgreSQL las acciones referenciales disparan estos triggers: borrar un usuario/dispositivo con órdenes puede fallar. Se conserva la regla aprobada de baja lógica, sin desactivar protección para permitir cascadas. Se probaron rechazo del borrado de padres y baja lógica, además de los casos de inmutabilidad.

Ocho triggers adicionales mantienen actualizado_en en usuarios, terrenos, cultivos, zonas, dispositivos, sensores, actuadores y configuraciones_control. La función sólo toca la fecha cuando la fila cambia; usa clock_timestamp para reflejar la actualización efectiva.

## Demo
src/demo.ts y scripts/seed-demo.ts preparan una finca, zona, cultivo, dispositivo ficticio, HUM1, BOMBA1, administrador @demo.invalid y doce lecturas deterministas. No hay órdenes ni hardware confirmado. La contraseña llega por DEMO_ADMIN_CONTRASENA temporal y nunca se imprime; el hash del token ficticio se genera sin publicar un token operativo.

La inicialización exige base vacía o su propia demo existente. La transacción y advisory lock serializan inicializaciones; repetirla no cambia la contraseña ni duplica filas. El arnés usa una segunda base temporal para ensayarlo sin contaminar los fixtures de regresión. No se conectó con Supabase.
