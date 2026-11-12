# RESULTADOS PREPARACION

Fecha: 2026-11-08. Estado: propuesta para revisión de arquitectura; sin implementar migración.

## Resultado
Preparación técnica documental terminada. Migración y despliegue no implementados. Se crearon exclusivamente los siete documentos de esta carpeta. No se editó código, esquema, firmware, configuración real ni archivos de Claude; no hubo instalación, commits, push, conexión MySQL/Neon ni operaciones sobre bomba. No se leyó backend/.env. PERMITIR_ENCENDIDO no se modificó: false se conserva como política; el valor del proceso/entorno activo no fue inspeccionado ni se afirma haberlo validado.

## Hallazgos para arquitectura
1. MySQL está distribuido entre adaptador, SQL de módulos/scripts/tests, catálogos del arranque y tipos. DATABASE_URL no existe en el esquema de configuración actual; Neon no es sustitución directa.
2. DDL fuente contiene 17 tablas, dos triggers y siete CHECK; no se certificó estado de una base real.
3. Triggers de órdenes/ACK y acciones FK necesitan decisión de retención/baja lógica antes de portar: las cascadas pueden ejecutar triggers PostgreSQL y bloquear borrados legítimos del diseño MySQL.
4. Revisar rangos unsigned, bigint/numeric, UTC, JSON y collation; también LEFT JOIN con FOR UPDATE y consultas directas que evitan helpers.
5. El navegador depende de mismo origen y cookie Strict/Secure. Un frontend estático en otro dominio necesita diseño de proxy o cambios explícitos de autenticación.
6. TRUST_PROXY cuenta con prueba pura pero el validador no está integrado; determinar confianza real del proxy y revisar límites/tareas por réplica.
7. Backend inicia tareas escritoras al arrancar; jamás usar un despliegue de ensayo contra MySQL real.

## Evidencia de verificación
Typecheck backend y frontend: PASS. Pruebas puras: 37 de proxy y 10 de dominios PASS. Firmware estático: 12/13 PASS, con una discrepancia textual documentada en PLAN_PRUEBAS.md; sin prueba física ni activación. Las suites de integración y build quedan pendientes por alcance, no se presentan como aprobadas.

## Qué se puede hacer y qué necesita autorización
Seguro dentro de la fase actual: revisar estos inventarios, ampliar propuestas dentro de esta carpeta y repetir lecturas/typecheck sin emisión o pruebas puras que no escriban fuera ni cambien la bandera. El diseño de respaldo e integridad está preparado para revisión, no se ejecutó.

Requiere aprobación del plan de arquitectura y autorización de implementación: instalar driver, modificar adaptador/consultas/tests/configuración, crear esquema PostgreSQL, cambiar política de cascadas, crear servicios Render/Neon o recursos de pago y ejecutar migraciones incluso en Neon de ensayo. También autorizar salidas fuera de esta carpeta para build/cachés, inicialización de instancias temporales, ensayo de restauración, obtención/custodia de respaldos reales, ventana de corte y reversión operativa.

Cambiar secretos, aprovisionar URL/CA/token del ESP32, flashear o realizar pruebas físicas necesita alcance específico posterior. Activar la bomba o poner PERMITIR_ENCENDIDO=true no forma parte de esta preparación ni queda autorizado por aprobar una migración.

## índice
- INVENTARIO_DEPENDENCIAS.md: componentes y puntos de acoplamiento.
- CONSULTAS_SQL.md: catálogo de ubicaciones, fragmentos y equivalencias.
- PREPARACION_POSTGRESQL.md: tipos, integridad, decisiones y puertas de implementación.
- RESPALDO_Y_ROLLBACK.md: diseño de scripts, validación y límites de reversión.
- CONFIGURACION_RENDER_NEON.md: variables propuestas, HTTPS, cookies, proxy y ESP32.
- PLAN_PRUEBAS.md: resultados observados y validación futura.

La auditoría simultánea puede cambiar archivos después de esta inspección; las referencias de línea corresponden a la lectura de esta fecha. Claude decide la arquitectura; estos documentos son insumo técnico y no sustituyen su aprobación.
