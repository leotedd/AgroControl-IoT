# RESPALDO Y ROLLBACK

Fecha: 2026-11-08. Estado: propuesta para revisión de arquitectura; sin implementar migración.

## Diseño de respaldo (no ejecutado)
Crear en fase posterior un script con parámetros obligatorios: ruta absoluta del binario, host, puerto, base, ruta de opciones protegida y directorio de salida externo al repositorio. Rechazar marcadores, bases no aprobadas y sobreescritura de archivos. Registrar versión de herramientas y origen sin secretos. No cargar contraseñas desde este repositorio ni ponerlas en argumentos.

Plantilla del comando, para revisión; NO ejecutar en esta fase:
```text
mysqldump --defaults-extra-file=<archivo-privado> --host=<origen> --port=<puerto> --single-transaction --quick --skip-lock-tables --routines --triggers --events --hex-blob --default-character-set=utf8mb4 --no-tablespaces --set-gtid-purged=OFF --result-file=<salida.sql.part> <base>
```
Validar opciones con versión instalada antes del uso. --defaults-extra-file debe ser la primera opción. --result-file evita corrupción por redirección de texto de Windows PowerShell. No usar --force. Ante código distinto de cero, marcar fallido y no promover archivo parcial. Si termina bien, calcular SHA-256 y renombrar a nombre único final. Guardar ACL restrictiva, cifrar en almacenamiento aprobado y no publicar contenido ni hashes de tokens/contraseñas. El dump contiene hashes y datos sensibles aunque no tenga contraseñas de conexión.

single-transaction ofrece snapshot para InnoDB, no protege ante cambios DDL concurrentes. Confirmar motores y congelar DDL. Para un corte reproducible y comparar con conteos/hash, detener todos los escritores (backend, tareas, simuladores, dispositivos o su ingreso y scripts) antes de respaldo final. Una lectura posterior en otra conexión no comparte automáticamente el snapshot del dump. Para ensayos con tráfico activo, diseñar exportación y manifiesto en el mismo snapshot con herramienta dedicada; no afirmar igualdad usando conteos tomados a distintas horas.

## Verificación de integridad propuesta
Un verificador separado debe usar credenciales de sólo lectura y transacción read-only con snapshot coherente. Generar manifiesto privado, no volcar filas en logs:
1. Versión/motor/collation/UTC; DDL, índices únicos, FKs y acciones, CHECK por nombre y expresión, funciones y triggers.
2. Para cada una de las 17 tablas: COUNT(*), PK mín/máx, NULL por columnas relevantes, claves duplicadas y referencias huérfanas por cada FK (no sólo una muestra).
3. Hash por tabla y por lotes en orden de PK; para usuario_terreno usar su PK compuesta. Usar representación canónica por tipo: NULL explícito, números decimales exactos, timestamps UTC a milisegundo, JSON con claves ordenadas sin pérdida numérica, texto UTF-8 y campos con longitud prefijada. No usar CHECKSUM TABLE ni hashes de CSV con delimitadores ambiguos para comparar motores.
4. Verificar rangos unsigned/2^53-1, enum, JSON, colisiones de email/uid/códigos según nueva collation y fechas incompatibles.
5. Aplicar reglas de auditarConsistencia: versiones, control faltante, pertenencia sensor/dispositivo, zonas/terrenos y órdenes/ciclos abiertos; avisos temporales se calculan con la misma hora de referencia, no como hashes de datos cambiantes.
6. En copia restaurada: probar siete CHECK, restricciones adicionales, unicidad de secuencias/eventos, inmutabilidad de órdenes/ACK y cascadas. Confirmar secuencias PostgreSQL: siguiente ID mayor al máximo y comportamiento de tablas vacías.
7. Diferencias: fallo cerrado; emitir tabla/campo/regla y conteos sin valores sensibles. No reparar automáticamente.

Diseñar comandos psql de verificación con ON_ERROR_STOP, transacción READ ONLY y consultas generadas desde lista de tablas/FKs aprobada. Para PostgreSQL futuro: pg_dump en formato custom y pg_restore sólo en base vacía desechable, ambos con URL directa y secretos externos. Un dump MySQL es para restauración MySQL; no es una migración PostgreSQL ejecutable.

## Restauración y reversión
Antes del corte: restaurar dump en instancia MySQL aislada con versión compatible y probar esquema, datos e integridad. Dado el trigger anti-DELETE, no restaurar encima de tablas pobladas ni borrar datos para hacer sitio. Medir duración real, tamaño y latencia; RPO/RTO quedan pendientes de esas mediciones y aprobación operativa.

| Momento | Reversión prevista |
|---|---|
| Preparación documental | Retirar sólo documentos propios si se solicita; ningún cambio operativo |
| Desarrollo/staging | Detener copia de ensayo y conservar MySQL original |
| Corte sin nuevas escrituras destino | Detener nuevo backend, restaurar rutas/artefacto anterior, comprobar origen antes de reabrir ingreso |
| PostgreSQL ya recibió escrituras | Congelar ambos ingresos; exportar delta y reconciliar IDs, telemetría, ACK, tokens y órdenes; aprobar retorno y verificar integridad antes de reabrir |

No prometer rollback sin pérdida tras aceptar escrituras nuevas. No activar doble escritura sin diseño específico. Registrar instante de corte, versiones de artefactos, destino activo y último ACK/evento aceptado; evitar volver a entregar comandos antiguos desde una copia atrasada. Durante reversión y ensayo: PERMITIR_ENCENDIDO=false. Conservar evidencia del destino fallido y nunca reemplazar el único respaldo válido.
