# Adaptador PostgreSQL

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Selección e interfaz
backend/src/db.ts exporta bd, filas, fila, ejecutar, transaccion, bloquearDispositivo, cerrarBd, Con, ConTx y sqlPorMotor. Ningún módulo funcional importa mysql2 o pg ni llama query directamente. DB_MOTOR=mysql es el valor local por defecto; en producción debe declararse explícitamente.

El SQL común conserva ?. Las variantes se eligen expresamente con sqlPorMotor. El traductor léxico ignora literales simples, comillas dobles, comentarios y literales dollar-quoted; rechaza operadores JSONB ?/ ?| / ?& cubiertos por pruebas. No intenta transformar automáticamente SQL desconocido en tiempo de ejecución.

ejecutar devuelve affectedRows e insertId. PostgreSQL usa rowCount y obtiene id sólo de un RETURNING id final. MySQL retira ese sufijo y conserva ResultSetHeader.insertId. INSERT IGNORE conserva su comportamiento MySQL; PostgreSQL usa ON CONFLICT con columnas únicas concretas y no silencia FK o CHECK.

## Tipos, sesiones y TLS
Parsers locales al pool: int8 a número seguro (rechaza fuera de ±2^53−1), numeric a número finito, fechas a Date, JSONB a objeto. No se alteran parsers globales. Los NUMERIC de coordenadas y área conservan la semántica decimalNumbers del origen; no se promete aritmética decimal arbitraria.

Cada cliente PostgreSQL nuevo ejecuta SET TimeZone, SET statement_timeout y SET lock_timeout antes de la consulta o BEGIN. Se espera su terminación; un WeakSet evita repetirlos por consulta. Se usa pooling en modo sesión. No se depende de options de inicio del pooler ni de sentencias preparadas con nombre.

En producción se exige DB_SSL y CA PEM. Se retiran sslmode/sslcert/sslkey/sslrootcert de la URL antes de construir el pool, para que la URL no reemplace el objeto ssl verificado. Nunca se usa rejectUnauthorized=false. La prueba unitaria comprueba esta precedencia; no se ha ensayado TLS real de Supabase. [Interacción documentada por node-postgres](https://node-postgres.com/features/ssl).

## Transacciones y errores
PostgreSQL usa READ COMMITTED. Cada transacción conserva su cliente hasta commit/rollback y release. Se reintenta completa un máximo de tres veces ante 40P01/40001; no ante 55P03/57014. MySQL conserva ER_LOCK_DEADLOCK/ER_LOCK_WAIT_TIMEOUT. Se comprueba rollback repetido y que IDs consumidos no se reutilicen.

El dispositivo se bloquea antes de órdenes/control/calibración/ACK; los IDs de dispositivo para control/calibración se resuelven antes de la transacción y se vuelven a acotar en la consulta bloqueante. La inicialización demo usa un advisory lock antes de crear un dispositivo inexistente: excepción necesaria y documentada al primer bloqueo de dispositivo.

FOR UPDATE OF o y OF a,cc evitan bloquear el lado nullable. La cancelación bloquea primero el dispositivo. La recuperación de unicidad de idempotencia ocurre después del rollback, nunca dentro de una transacción abortada. Los errores de disponibilidad se mapean a 503; P0001 se registra como INMUTABILIDAD_VIOLADA sin detalles SQL.

## Validación pendiente
La equivalencia de respuestas entre dos ejecuciones de la suite se comprobó por sus aserciones. La comparación independiente V-API-01 de todas las respuestas y las pruebas de roles de propietario/aplicación corresponden a la revisión de arquitectura; no se presentan como ejecutadas aquí.
