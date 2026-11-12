# Pendientes de despliegue

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Bloquean publicación o aprobación global
1. Revisión independiente de arquitectura de los bloques y matriz V-*; estos informes no equivalen a aprobación. No modificar los documentos de Claude para marcarse aprobado.
2. Resolver los avisos de dependencias de ejecución y desarrollo. La auditoría de ejecución reporta seis paquetes afectados; no es aceptable llamar a este árbol listo para exposición pública sin revisión.
3. Revisar coincidencias del escáner en documentos protegidos y código de rotación. No publicar ejemplos con forma de credencial hasta que su carácter ficticio esté confirmado o se sustituyan con autorización.
4. Validar Node 22 solicitado por arquitectura o aprobar Node 24.14.1, que fue la versión utilizada. Confirmar versión PostgreSQL 17 y parche del proveedor; el motor embedded de laboratorio no determina el parche de producción.
5. Medir TRUST_PROXY, comprobar TLS del pooler con CA y rol mínimo y probar cookies en navegador móvil real bajo HTTPS. Ninguna de esas pruebas locales demuestra el recorrido real de la nube.
6. Decidir exposición de Supabase/PostgREST/RLS y crear roles sin capacidad para desactivar triggers. No se creó infraestructura.

## Requieren autorización adicional
- Creación de servicios Render/Supabase, secretos nuevos e importación a una base de demostración real.
- Cualquier aprovisionamiento/flasheo/prueba física de ESP32. No se pide activar la bomba.
- Permiso DELETE en mediciones y ejecución del bloque 5 de retención. C-9.4 exige confirmación explícita. Propuesta concreta: agregar sólo horas cerradas de crudo anterior a 30 días, idempotencia por sensor/hora, purga de lotes <=5000 sólo tras verificar agregados y auditoría; no tocar eventos, ACK, órdenes, alertas ni arranques. No existe tarea de purga activa.

## Revisión técnica pendiente
Completar la evidencia independiente de todos los V-* (comparación integral de API, roles y navegador), medición de tráfico de 10 minutos y latencia bajo frío. La suite local cubre las rutas originales y casos nuevos, pero no agota cada combinación de la matriz. Revisar índices para carga histórica real y retención antes de proyectar meses de coste cero.

La discrepancia textual del firmware queda documentada; cualquier corrección pertenece a una fase de firmware revisada. No se modifica una prueba sólo para obtener verde.

## Orden futuro
Revisión/saneamiento → aprobación de arquitectura → autorización de recursos → proyecto vacío y roles → importación/seed sintético → despliegue mismo origen → medición TLS/proxy/cookies → observación de cuotas → autorización separada de hardware si procede.

La purga de tokens_refresco (C-9.9) y la retención/agregación histórica del bloque 5 no se programaron; no hay borrados automáticos nuevos. La prueba de tamaño y el seed sí están disponibles.
