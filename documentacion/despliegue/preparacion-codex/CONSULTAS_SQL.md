# CONSULTAS SQL

Fecha: 2026-11-08. Estado: propuesta para revisión de arquitectura; sin implementar migración.

## Alcance
Catálogo estático de backend/src, backend/scripts y backend/tests. No se ejecutó SQL. Las ubicaciones son referencias de esta inspección, no conteo de consultas únicas: una llamada puede ocupar varias líneas y las plantillas pueden generar SQL dinámico. Consultar el bloque completo en el archivo fuente para parámetros y ramas.

## Traducciones propuestas
| Patrón | Tratamiento futuro |
|---|---|
| ? y listas IN dinámicas | $1..$n; numerar por sentencia, no reemplazar dentro de strings/comments |
| INSERT y insertId | INSERT ... RETURNING id y normalización segura |
| affectedRows | rowCount/RETURNING, revisar semántica de no-op y duplicados |
| INSERT IGNORE | ON CONFLICT (clave específica) DO NOTHING; no ignorar CHECK/FK |
| NOW(3), INTERVAL ? SECOND/DAY/HOUR/MINUTE | CURRENT_TIMESTAMP(3) o statement_timestamp según instante requerido, más $n * interval '1 second' etc.; now() PostgreSQL fija inicio de transacción |
| IF(cond,a,b) | CASE WHEN ... THEN ... ELSE ... END |
| TIMESTAMPDIFF(SECOND,a,b) | trunc(EXTRACT(EPOCH FROM (b-a))) con política de negativos validada |
| UPDATE ciclos_riego c JOIN actuadores a | UPDATE ciclos_riego AS c SET ... FROM actuadores a WHERE ... |
| UNIX_TIMESTAMP(medido_en) | EXTRACT(EPOCH FROM medido_en); probar buckets UTC y límites |
| SET time_zone, DATABASE(), information_schema MySQL | Configuración UTC y catálogos PostgreSQL por schema explícito |
| FOR UPDATE en JOIN/LEFT JOIN | Seleccionar tablas a bloquear; revisar filas nullable y orden de bloqueo |
| ER_* | Mapear SQLSTATE de PostgreSQL y no ocultar violaciones de integridad como disponibilidad |

GROUP BY de buckets y LIMIT parametrizado se conservan con sintaxis adecuada. SELECT, JOIN, GREATEST y agregaciones sencillas pueden ser portables, pero requieren adaptar parámetros y tipos. No se observó ON DUPLICATE KEY UPDATE en el backend inspeccionado. Los campos JSON se serializan con JSON.stringify y se leen a veces como string o como objeto: preservar contrato en ambos caminos.

## Objetos DDL
Ver database/schema.sql: 17 CREATE TABLE, siete CHECK, índices y FKs, ocho columnas con actualización automática y dos CREATE TRIGGER. Los cuerpos incluyen <=>, SIGNAL y DELIMITER; requieren funciones PL/pgSQL y decisión explícita sobre cascadas. Ver PREPARACION_POSTGRESQL.md.

## Ubicaciones de SQL y acoplamiento

### backend/src/app.ts

```text
54: await fila(bd(), 'SELECT 1 AS ok')
```

### backend/src/db.ts

```text
1: import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
24: con.query("SET time_zone = '+00:00'")
52: const REINTENTABLES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])
79: const d = await fila(con, 'SELECT * FROM dispositivos WHERE id = ? FOR UPDATE', [dispositivoId])
```

### backend/src/errores.ts

```text
77: const caido = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_CON_COUNT_ERROR'].includes(codigoBd ?? '')
```

### backend/src/middlewares/seguridad.ts

```text
55: `SELECT id, terreno_id, uid, estado, token_hash, token_anterior_hash, id_arranque_actual
65: await ejecutar(bd(), 'UPDATE dispositivos SET token_anterior_hash = NULL, token_anterior_expira_en = NULL WHERE id = ?', [d.id])
70: await ejecutar(bd(), 'UPDATE dispositivos SET ultima_conexion_en = NOW(3), ultima_ip = ? WHERE id = ?', [req.ip ?? null, d.id])
80: await ejecutar(con, 'INSERT IGNORE INTO arranques_dispositivo (dispositivo_id, id_arranque) VALUES (?, ?)', [dispositivoId, arranque])
83: `UPDATE ordenes_riego
90: `UPDATE ciclos_riego c JOIN actuadores a ON a.id = c.actuador_id
96: await ejecutar(con, 'UPDATE dispositivos SET id_arranque_actual = ?, arranque_detectado_en = NOW(3) WHERE id = ?', [arranque, dispositivoId])
102: datos: { anterior: d.id_arranque_actual, nuevo: arranque, ordenes_sin_confirmar: sinConfirmar.affectedRows },
143: const r = await fila(bd(), 'SELECT rol FROM usuario_terreno WHERE usuario_id = ? AND terreno_id = ?', [u.id, terrenoId])
151: ? filas(bd(), "SELECT t.*, 'PROPIETARIO' AS rol FROM terrenos t WHERE t.activo = 1 ORDER BY t.id")
152: : filas(bd(), 'SELECT t.*, ut.rol FROM terrenos t JOIN usuario_terreno ut ON ut.terreno_id = t.id WHERE ut.usuario_id = ? AND t.activo = 1 ORDER BY t.id', [u.id])
```

### backend/src/modulos/auth.ts

```text
26: 'INSERT INTO tokens_refresco (usuario_id, token_hash, familia, expira_en, user_agent, ip) VALUES (?, ?, ?, NOW(3) + INTERVAL ? DAY, ?, ?)',
46: const u = await fila(bd(), 'SELECT * FROM usuarios WHERE email = ?', [c.email.toLowerCase()])
55: await ejecutar(bd(), 'UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = IF(? > 0, NOW(3) + INTERVAL ? MINUTE, NULL) WHERE id = ?', [n, bloqueoMin, bloqueoMin, u.id])
61: await ejecutar(bd(), 'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso_en = NOW(3) WHERE id = ?', [u.id])
73: const t = await fila(bd(), 'SELECT * FROM tokens_refresco WHERE token_hash = ?', [sha256(token)])
77: await ejecutar(bd(), 'UPDATE tokens_refresco SET revocado_en = NOW(3) WHERE familia = ? AND revocado_en IS NULL', [t.familia])
81: const u = await fila(bd(), 'SELECT * FROM usuarios WHERE id = ? AND activo = 1', [t.usuario_id])
83: await ejecutar(bd(), 'UPDATE tokens_refresco SET usado_en = NOW(3) WHERE id = ?', [t.id])
93: if (typeof token === 'string' && /^[A-Za-z0-9_-]{64}$/.test(token)) await ejecutar(bd(), 'UPDATE tokens_refresco SET revocado_en = NOW(3) WHERE token_hash = ? AND revocado_en IS NULL', [sha256(token)])
103: const u = await fila(bd(), 'SELECT id, nombre, email, rol FROM usuarios WHERE id = ?', [req.usuario!.id])
```

### backend/src/modulos/iot.ts

```text
2: import type { PoolConnection } from 'mysql2/promise'
123: const r = await filas(con, 'SELECT id, codigo, zona_id FROM actuadores WHERE dispositivo_id = ?', [dispositivoId])
132: `UPDATE actuadores SET modo_reportado = ?, estado_bomba = ?, riego_transcurrido_s = ?, riego_restante_s = ?, descanso_restante_s = ?,
159: const sensores = new Map((await filas(bd(), 'SELECT id, codigo FROM sensores WHERE dispositivo_id = ?', [dev.id])).map((s) => [s.codigo as string, s.id as number]))
180: `INSERT IGNORE INTO mediciones (sensor_id, valor, valor_raw, estado, medido_en, hora_estimada, id_arranque, seq, uptime_ms)
184: if (r.affectedRows === 0) {
191: `UPDATE sensores SET ultimo_valor = ?, ultimo_raw = ?, ultimo_estado = ?, ultima_lectura_en = ?
200: `UPDATE dispositivos SET version_firmware = ?, version_contrato = ?, config_version_aplicada = ?, uptime_ms = ?,
229: const d = await fila(bd(), 'SELECT config_version_deseada FROM dispositivos WHERE id = ?', [dev.id])
232: "SELECT COUNT(*) AS n FROM ordenes_riego WHERE dispositivo_id = ? AND expira_en > NOW(3) AND (estado = 'PENDIENTE' OR (estado = 'ENTREGADA' AND id_arranque_entrega = ?))",
252: "UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = 'ENCENDIDO_DESHABILITADO', cancelada_en = NOW(3) WHERE dispositivo_id = ? AND tipo = 'BOMBA_ENCENDER' AND estado = 'PENDIENTE' AND motivo_cierre IS NULL",
255: if (r.affectedRows) await auditar(con, { actor: 'SISTEMA', accion: 'ENCENDIDOS_CANCELADOS', entidad: 'dispositivo', entidadId: dev.id, datos: { motivo: 'PERMITIR_ENCENDIDO=false', ordenes: r.affectedRows } })
259: `SELECT o.*, a.codigo AS actuador_codigo FROM ordenes_riego o JOIN actuadores a ON a.id = o.actuador_id
263: ORDER BY o.actuador_id, o.id DESC FOR UPDATE`,
275: await ejecutar(con, "UPDATE ordenes_riego SET estado = 'ENTREGADA', entregada_en = NOW(3), id_arranque_entrega = ?, ultima_entrega_en = NOW(3), intentos_entrega = intentos_entrega + 1 WHERE id = ? AND estado = 'PENDIENTE'", [dev.idArranque, o.id])
276: else await ejecutar(con, 'UPDATE ordenes_riego SET ultima_entrega_en = NOW(3), intentos_entrega = intentos_entrega + 1 WHERE id = ?', [o.id])
307: const o = await fila(con, 'SELECT * FROM ordenes_riego WHERE id = ? AND dispositivo_id = ? FOR UPDATE', [id, dev.id])
320: await ejecutar(con, 'UPDATE ordenes_riego SET ack_conflictos = ack_conflictos + 1 WHERE id = ?', [id])
327: `UPDATE ordenes_riego SET estado = ?, resultado = ?, codigo_motivo = ?, mensaje = ?, duracion_aplicada_s = ?, ejecutada_en = ?,
338: const act = await fila(con, 'SELECT id FROM actuadores WHERE dispositivo_id = ? AND codigo = ?', [dev.id, a.estado_actuador.actuador])
381: await ejecutar(con, 'UPDATE dispositivos SET config_version_aplicada = GREATEST(config_version_aplicada, ?), config_aplicada_en = NOW(3) WHERE id = ?', [c.config_version, dev.id])
384: await ejecutar(con, 'UPDATE dispositivos SET config_rechazada_version = ?, config_rechazo_errores = ? WHERE id = ?', [c.config_version, JSON.stringify(c.errores), dev.id])
394: const d2 = await fila(con, 'SELECT config_version_aplicada FROM dispositivos WHERE id = ?', [dev.id])
416: `INSERT IGNORE INTO eventos_dispositivo (dispositivo_id, actuador_id, tipo, datos, ocurrido_en, hora_estimada, id_arranque, seq, uptime_ms)
420: if (r.affectedRows === 0) {
440: 'INSERT INTO ciclos_riego (actuador_id, zona_id, orden_id, id_arranque, origen, iniciado_en, duracion_programada_s, humedad_inicio_pct) VALUES (?, ?, (SELECT id FROM ordenes_riego WHERE id = ? AND dispositivo_id = ?), ?, ?, ?, ?, ?)',
448: `UPDATE ciclos_riego SET finalizado_en = ?, duracion_s = ?, motivo_fin = ?, humedad_fin_pct = ?
475: await ejecutar(bd(), 'UPDATE arranques_dispositivo SET motivo_reinicio = ?, version_firmware = ? WHERE dispositivo_id = ? AND id_arranque = ?', [
```

### backend/src/modulos/panel.ts

```text
14: const terrenoDeDispositivo = async (id: number) => (await fila(bd(), 'SELECT terreno_id FROM dispositivos WHERE id = ?', [id]))?.terreno_id
28: await exigirRol(req, (await fila(bd(), 'SELECT id FROM terrenos WHERE id = ?', [id]))?.id, 'LECTOR', 'RECURSO_NO_ENCONTRADO')
29: const ds = await filas(bd(), 'SELECT id, uid, nombre, estado, ultima_conexion_en FROM dispositivos WHERE terreno_id = ? ORDER BY id', [id])
40: const d = (await fila(bd(), 'SELECT * FROM dispositivos WHERE id = ?', [id]))!
44: const sensores = await filas(bd(), 'SELECT s.*, z.nombre AS zona_nombre FROM sensores s LEFT JOIN zonas z ON z.id = s.zona_id WHERE s.dispositivo_id = ? AND s.activo = 1 ORDER BY s.id', [id])
47: `SELECT a.*, cc.modo AS modo_configurado, cc.umbral_inicio_pct, cc.umbral_parada_pct, cc.riego_max_s, cc.descanso_min_s, cc.sensor_id,
53: const activas = await filas(bd(), "SELECT * FROM ordenes_riego WHERE dispositivo_id = ? AND estado IN ('PENDIENTE','ENTREGADA') ORDER BY id DESC", [id])
54: const alertas = await fila(bd(), "SELECT COUNT(*) AS n FROM alertas WHERE dispositivo_id = ? AND estado = 'ACTIVA'", [id])
163: `SELECT o.*, a.codigo AS actuador_codigo, u.nombre AS solicitante_nombre FROM ordenes_riego o
175: `SELECT o.*, a.codigo AS actuador_codigo, u.nombre AS solicitante_nombre, d.terreno_id FROM ordenes_riego o
198: const o = await fila(con, 'SELECT * FROM ordenes_riego WHERE id = ? FOR UPDATE', [id])
201: await con.query("UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = 'CANCELADA_POR_USUARIO', cancelada_en = NOW(3), cancelada_por = ? WHERE id = ? AND estado = 'PENDIENTE'", [req.usuario!.id, id])
226: const t = await fila(bd(), 'SELECT d.terreno_id FROM actuadores a JOIN dispositivos d ON d.id = a.dispositivo_id WHERE a.id = ?', [id])
247: const t = await fila(bd(), 'SELECT d.terreno_id FROM sensores s JOIN dispositivos d ON d.id = s.dispositivo_id WHERE s.id = ?', [id])
260: 'SELECT medido_en, valor, valor_raw, estado, hora_estimada FROM mediciones WHERE sensor_id = ? AND medido_en BETWEEN ? AND ? ORDER BY medido_en DESC LIMIT ?',
268: `SELECT FLOOR(UNIX_TIMESTAMP(medido_en) / ?) * ? AS inicio,
295: const ev = await filas(bd(), 'SELECT e.*, a.codigo AS actuador FROM eventos_dispositivo e LEFT JOIN actuadores a ON a.id = e.actuador_id WHERE e.dispositivo_id = ? ORDER BY e.ocurrido_en DESC, e.id DESC LIMIT 50', [id])
304: await exigirRol(req, (await fila(bd(), 'SELECT terreno_id FROM zonas WHERE id = ?', [id]))?.terreno_id, 'LECTOR', 'RECURSO_NO_ENCONTRADO')
305: const c = await filas(bd(), 'SELECT * FROM ciclos_riego WHERE zona_id = ? ORDER BY iniciado_en DESC LIMIT 40', [id])
326: const t = await fila(bd(), 'SELECT d.terreno_id FROM sensores s JOIN dispositivos d ON d.id = s.dispositivo_id WHERE s.id = ?', [id])
351: const a = await fila(bd(), 'SELECT terreno_id, estado FROM alertas WHERE id = ?', [id])
355: await bd().query("UPDATE alertas SET estado = 'RECONOCIDA', reconocida_por = ?, reconocida_en = NOW(3) WHERE id = ? AND estado = 'ACTIVA'", [req.usuario!.id, id])
356: else await bd().query("UPDATE alertas SET estado = 'RESUELTA', resuelta_en = NOW(3) WHERE id = ? AND estado <> 'RESUELTA'", [id])
372: `SELECT * FROM alertas WHERE terreno_id IN (${visibles.map(() => '?').join(',')}) ${estado ? 'AND estado = ?' : ''} ORDER BY creada_en DESC LIMIT 100`,
```

### backend/src/modulos/servicio.ts

```text
1: import type { PoolConnection } from 'mysql2/promise'
22: const d = await fila(con, 'SELECT * FROM dispositivos WHERE id = ?', [dispositivoId])
24: const sensores = await filas(con, 'SELECT * FROM sensores WHERE dispositivo_id = ? AND activo = 1 ORDER BY id', [dispositivoId])
27: `SELECT a.codigo AS actuador, s.codigo AS sensor, cc.*
58: await ejecutar(con, 'UPDATE dispositivos SET config_version_deseada = config_version_deseada + 1 WHERE id = ?', [dispositivoId])
71: const cc = await fila(con, 'SELECT modo FROM configuraciones_control WHERE actuador_id = ? FOR UPDATE', [actuadorId])
75: "UPDATE configuraciones_control SET modo = ?, modo_origen = 'SISTEMA', modo_motivo = 'RECONCILIACION', actualizado_por = NULL WHERE actuador_id = ?",
126: const previa = await fila(con, 'SELECT o.*, a.codigo AS actuador_codigo FROM ordenes_riego o JOIN actuadores a ON a.id = o.actuador_id WHERE o.solicitada_por = ? AND o.idempotency_key = ?', [p.usuarioId, p.idempotencia])
133: `SELECT a.*, cc.modo AS modo_configurado, cc.riego_max_s, cc.umbral_parada_pct, s.calibracion_confirmada
142: const activas = await filas(con, "SELECT * FROM ordenes_riego WHERE actuador_id = ? AND estado IN ('PENDIENTE','ENTREGADA') ORDER BY id", [act.id])
194: await ejecutar(con, "UPDATE configuraciones_control SET modo = 'MANUAL', modo_origen = 'SISTEMA', modo_motivo = 'ORDEN_APAGAR', actualizado_por = ? WHERE actuador_id = ?", [p.usuarioId, act.id])
202: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, origen, solicitada_por, idempotency_key, expira_en)
206: if (r.insertId > MAX_SEGURO) throw new Error('id de orden fuera del rango seguro')
209: await ejecutar(con, `UPDATE ordenes_riego SET cerrada_por_orden_id = ? WHERE id IN (${canceladas.map(() => '?').join(',')}) AND cerrada_por_orden_id IS NULL`, [r.insertId, ...canceladas])
210: await auditar(con, { usuarioId: p.usuarioId, accion: 'ORDEN_CREADA', entidad: 'orden', entidadId: r.insertId, datos: { tipo: p.tipo, parametros: p.parametros, canceladas }, ip: p.ip })
211: const nueva = await fila(con, 'SELECT o.*, a.codigo AS actuador_codigo FROM ordenes_riego o JOIN actuadores a ON a.id = o.actuador_id WHERE o.id = ?', [r.insertId])
225: const activa = await fila(con, "SELECT id FROM ordenes_riego WHERE actuador_id = ? AND tipo = 'BOMBA_APAGAR' AND estado IN ('PENDIENTE','ENTREGADA')", [actuadorId])
227: const pendientes = await filas(con, "SELECT id FROM ordenes_riego WHERE actuador_id = ? AND tipo = 'BOMBA_ENCENDER' AND estado = 'PENDIENTE'", [actuadorId])
232: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, origen, solicitada_por, expira_en)
237: await auditar(con, { actor: 'SISTEMA', accion: 'APAGADO_SEGURIDAD', entidad: 'orden', entidadId: r.insertId, datos: { transcurrido_s: transcurridoS, maximo_s: max } })
240: dispositivoId, tipo: 'ORDEN_FALLIDA', severidad: 'CRITICA', ordenId: r.insertId, clave: `APAGADO_SEGURIDAD:${r.insertId}`,
241: mensaje: `La bomba seguía encendida tras ${transcurridoS} s (máximo ${max} s). El servidor ordenó apagarla (#${r.insertId}).`,
243: return r.insertId
249: "UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = ?, cancelada_en = NOW(3), cancelada_por = ? WHERE id = ? AND estado = 'PENDIENTE'",
259: const s0 = await fila(con, 'SELECT dispositivo_id FROM sensores WHERE id = ?', [p.sensorId])
262: const s = (await fila(con, 'SELECT * FROM sensores WHERE id = ? FOR UPDATE', [p.sensorId]))!
276: `UPDATE sensores SET raw_seco = ?, raw_humedo = ?, calibracion_confirmada = ?,
283: const d = (await fila(con, 'SELECT config_version_deseada, config_version_aplicada FROM dispositivos WHERE id = ?', [s0.dispositivo_id]))!
294: `UPDATE dispositivos SET token_anterior_hash = IF(? > 0, token_hash, NULL), token_anterior_expira_en = IF(? > 0, NOW(3) + INTERVAL ? HOUR, NULL),
331: const a0 = await fila(con, 'SELECT dispositivo_id FROM actuadores WHERE id = ?', [p.actuadorId])
336: `SELECT a.*, cc.*, s.calibracion_confirmada FROM actuadores a
339: WHERE a.id = ? FOR UPDATE`,
373: `UPDATE configuraciones_control SET modo = ?, modo_origen = 'USUARIO', modo_motivo = NULL, umbral_inicio_pct = ?, umbral_parada_pct = ?,
380: const d2 = await fila(con, 'SELECT config_version_deseada, config_version_aplicada FROM dispositivos WHERE id = ?', [a0.dispositivo_id])
```

### backend/src/tareas.ts

```text
7: await ejecutar(bd(), "UPDATE ordenes_riego SET estado = 'EXPIRADA', motivo_cierre = 'VENCIDA_SIN_ENTREGA' WHERE estado = 'PENDIENTE' AND expira_en <= NOW(3) AND motivo_cierre IS NULL")
8: const sinAck = await filas(bd(), "SELECT id, dispositivo_id FROM ordenes_riego WHERE estado = 'ENTREGADA' AND expira_en + INTERVAL 30 SECOND <= NOW(3)")
10: const r = await ejecutar(bd(), "UPDATE ordenes_riego SET estado = 'SIN_CONFIRMAR', motivo_cierre = 'SIN_ACK' WHERE id = ? AND estado = 'ENTREGADA' AND motivo_cierre IS NULL", [o.id])
11: if (r.affectedRows)
18: const ds = await filas(bd(), "SELECT id, ultima_conexion_en FROM dispositivos WHERE estado = 'ACTIVO' AND ultima_conexion_en IS NOT NULL")
```

### backend/src/util/registro.ts

```text
32: const abierta = await fila(con, "SELECT id FROM alertas WHERE clave_dedup = ? AND estado <> 'RESUELTA' LIMIT 1", [clave])
36: `INSERT INTO alertas (terreno_id, dispositivo_id, orden_id, tipo, severidad, mensaje, datos, clave_dedup)
37: SELECT terreno_id, id, ?, ?, ?, ?, ?, ? FROM dispositivos WHERE id = ?`,
43: await ejecutar(con, "UPDATE alertas SET estado = 'RESUELTA', resuelta_en = NOW(3) WHERE clave_dedup = ? AND estado <> 'RESUELTA'", [clave])
51: await ejecutar(con, 'INSERT INTO auditoria (usuario_id, actor, accion, entidad, entidad_id, datos, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', [
```

### backend/src/verificacion.ts

```text
25: const v = await fila(con, 'SELECT VERSION() AS v, DATABASE() AS b')
26: const tablas = (await filas(con, 'SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1')).map((r) => String(r.n))
27: const triggers = (await filas(con, 'SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY 1')).map((r) => String(r.n))
28: const checks = Number((await fila(con, 'SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()'))!.n)
72: 'SELECT COUNT(*) AS n FROM dispositivos WHERE config_version_aplicada > config_version_deseada'],
74: 'SELECT COUNT(*) AS n FROM actuadores a LEFT JOIN configuraciones_control cc ON cc.actuador_id = a.id WHERE a.activo = 1 AND cc.actuador_id IS NULL'],
76: 'SELECT COUNT(*) AS n FROM configuraciones_control cc JOIN actuadores a ON a.id = cc.actuador_id JOIN sensores s ON s.id = cc.sensor_id WHERE s.dispositivo_id <> a.dispositivo_id'],
78: `SELECT (SELECT COUNT(*) FROM sensores s JOIN dispositivos d ON d.id = s.dispositivo_id JOIN zonas z ON z.id = s.zona_id WHERE z.terreno_id <> d.terreno_id)
79: + (SELECT COUNT(*) FROM actuadores a JOIN dispositivos d ON d.id = a.dispositivo_id JOIN zonas z ON z.id = a.zona_id WHERE z.terreno_id <> d.terreno_id) AS n`],
81: "SELECT COUNT(*) AS n FROM ordenes_riego WHERE estado IN ('PENDIENTE','ENTREGADA') AND expira_en < NOW(3) - INTERVAL 5 MINUTE"],
83: 'SELECT COUNT(*) AS n FROM ciclos_riego WHERE finalizado_en IS NULL AND iniciado_en < NOW(3) - INTERVAL 1 HOUR'],
85: 'SELECT COUNT(*) AS n FROM sensores WHERE activo = 1 AND calibracion_confirmada = 0'],
87: 'SELECT COUNT(*) AS n FROM dispositivos WHERE token_hash IS NULL'],
89: "SELECT COUNT(*) AS n FROM usuarios u LEFT JOIN usuario_terreno ut ON ut.usuario_id = u.id WHERE u.rol <> 'ADMIN' AND ut.usuario_id IS NULL"],
94: "SELECT COUNT(*) AS n FROM configuraciones_control WHERE modo = 'AUTOMATICO'"],
96: "SELECT COUNT(*) AS n FROM ordenes_riego WHERE tipo = 'BOMBA_ENCENDER' AND estado IN ('PENDIENTE','ENTREGADA')"],
107: const n = async (tabla: string) => Number((await fila(con, `SELECT COUNT(*) AS n FROM ${tabla}`))!.n)
116: uidSeedExiste: !!(await fila(con, 'SELECT id FROM dispositivos WHERE uid = ?', [UID_SEED])),
```

### backend/scripts/cambiar-contrasena.ts

```text
43: const u = await fila(bd(), 'SELECT id FROM usuarios WHERE email = ?', [email])
53: await ejecutar(con, 'UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [hash, u.id])
54: const r = await ejecutar(con, 'UPDATE tokens_refresco SET revocado_en = NOW(3) WHERE usuario_id = ? AND revocado_en IS NULL', [u.id])
55: await ejecutar(con, "INSERT INTO auditoria (usuario_id, actor, accion, entidad, entidad_id) VALUES (?, 'SISTEMA', 'CONTRASENA_CAMBIADA', 'usuarios', ?)", [u.id, String(u.id)])
56: return r.affectedRows
```

### backend/scripts/prueba-http.mjs

```text
1: // Pruebas HTTP con datos existentes: sólo SELECT; sin telemetría, órdenes ni ACK ficticios.
39: await comprobar('/auth/login', 403, { method: 'OPTIONS', headers: { Origin: origen, 'Access-Control-Request-Method': 'DELETE' } })
42: const u = await fila(bd(), "SELECT id, rol, nombre FROM usuarios WHERE activo = 1 AND rol = 'ADMIN' LIMIT 1")
46: const d = await fila(bd(), 'SELECT id, terreno_id FROM dispositivos ORDER BY id LIMIT 1')
52: const s = await fila(bd(), 'SELECT id, zona_id FROM sensores WHERE dispositivo_id = ? LIMIT 1', [d.id])
58: const o = await fila(bd(), 'SELECT id FROM ordenes_riego WHERE dispositivo_id = ? LIMIT 1', [d.id])
```

### backend/scripts/prueba-proxy-movil.mjs

```text
50: const u = await fila(bd(), "SELECT id, rol, nombre FROM usuarios WHERE activo=1 AND rol='ADMIN' LIMIT 1")
55: const cuenta = email && password && !password.startsWith('<') ? await fila(bd(), 'SELECT password_hash, activo, bloqueado_hasta FROM usuarios WHERE email=?', [email.toLowerCase()]) : null
69: const d = await fila(bd(), 'SELECT id,terreno_id FROM dispositivos LIMIT 1')
76: const s = await fila(bd(), 'SELECT id,zona_id FROM sensores WHERE dispositivo_id=? LIMIT 1', [d.id])
81: const o = await fila(bd(), 'SELECT id FROM ordenes_riego WHERE dispositivo_id=? LIMIT 1', [d.id])
```

### backend/scripts/pruebas-con-bd-temporal.mjs

```text
52: listo = spawnSync(mysql, [...cli, '-e', 'SELECT 1']).status === 0
56: spawnSync(mysql, [...cli, '-e', 'CREATE DATABASE agrocontrol'])
```

### backend/scripts/rotar-token.ts

```text
15: const d = await fila(bd(), 'SELECT id FROM dispositivos WHERE uid = ?', [uid])
```

### backend/scripts/seed.ts

```text
4: // Sólo INSERT: nunca actualiza ni borra. Se niega si ya hay usuarios, terrenos, dispositivos,
63: const u = await ejecutar(con, "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'ADMIN')", [nombre, email, hash])
64: const t = await ejecutar(con, "INSERT INTO terrenos (nombre, descripcion, creado_por) VALUES ('Terreno de pruebas', 'Banco de pruebas del prototipo', ?)", [u.insertId])
65: await ejecutar(con, "INSERT INTO usuario_terreno (usuario_id, terreno_id, rol) VALUES (?, ?, 'PROPIETARIO')", [u.insertId, t.insertId])
66: const c = await ejecutar(con, "INSERT INTO cultivos (terreno_id, nombre, estado) VALUES (?, 'Cultivo de prueba', 'ACTIVO')", [t.insertId])
67: const z = await ejecutar(con, "INSERT INTO zonas (terreno_id, cultivo_id, nombre) VALUES (?, ?, 'Cama 1')", [t.insertId, c.insertId])
70: "INSERT INTO dispositivos (terreno_id, uid, nombre, token_hash, token_prefijo, token_creado_en) VALUES (?, ?, 'ESP32 Banco', ?, ?, NOW(3))",
71: [t.insertId, UID_SEED, sha256(token), token.slice(0, 12)],
73: const s = await ejecutar(con, "INSERT INTO sensores (dispositivo_id, zona_id, codigo, tipo, modelo) VALUES (?, ?, 'HUM1', 'HUMEDAD_SUELO', 'Capacitivo D43')", [dsp.insertId, z.insertId])
74: const a = await ejecutar(con, "INSERT INTO actuadores (dispositivo_id, zona_id, codigo, tipo, descripcion) VALUES (?, ?, 'BOMBA1', 'BOMBA', 'Mini bomba (relé)')", [dsp.insertId, z.insertId])
75: await ejecutar(con, 'INSERT INTO configuraciones_control (actuador_id, sensor_id) VALUES (?, ?)', [a.insertId, s.insertId])
76: await ejecutar(con, "INSERT INTO auditoria (usuario_id, actor, accion, entidad, entidad_id) VALUES (?, 'SISTEMA', 'SEED', 'base', ?)", [u.insertId, esquema.base])
77: return { usuario: u.insertId, terreno: t.insertId, zona: z.insertId, dispositivo: dsp.insertId, sensor: s.insertId, actuador: a.insertId }
```

### backend/tests/ayudas.ts

```text
35: const r = await ejecutar(bd(), 'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)', [`U${n}`, `u${n}-${Math.random().toString(36).slice(2, 8)}@prueba.local`, hashClave, rol])
36: return (await fila(bd(), 'SELECT email FROM usuarios WHERE id = ?', [r.insertId]))!.email as string
38: const t = await ejecutar(bd(), 'INSERT INTO terrenos (nombre) VALUES (?)', [`T${n}`])
39: const otro = await ejecutar(bd(), 'INSERT INTO terrenos (nombre) VALUES (?)', [`Otro${n}`])
40: const z = await ejecutar(bd(), 'INSERT INTO zonas (terreno_id, nombre) VALUES (?, ?)', [t.insertId, 'Cama'])
42: const d = await ejecutar(bd(), 'INSERT INTO dispositivos (terreno_id, uid, nombre, token_hash, token_prefijo) VALUES (?, ?, ?, ?, ?)', [t.insertId, `AGC-${n}`, 'Prueba', sha256(token), token.slice(0, 12)])
43: const s = await ejecutar(bd(), "INSERT INTO sensores (dispositivo_id, zona_id, codigo, tipo, calibracion_confirmada) VALUES (?, ?, 'HUM1', 'HUMEDAD_SUELO', ?)", [d.insertId, z.insertId, op.calibrado === false ? 0 : 1])
44: const a = await ejecutar(bd(), "INSERT INTO actuadores (dispositivo_id, zona_id, codigo) VALUES (?, ?, 'BOMBA1')", [d.insertId, z.insertId])
45: await ejecutar(bd(), 'INSERT INTO configuraciones_control (actuador_id, sensor_id, modo) VALUES (?, ?, ?)', [a.insertId, s.insertId, op.modo ?? 'DESHABILITADO'])
49: const id = async (e: string) => (await fila(bd(), 'SELECT id FROM usuarios WHERE email = ?', [e]))!.id
50: await ejecutar(bd(), "INSERT INTO usuario_terreno VALUES (?, ?, 'PROPIETARIO', NOW(3)), (?, ?, 'LECTOR', NOW(3)), (?, ?, 'PROPIETARIO', NOW(3))", [
51: await id(propietario), t.insertId, await id(lector), t.insertId, await id(ajeno), otro.insertId,
53: return { terrenoId: t.insertId, dispositivoId: d.insertId, sensorId: s.insertId, actuadorId: a.insertId, zonaId: z.insertId, token, arranque: 'a1b2c3d4', propietario, lector, ajeno }
```

### backend/tests/integracion.test.ts

```text
27: expect((await fila(bd(), "SELECT COUNT(*) AS n FROM usuarios WHERE email = 'admin@prueba.local'"))!.n).toBe(0)
38: const v0 = (await fila(bd(), 'SELECT config_version_deseada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId]))!.v
```

### backend/tests/iot.test.ts

```text
37: await ejecutar(bd(), "UPDATE dispositivos SET estado = 'DESHABILITADO' WHERE id = ?", [e.dispositivoId])
60: const s = await fila(bd(), 'SELECT ultimo_valor FROM sensores WHERE id = ?', [e.sensorId])
62: const n = await fila(bd(), 'SELECT COUNT(*) AS n FROM mediciones WHERE sensor_id = ?', [e.sensorId])
86: const a = await fila(bd(), 'SELECT estado_bomba FROM actuadores WHERE id = ?', [e.actuadorId])
92: const d = await fila(bd(), 'SELECT config_version_deseada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId])
94: const cc = await fila(bd(), 'SELECT modo, modo_origen FROM configuraciones_control WHERE actuador_id = ?', [e.actuadorId])
96: const d2 = await fila(bd(), 'SELECT config_version_deseada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId])
103: const cc = await fila(bd(), 'SELECT modo FROM configuraciones_control WHERE actuador_id = ?', [e.actuadorId])
146: const o = await fila(bd(), 'SELECT ack_conflictos, resultado FROM ordenes_riego WHERE id = ?', [id])
192: const a = await fila(bd(), 'SELECT estado_bomba FROM actuadores WHERE id = ?', [e.actuadorId])
198: const r = await ejecutar(bd(), "INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en) VALUES (?, ?, 'BOMBA_APAGAR', '{}', 30, NOW(3) - INTERVAL 1 SECOND)", [e.dispositivoId, e.actuadorId])
200: expect((await fila(bd(), 'SELECT estado FROM ordenes_riego WHERE id = ?', [r.insertId]))!.estado).toBe('EXPIRADA')
201: const a = await iot(e, 'post', `/ordenes/${r.insertId}/confirmacion`).send(ack(e.arranque))
204: const alerta = await fila(bd(), "SELECT COUNT(*) AS n FROM alertas WHERE orden_id = ? AND tipo = 'ACK_INCOHERENTE'", [r.insertId])
224: const c = await fila(bd(), 'SELECT origen, motivo_fin, duracion_s FROM ciclos_riego WHERE actuador_id = ?', [e.actuadorId])
248: const fila1 = await fila(bd(), 'SELECT idempotency_key, ttl_s, origen FROM ordenes_riego WHERE id = ?', [c.body.data.id])
250: const act = await fila(bd(), 'SELECT bloqueo_tipo FROM actuadores WHERE id = ?', [e.actuadorId])
275: expect(await fila(bd(), "SELECT id FROM ordenes_riego WHERE dispositivo_id = ? AND tipo = 'BOMBA_APAGAR'", [e.dispositivoId])).toBeNull()
279: const apagados = await bd().query("SELECT id, origen, solicitada_por, estado FROM ordenes_riego WHERE dispositivo_id = ? AND tipo = 'BOMBA_APAGAR'", [e.dispositivoId])
285: const alerta = await fila(bd(), "SELECT severidad, mensaje FROM alertas WHERE dispositivo_id = ? AND clave_dedup = ?", [e.dispositivoId, `APAGADO_SEGURIDAD:${filasApagado[0].id}`])
287: const audit = await fila(bd(), "SELECT actor FROM auditoria WHERE accion = 'APAGADO_SEGURIDAD' AND entidad_id = ?", [String(filasApagado[0].id)])
296: const c = await fila(bd(), 'SELECT origen, duracion_programada_s, humedad_inicio_pct FROM ciclos_riego WHERE actuador_id = ?', [e.actuadorId])
```

### backend/tests/panel.test.ts

```text
157: expect((await fila(bd(), 'SELECT modo FROM configuraciones_control WHERE actuador_id = ?', [e.actuadorId]))!.modo).toBe('MANUAL')
```

### backend/tests/seguridad.test.ts

```text
13: const r = await ejecutar(bd(), "INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en) VALUES (?, ?, 'BOMBA_ENCENDER', '{\"duracion_s\":5}', 30, NOW(3) + INTERVAL 30 SECOND)", [e.dispositivoId, e.actuadorId])
17: const o = await fila(bd(), 'SELECT estado, motivo_cierre FROM ordenes_riego WHERE id = ?', [r.insertId])
23: await ejecutar(bd(), "INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en, estado, entregada_en, id_arranque_entrega) VALUES (?, ?, 'BOMBA_ENCENDER', '{\"duracion_s\":5}', 30, NOW(3) + INTERVAL 30 SECOND, 'ENTREGADA', NOW(3), ?)", [e.dispositivoId, e.actuadorId, e.arranque])
36: const cc = await fila(bd(), 'SELECT modo, modo_origen FROM configuraciones_control WHERE actuador_id = ?', [e.actuadorId])
52: const a = await fila(bd(), "SELECT COUNT(*) AS n FROM auditoria a JOIN usuarios u ON u.id = a.usuario_id WHERE a.accion = 'LOGIN_FALLIDO' AND u.email = ?", [e.propietario])
95: await ejecutar(bd(), 'UPDATE dispositivos SET config_version_aplicada = config_version_deseada + 5 WHERE id = ?', [e.dispositivoId])
96: const antes = await fila(bd(), 'SELECT config_version_aplicada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId])
102: const despues = await fila(bd(), 'SELECT config_version_aplicada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId])
104: await ejecutar(bd(), 'UPDATE dispositivos SET config_version_aplicada = 0 WHERE id = ?', [e.dispositivoId]) // restaura el escenario de prueba
```
