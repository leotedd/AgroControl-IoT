# PLAN PRUEBAS

Fecha: 2026-11-08. Estado: propuesta para revisión de arquitectura; sin implementar migración.

## Ejecutadas sin BD ni hardware
| Comando desde carpeta indicada | Resultado |
|---|---|
| backend: node scripts/validar-trust-proxy.test.mjs | PASS, 37 casos |
| backend: node node_modules/typescript/bin/tsc --noEmit | PASS, salida 0 sin diagnósticos |
| frontend: node scripts/validar-despliegue.test.mjs | PASS, 10 casos |
| frontend: node node_modules/typescript/bin/tsc --noEmit | PASS, salida 0 sin diagnósticos |
| raíz: python -B tests/firmware/test_artifacts.py | 13 pruebas, 12 PASS y 1 FAIL |

El fallo test_diagnostic_provenance_and_invalid_display exige el literal calibration_source=%s config_version=%lu relay=UNTOUCHED; AgroControl.ino contiene relay=%s y usa runtime.relay.status(). Es una discrepancia de expectativa textual, no prueba de activación o seguridad física. No se corrigieron tests ni firmware. Las otras aserciones posteriores de esa misma prueba no se ejecutan al fallar la primera. Typecheck no demuestra compilación de producción ni integración PostgreSQL.

## No ejecutadas y motivo
- npm test del backend / Vitest directo: fixtures escriben SQL y varias pruebas habilitan PERMITIR_ENCENDIDO en memoria. El wrapper además inicializa/elimina MySQL temporal fuera del directorio autorizado. No se ejecutó ninguna inicialización, tampoco temporal.
- npm test frontend: pruebas con fetch simulado disponibles, pero runner Vite/Vitest puede generar cachés/configuración temporal fuera del único directorio autorizado. Se priorizaron pruebas puras existentes y typecheck sin emisión.
- npm run build: genera dist fuera del directorio autorizado; comprobar-config-produccion.mjs necesita ese artefacto y se deja pendiente.
- verificar, db:seed --simular: aunque sus consultas sean de lectura, se omite conexión a origen real y uso de .env.
- run_checks.py escribe tests/firmware/build; HTTPS fixture, compilación Arduino, pruebas físicas, simulador, prueba HTTP y Playwright test2026 quedan fuera de ejecución autorizada. No se contactó ESP32.

## Matriz propuesta para una fase aislada autorizada
| área | Evidencia de aceptación |
|---|---|
| Adaptador | Parámetros numerados, RETURNING, rowCount, cliente transaccional, rollback y liberación ante errores |
| Tipos | JSON, NULL, booleanos, decimal exacto, IDs al límite seguro y UTC/milisegundos; contrato sin bigint serializado como objeto |
| SQL | Historial crudo/agregado, paginación, intervalo TTL, calibración, arranques y UPDATE FROM |
| Esquema | 17 tablas, equivalencia de siete CHECK y nuevas restricciones, índices/FKs, política de cascadas aprobada |
| Triggers | Identidad, escritura única, terminales, ACK inmutable, contadores y rechazo de DELETE directo |
| Carreras | Mismo idempotency-key, secuencias repetidas, ACK simultáneo/tardío/conflictivo, reinicio, entrega ordenada y deadlock |
| Seguridad | Encendido rechazado con bandera false, rearmado controlado, roles por terreno, token inválido y límites |
| Autenticación web | Login/refresh/logout reales en navegador sobre HTTPS; rotación concurrente y cookie con proxy elegido |
| Proxy/CORS | Origin exacto, preflight, IP real y rechazo de X-Forwarded-Proto falsificado fuera de proxy |
| Resiliencia | Caída BD/TLS, pool agotado, reinicio hosting, SIGTERM y tareas con una o múltiples réplicas |
| Respaldo | Restauración ensayada y manifiesto/hash canónico coincidente en snapshot estable |
| ESP32 | Fixture sin hardware, URL /api/v1, CA, reloj, timeout y deduplicación; no enviar comandos a equipo real |

Separar futura suite de control habilitado en un proceso de laboratorio sin hardware y aprobación explícita; la suite de preparación mantiene siempre false. No habilitar bandera sólo para obtener tests verdes. Detener avance si hay diferencias de datos, contratos, certificados o inmutabilidad sin resolver. Aprobación de arquitectura es puerta obligatoria antes de implementar.
