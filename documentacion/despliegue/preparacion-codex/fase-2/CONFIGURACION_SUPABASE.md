# Configuración Supabase

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Preparado, sin conexión real
Destino: base NUEVA sintética, PostgreSQL estándar 17. No se implementó migración de datos MySQL. No se necesita Supabase Auth ni claves anon/service_role en frontend o ESP32.

La aplicación persistente usa el pooler Supavisor en modo SESIÓN, elegido por arquitectura, con acceso IPv4 si la conexión directa IPv6 no está disponible. Obtener hostname, puerto, base y usuario del panel cuando esté autorizado; no asumir el host o usuario de un proyecto. [Conexiones oficiales](https://supabase.com/docs/guides/database/connecting-to-postgres).

DATABASE_URL sólo vive en el entorno privado del backend. DB_SSL=true y DB_SSL_CA con CA PEM válida. pg retira opciones SSL de la URL para impedir que sustituyan la validación explícita. Las pruebas verifican la configuración; el certificado/hostname del proveedor no se comprobó porque no se contactó con Supabase. TimeZone y timeouts se establecen por conexión antes de consultas, compatibles con sesiones persistentes; no elegir pooler de transacciones sin rediseñar esto.

## Roles y superficie expuesta
DDL sólo con agro_owner; ejecución con agro_app y privilegios comentados al final del esquema: uso del esquema/secuencias, SELECT/INSERT/UPDATE y DELETE únicamente en las tablas ya autorizadas. No conceder DELETE en mediciones, órdenes ni histórico. Revisar exposición de PostgREST y política de RLS con arquitectura antes de crear el esquema real; no improvisar BYPASSRLS ni usar un rol propietario para la operación normal.

## Secuencia futura, requiere autorización
1. Resolver los pendientes de seguridad y obtener aprobación independiente de los bloques.
2. Crear el proyecto, seleccionar región/versión/plan y verificar coste cero y límites reales en la cuenta.
3. Crear roles mínimos y una base/esquema vacío; importar schema.sql con transacción y ON_ERROR_STOP.
4. Configurar secretos nuevos y CA; verificar sólo lectura con el rol de aplicación.
5. Inicializar demo mediante script autorizado, con contraseña nueva temporal y flags --aplicar y --confirmar-host exacto. No reutilizar .env local. No hay token de ESP32 publicado por este seed; cualquier aprovisionamiento físico será otra fase.
6. Retirar la variable de contraseña del seed, ejecutar pruebas de humo contra la demo y validar cookies/TLS desde navegador.
7. Establecer respaldos externos y ensayo de restauración antes de aceptar datos de valor.

## Capacidad
La página Free consultada indica 500 MB de base, 5 GB de egress y pausa tras una semana sin actividad. Estos límites no prueban que una instalación concreta sea gratis ni sustituyen medición. [Precios oficiales](https://supabase.com/pricing).

La optimización conserva órdenes a 3 s por el lease de 4 s del firmware. Presencia se limita a 10 s y la demo transmite telemetría cada 15 s. Los eventos/ACK no se muestrean. La purga histórica no está habilitada: medir crecimiento y planear retención con autorización explícita. No se promete capacidad indefinida gratuita.

## Comando de seed, sólo tras autorización
Con el entorno PostgreSQL autorizado ya inyectado de forma privada y sin cargar el .env local:

```text
node backend/dist/scripts/seed-demo.js --aplicar --confirmar-host=<host exacto autorizado>
```

El script no imprime la URL, contraseña ni token. Esta instrucción no autoriza ejecutarlo contra Supabase ahora.
