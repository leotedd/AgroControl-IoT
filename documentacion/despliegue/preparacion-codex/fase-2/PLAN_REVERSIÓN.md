# Plan de reversión

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Antes de desplegar
No se migró ni cambió la MySQL original. El esquema PostgreSQL es un archivo aparte y los tests sólo tocaron instancias temporales. Para continuar localmente, mantener el entorno actual; DB_MOTOR=mysql es el valor por defecto fuera de producción. SERVIR_FRONTEND vacío conserva API sola. Si se usa NODE_ENV=production con MySQL, declarar DB_MOTOR=mysql explícitamente.

## Cambios de código reversibles
La lista completa de archivos y hashes está en archivos-modificados.json; la línea base conserva hashes, no copias completas. No ejecutar git reset/clean: el árbol contiene carpetas no rastreadas y se perdería trabajo compartido. Cualquier reversión de archivos debe hacerse de forma selectiva desde una copia que el usuario verifique, preservando trabajo concurrente.

## Al autorizar un despliegue futuro
La demo cloud es separada del entorno local. Detener el backend cloud, conservar evidencia/backup de la demo y regresar a los parámetros locales MySQL no requiere convertir datos de la base original. No hay doble escritura.

Si después se generan datos de valor en PostgreSQL, volver al backend local no los copia automáticamente: congelar ingreso, respaldar, conciliar datos y aprobar un plan específico. Esta fase no entrega migrador inverso ni promete retorno sin pérdida.

## Hardware y secretos
No se aprovisionó URL/CA/token en ESP32 ni se flasheó. No hay cambio físico que revertir. Si en otra fase se cambia su aprovisionamiento, restaurarlo requerirá autorización específica. Mantener PERMITIR_ENCENDIDO=false y todas las compuertas físicas existentes. No reutilizar secretos cloud en local ni viceversa.

## Respaldo
El diseño de respaldo de Fase 1 continúa como referencia. No se creó dump de datos reales. Un respaldo cloud futuro deberá almacenarse fuera del repositorio, cifrado, con roles y restauración ensayada en instancia aislada. Ninguna reversión elimina la única copia válida.
