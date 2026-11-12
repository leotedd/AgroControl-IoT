# PREPARACION POSTGRESQL

Fecha: 2026-11-08. Estado: propuesta para revisión de arquitectura; sin implementar migración.

## Decisiones pendientes de arquitectura
No basta cambiar una URL. Aprobar driver y versión de PostgreSQL, tipos y normalización de resultados, aislamiento, política de borrado histórico, topología web y mecanismo de migración antes de editar código. Mantener contrato IoT 1.0.2 y PERMITIR_ENCENDIDO=false durante toda la transición.

## Inventario de esquema fuente
Tablas: usuarios, tokens_refresco, terrenos, usuario_terreno, cultivos, zonas, dispositivos, sensores, actuadores, configuraciones_control, mediciones, eventos_dispositivo, arranques_dispositivo, ordenes_riego, ciclos_riego, alertas, auditoria. Esto se verificó en DDL, no en un servidor real.

CHECK existentes: ck_dispositivos_intervalos, ck_dispositivos_tope, ck_sensores_calibracion, ck_cc_histeresis, ck_cc_rangos, ck_ordenes_ttl, ck_ordenes_duracion. Conservar expresiones, límites y comportamiento con NULL; no basta contar siete restricciones. Nuevas restricciones por unsigned pueden aumentar el total: adaptar verificacion.ts por identidad/definición, no por conteo rígido.

| MySQL | Propuesta a validar |
|---|---|
| AUTO_INCREMENT | Identity; cargar IDs originales y ajustar secuencias después |
| INT UNSIGNED | bigint o rango explícito; integer de PostgreSQL no cubre todo su rango |
| BIGINT UNSIGNED | bigint si los datos caben; numeric(20,0) si no; IDs API <= 2^53-1 |
| SMALLINT UNSIGNED | integer con CHECK 0..65535 donde corresponda |
| TINYINT con significado booleano | boolean y adaptación de comparaciones/serialización, o smallint temporal |
| DECIMAL(4,1) | numeric(4,1); conversión explícita a number sólo dentro de rango |
| DATETIME(3) UTC | timestamptz(3); interpretar origen explícitamente UTC |
| ENUM servidor | text + CHECK o tipos enum, decisión de evolución pendiente |
| VARCHAR reportado | Mantener extensible y validación existente |
| JSON | jsonb propuesto; comparar semántica de números, claves, NULL y ACK |
| ON UPDATE CURRENT_TIMESTAMP(3) | UPDATE explícito o trigger; cubrir ocho tablas que lo usan |
| KEY / UNIQUE KEY | CREATE INDEX / UNIQUE preservando columnas, orden y nulabilidad |
| utf8mb4_0900_ai_ci | Definir collation/normalización; probar mayúsculas, acentos y duplicados |
| USE, ENGINE, DELIMITER | Retirar del destino y reescribir funciones/triggers |

No convertir bigint/numeric globalmente a Number sin validación. pg suele entregar estos tipos como texto; mysql2 usa decimalNumbers y supportBigNumbers. Revisar comparaciones estrictas, incrementos, JWT sub y toda respuesta JSON. Para datos temporales, comprobar milisegundos y fechas no válidas del origen antes de importar.

## Integridad y concurrencia
Portar transacciones con cliente exclusivo del pool entre BEGIN/COMMIT/ROLLBACK. Conservar primer bloqueo sobre dispositivos y validar orden de bloqueos de órdenes/actuadores/configuración. PostgreSQL usa habitualmente READ COMMITTED frente al REPEATABLE READ habitual de InnoDB: decidir explícitamente y probar carreras de idempotencia, entrega y ACK. Reintentar transacción completa ante 40P01/40001; decidir política de timeout 55P03/57014 y no equiparar todos los fallos con un deadlock.

La consulta con LEFT JOIN y FOR UPDATE de actualizarControl requiere limitar bloqueo, por ejemplo FOR UPDATE OF a, cc: PostgreSQL puede rechazar bloquear el lado nullable del JOIN. Revisar todos los FOR UPDATE, no sólo traducir palabras.

INSERT IGNORE pasa a ON CONFLICT con objetivo único concreto. No silenciar errores CHECK/FK: PostgreSQL deja abortada la transacción después de un error, por lo que capturarlo y continuar no equivale a MySQL. Revisar affectedRows: PostgreSQL cuenta filas actualizadas incluso si el valor no cambia; deduplicación debe basarse en conflicto/RETURNING.

## Triggers críticos
trg_ordenes_inmutables protege identidad/contenido; escritura única; estados terminales; primer ACK; contadores no decrecientes. trg_ordenes_sin_borrado impide DELETE directo. Traducir igualdad nula <=> a IS NOT DISTINCT FROM y SIGNAL a RAISE EXCEPTION, con código de error controlado.

MySQL omite triggers en cascadas FK; PostgreSQL sí puede dispararlos en modificaciones referenciales. Una copia literal puede impedir borrar padres o SET NULL sobre solicitada_por/actuador/dispositivo y campos inmutables. Arquitectura debe resolver si se prohíbe borrado de padres y se usa baja lógica, o se diseña otra política auditada. No desactivar triggers para pasar pruebas ni usar profundidad de trigger como autorización genérica. Fuente: [comportamiento de triggers PostgreSQL](https://www.postgresql.org/docs/current/trigger-definition.html).

## Etapas y puertas
1. Revisión del plan por Claude y aprobación del responsable. Salida: decisiones anteriores resueltas.
2. Implementación en copia aislada autorizada, driver, adaptador, SQL, esquema nuevo y comprobaciones. MySQL original sigue intacto. Salida: pruebas sintéticas y contrato sin diferencias no aprobadas.
3. Respaldo y ensayo de importación en destino desechable autorizado; conteos, hashes canónicos, FKs, triggers, secuencias y tiempos. Salida: restauración demostrada y métricas aceptadas.
4. Staging Render/Neon autorizado sin hardware ni órdenes reales. Validar TLS, proxy, cookies, reintentos y reconexión.
5. Ventana de corte aprobada: detener todos los escritores, respaldo final coherente, carga, validación y único backend escritor. No entregar órdenes antiguas por accidente. Definir tratamiento de PENDIENTE/ENTREGADA y ACK retrasados con arquitectura; no corregirlos automáticamente.
6. Observación y aceptación explícita. Conservar MySQL y respaldo; no eliminar origen durante esta fase.

Rollback en cada puerta: volver al artefacto anterior sin tocar origen; después de nuevas escrituras en PostgreSQL requiere conciliación y recuperación de eventos/ACK, no sólo cambiar DNS. Ver RESPALDO_Y_ROLLBACK.md.
