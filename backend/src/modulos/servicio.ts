import { sqlPorMotor } from '../db.js'
import type { ConTx } from '../db.js'
import { config } from '../config.js'
import { bloquearDispositivo, ejecutar, fila, filas, type Con, type Fila } from '../db.js'
import { ErrorApi, conflicto } from '../errores.js'
import { MAX_SEGURO, RANGO_MODO, iso, nuevoTokenDispositivo, sha256, type Modo } from '../util/comun.js'
import { auditar, crearAlerta } from '../util/registro.js'

export const SEGUNDOS_EN_LINEA = 30
export const SEGUNDOS_INESTABLE = 120
export const TTL_POR_DEFECTO = { BOMBA_ENCENDER: 30, BOMBA_APAGAR: 300, RESTABLECER_BLOQUEO: 60 } as const
export const TTL_RANGO = { BOMBA_ENCENDER: [10, 60], BOMBA_APAGAR: [30, 900], RESTABLECER_BLOQUEO: [10, 300] } as const
export type TipoOrden = keyof typeof TTL_POR_DEFECTO

export function conexionDe(ultima: Date | null): 'EN_LINEA' | 'INESTABLE' | 'FUERA_DE_LINEA' {
  if (!ultima) return 'FUERA_DE_LINEA'
  const s = (Date.now() - new Date(ultima).getTime()) / 1000
  return s <= SEGUNDOS_EN_LINEA ? 'EN_LINEA' : s <= SEGUNDOS_INESTABLE ? 'INESTABLE' : 'FUERA_DE_LINEA'
}

/** Configuración deseada en el formato de GET /iot/configuracion (contrato §7.4). */
export async function configuracionDeseada(con: Con, dispositivoId: number) {
  const d = await fila(con, 'SELECT * FROM dispositivos WHERE id = ?', [dispositivoId])
  if (!d) throw new Error('dispositivo inexistente')
  const sensores = await filas(con, 'SELECT * FROM sensores WHERE dispositivo_id = ? AND activo = 1 ORDER BY id', [dispositivoId])
  const control = await filas(
    con,
    `SELECT a.codigo AS actuador, s.codigo AS sensor, cc.*
       FROM actuadores a
       JOIN configuraciones_control cc ON cc.actuador_id = a.id
       LEFT JOIN sensores s ON s.id = cc.sensor_id
      WHERE a.dispositivo_id = ? AND a.activo = 1 ORDER BY a.id`,
    [dispositivoId],
  )
  return {
    config_version: d.config_version_deseada as number,
    intervalo_telemetria_s: d.intervalo_telemetria_s,
    intervalo_ordenes_s: d.intervalo_ordenes_s,
    sensores: sensores.map((s) => ({
      sensor: s.codigo,
      tipo: s.tipo,
      raw_seco: s.raw_seco,
      raw_humedo: s.raw_humedo,
      calibracion_confirmada: !!s.calibracion_confirmada,
    })),
    control: control.map((c) => ({
      actuador: c.actuador,
      sensor: c.sensor,
      modo: c.modo,
      umbral_inicio_pct: Number(c.umbral_inicio_pct),
      umbral_parada_pct: Number(c.umbral_parada_pct),
      riego_max_s: c.riego_max_s,
      descanso_min_s: c.descanso_min_s,
    })),
  }
}

export async function incrementarVersion(con: ConTx, dispositivoId: number) {
  await ejecutar(con, 'UPDATE dispositivos SET config_version_deseada = config_version_deseada + 1 WHERE id = ?', [dispositivoId])
}

/**
 * Reconciliación (contrato §9.3): sólo desde telemetría fresca. Si la versión aplicada es la deseada
 * y el modo efectivo es MENOR que el deseado, se baja el deseado (nunca se sube).
 */
export async function reconciliarModo(con: ConTx, dispositivoId: number, versionAplicada: number, modosEfectivos: Map<number, string>) {
  const d = await bloquearDispositivo(con, dispositivoId)
  if (d.config_version_deseada !== versionAplicada) return
  let cambiado = false
  for (const [actuadorId, efectivo] of modosEfectivos) {
    if (!(efectivo in RANGO_MODO)) continue
    const cc = await fila(con, 'SELECT modo FROM configuraciones_control WHERE actuador_id = ? FOR UPDATE', [actuadorId])
    if (cc && RANGO_MODO[efectivo] < RANGO_MODO[cc.modo]) {
      await ejecutar(
        con,
        "UPDATE configuraciones_control SET modo = ?, modo_origen = 'SISTEMA', modo_motivo = 'RECONCILIACION', actualizado_por = NULL WHERE actuador_id = ?",
        [efectivo, actuadorId],
      )
      await auditar(con, { actor: 'SISTEMA', accion: 'MODO_RECONCILIADO', entidad: 'actuador', entidadId: actuadorId, datos: { de: cc.modo, a: efectivo } })
      cambiado = true
    }
  }
  if (cambiado) await incrementarVersion(con, dispositivoId)
}

export function serializarOrden(o: Fila, actuadorCodigo?: string) {
  return {
    id: Number(o.id),
    tipo: o.tipo,
    actuador: actuadorCodigo ?? o.actuador_codigo,
    parametros: typeof o.parametros === 'string' ? JSON.parse(o.parametros) : o.parametros,
    estado: o.estado,
    origen: o.origen,
    creada_en: iso(o.creada_en),
    expira_en: iso(o.expira_en),
    entregada_en: iso(o.entregada_en),
    confirmada_en: iso(o.confirmada_en),
    confirmacion_tardia: !!o.confirmacion_tardia,
    resultado: o.resultado ?? null,
    codigo_motivo: o.codigo_motivo ?? null,
    duracion_aplicada_s: o.duracion_aplicada_s ?? null,
    motivo_cierre: o.motivo_cierre ?? null,
    solicitada_por: o.solicitada_por ? { id: o.solicitada_por, nombre: o.solicitante_nombre ?? null } : null,
  }
}

/**
 * Creación de órdenes desde la web (contrato §8.2 y §11.4). Se ejecuta dentro de una transacción
 * que bloquea primero el dispositivo: serializa la creación y garantiza ids crecientes.
 */
export async function crearOrden(
  con: ConTx,
  p: {
    dispositivoId: number
    actuadorCodigo: string
    tipo: TipoOrden
    parametros: Record<string, unknown>
    ttlS?: number
    usuarioId: number
    idempotencia?: string
    ip?: string | null
  },
) {
  const d = await bloquearDispositivo(con, p.dispositivoId)

  if (p.idempotencia) {
    const previa = await fila(con, 'SELECT o.*, a.codigo AS actuador_codigo FROM ordenes_riego o JOIN actuadores a ON a.id = o.actuador_id WHERE o.solicitada_por = ? AND o.idempotency_key = ?', [p.usuarioId, p.idempotencia])
    if (previa) return { orden: serializarOrden(previa), canceladas: [] as number[], advertencias: [] as string[], repetida: true }
  }

  if (d.estado === 'DESHABILITADO') throw conflicto('DISPOSITIVO_DESHABILITADO', 'El dispositivo está deshabilitado.')
  const act = await fila(
    con,
    `SELECT a.*, cc.modo AS modo_configurado, cc.riego_max_s, cc.umbral_parada_pct, s.calibracion_confirmada
       FROM actuadores a
       LEFT JOIN configuraciones_control cc ON cc.actuador_id = a.id
       LEFT JOIN sensores s ON s.id = cc.sensor_id
      WHERE a.dispositivo_id = ? AND a.codigo = ? AND a.activo = 1`,
    [p.dispositivoId, p.actuadorCodigo],
  )
  if (!act) throw new ErrorApi(404, 'ACTUADOR_NO_ENCONTRADO', 'Actuador no encontrado en este dispositivo.')

  const activas = await filas(con, "SELECT * FROM ordenes_riego WHERE actuador_id = ? AND estado IN ('PENDIENTE','ENTREGADA') ORDER BY id", [act.id])
  const conexion = conexionDe(d.ultima_conexion_en)
  const advertencias: string[] = []
  const canceladas: number[] = []
  const [ttlMin, ttlMax] = TTL_RANGO[p.tipo]
  const ttl = p.ttlS ?? TTL_POR_DEFECTO[p.tipo]
  if (!Number.isInteger(ttl) || ttl < ttlMin || ttl > ttlMax)
    throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'ttl_s fuera de rango.', [{ campo: 'ttl_s', codigo: 'FUERA_DE_RANGO', mensaje: `Entre ${ttlMin} y ${ttlMax}.` }])

  if (p.tipo === 'BOMBA_ENCENDER') {
    // Bomba apagada por defecto: el encendido remoto exige habilitación explícita del servidor.
    if (!config().PERMITIR_ENCENDIDO)
      throw conflicto('ENCENDIDO_DESHABILITADO', 'El encendido remoto está deshabilitado en el servidor (PERMITIR_ENCENDIDO=false).')
    const dur = p.parametros.duracion_s
    if (typeof dur !== 'number' || !Number.isInteger(dur) || dur < 1 || dur > 600)
      throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'duracion_s inválida.', [{ campo: 'parametros.duracion_s', codigo: 'FUERA_DE_RANGO', mensaje: 'Entero entre 1 y 600.' }])
    if (conexion !== 'EN_LINEA') throw conflicto('DISPOSITIVO_FUERA_DE_LINEA', 'El ESP32 no está en línea.')
    if (act.modo_configurado !== 'MANUAL' || act.modo_reportado !== 'MANUAL')
      throw conflicto('MODO_NO_MANUAL', 'Encender sólo se permite en modo MANUAL (configurado y efectivo).')
    if (act.bloqueo_tipo) throw conflicto('BLOQUEO_ACTIVO', 'Hay un bloqueo de seguridad activo.')
    if (d.config_version_aplicada !== d.config_version_deseada) throw conflicto('CONFIG_NO_SINCRONIZADA', 'La configuración aún no se aplicó en el ESP32.')
    if (activas.some((o) => o.tipo === 'BOMBA_APAGAR')) throw conflicto('APAGADO_PENDIENTE', 'Hay un apagado pendiente.')
    if (!act.calibracion_confirmada) throw conflicto('CALIBRACION_NO_CONFIRMADA', 'La calibración del sensor no está confirmada.')
    if (!d.hardware_confirmado) throw conflicto('HARDWARE_NO_CONFIRMADO', 'El ESP32 no reporta hardware confirmado.')
    if (dur > act.riego_max_s) throw new ErrorApi(422, 'DURACION_EXCEDE_MAXIMO', `La duración supera riego_max_s (${act.riego_max_s} s).`)
    if (dur > config().ENCENDIDO_MAX_S)
      throw new ErrorApi(422, 'DURACION_EXCEDE_MAXIMO', `La duración supera el máximo de prueba del servidor (${config().ENCENDIDO_MAX_S} s).`)
    for (const o of activas)
      if (o.tipo === 'BOMBA_ENCENDER' && o.estado === 'PENDIENTE') {
        await cerrarPendiente(con, o.id, 'REEMPLAZADA', p.usuarioId)
        canceladas.push(o.id)
      }
  }

  if (p.tipo === 'RESTABLECER_BLOQUEO') {
    const { id_bloqueo, causa, inspeccion_confirmada } = p.parametros
    if (conexion !== 'EN_LINEA') throw conflicto('DISPOSITIVO_FUERA_DE_LINEA', 'El ESP32 no está en línea.')
    if (!act.bloqueo_tipo || Number(act.bloqueo_id) !== id_bloqueo || act.bloqueo_causa !== causa)
      throw conflicto('BLOQUEO_NO_COINCIDE', 'El bloqueo indicado no coincide con el último reportado.')
    if (!act.bloqueo_liberable_remoto) throw conflicto('BLOQUEO_NO_LIBERABLE_REMOTAMENTE', 'Este bloqueo sólo se rearma en el dispositivo.')
    if (act.bloqueo_tipo === 'PREVENTIVO' && inspeccion_confirmada !== true)
      throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'Debe confirmar la inspección física.', [{ campo: 'parametros.inspeccion_confirmada', codigo: 'REQUERIDO', mensaje: 'Debe ser true.' }])
  }

  if (p.tipo === 'BOMBA_APAGAR') {
    if (conexion !== 'EN_LINEA') advertencias.push('DISPOSITIVO_FUERA_DE_LINEA')
    for (const o of activas)
      if (o.estado === 'PENDIENTE') {
        await cerrarPendiente(con, o.id, o.tipo === 'BOMBA_APAGAR' ? 'REEMPLAZADA' : 'REEMPLAZADA_POR_APAGAR', p.usuarioId)
        canceladas.push(o.id)
      }
    if (act.modo_configurado === 'AUTOMATICO') {
      await ejecutar(con, "UPDATE configuraciones_control SET modo = 'MANUAL', modo_origen = 'SISTEMA', modo_motivo = 'ORDEN_APAGAR', actualizado_por = ? WHERE actuador_id = ?", [p.usuarioId, act.id])
      await incrementarVersion(con, p.dispositivoId)
      advertencias.push('MODO_CAMBIADO_A_MANUAL')
    }
  }

  const r = await ejecutar(
    con,
    sqlPorMotor({ mysql: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, origen, solicitada_por, idempotency_key, expira_en)
     VALUES (?, ?, ?, ?, ?, 'WEB', ?, ?, NOW(3) + INTERVAL ? SECOND) RETURNING id`, postgres: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, origen, solicitada_por, idempotency_key, expira_en)
     VALUES (?, ?, ?, ?, ?, 'WEB', ?, ?, now() + (? * interval '1 second')) RETURNING id` }),
    [p.dispositivoId, act.id, p.tipo, JSON.stringify(p.parametros), ttl, p.usuarioId, p.idempotencia ?? null, ttl],
  )
  if (r.insertId > MAX_SEGURO) throw new Error('id de orden fuera del rango seguro')
  // Cierra referencias de reemplazo (escritura única).
  if (canceladas.length)
    await ejecutar(con, `UPDATE ordenes_riego SET cerrada_por_orden_id = ? WHERE id IN (${canceladas.map(() => '?').join(',')}) AND cerrada_por_orden_id IS NULL`, [r.insertId, ...canceladas])
  await auditar(con, { usuarioId: p.usuarioId, accion: 'ORDEN_CREADA', entidad: 'orden', entidadId: r.insertId, datos: { tipo: p.tipo, parametros: p.parametros, canceladas }, ip: p.ip })
  const nueva = await fila(con, 'SELECT o.*, a.codigo AS actuador_codigo FROM ordenes_riego o JOIN actuadores a ON a.id = o.actuador_id WHERE o.id = ?', [r.insertId])
  return { orden: serializarOrden(nueva!), canceladas, advertencias, repetida: false }
}

/** Margen sobre ENCENDIDO_MAX_S antes de que el servidor ordene apagar (granularidad de la telemetría). */
export const MARGEN_APAGADO_SEGURIDAD_S = 3

/**
 * Apagado de seguridad del servidor: si la telemetría informa la bomba encendida más allá de
 * ENCENDIDO_MAX_S + margen, crea un BOMBA_APAGAR (origen SISTEMA) y una alerta crítica.
 * Es una defensa adicional: el ESP32 ya corta por duración. No crea nada si ya hay un APAGAR activo.
 */
export async function apagadoDeSeguridad(con: ConTx, dispositivoId: number, actuadorId: number, transcurridoS: number) {
  await bloquearDispositivo(con, dispositivoId)
  const activa = await fila(con, "SELECT id FROM ordenes_riego WHERE actuador_id = ? AND tipo = 'BOMBA_APAGAR' AND estado IN ('PENDIENTE','ENTREGADA')", [actuadorId])
  if (activa) return null
  const pendientes = await filas(con, "SELECT id FROM ordenes_riego WHERE actuador_id = ? AND tipo = 'BOMBA_ENCENDER' AND estado = 'PENDIENTE'", [actuadorId])
  for (const o of pendientes) await cerrarPendiente(con, o.id, 'REEMPLAZADA_POR_APAGAR', null)
  const ttl = TTL_POR_DEFECTO.BOMBA_APAGAR
  const r = await ejecutar(
    con,
    sqlPorMotor({ mysql: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, origen, solicitada_por, expira_en)
     VALUES (?, ?, 'BOMBA_APAGAR', '{}', ?, 'SISTEMA', NULL, NOW(3) + INTERVAL ? SECOND) RETURNING id`, postgres: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, origen, solicitada_por, expira_en)
     VALUES (?, ?, 'BOMBA_APAGAR', '{}', ?, 'SISTEMA', NULL, now() + (? * interval '1 second')) RETURNING id` }),
    [dispositivoId, actuadorId, ttl, ttl],
  )
  const max = config().ENCENDIDO_MAX_S
  await auditar(con, { actor: 'SISTEMA', accion: 'APAGADO_SEGURIDAD', entidad: 'orden', entidadId: r.insertId, datos: { transcurrido_s: transcurridoS, maximo_s: max } })
  await crearAlerta(con, {
    // Tipo existente del esquema (sin migración); el mensaje identifica el apagado de seguridad.
    dispositivoId, tipo: 'ORDEN_FALLIDA', severidad: 'CRITICA', ordenId: r.insertId, clave: `APAGADO_SEGURIDAD:${r.insertId}`,
    mensaje: `La bomba seguía encendida tras ${transcurridoS} s (máximo ${max} s). El servidor ordenó apagarla (#${r.insertId}).`,
  })
  return r.insertId
}

async function cerrarPendiente(con: ConTx, id: number, motivo: string, usuarioId: number | null) {
  await ejecutar(
    con,
    sqlPorMotor({ mysql: "UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = ?, cancelada_en = NOW(3), cancelada_por = ? WHERE id = ? AND estado = 'PENDIENTE'", postgres: `UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = ?, cancelada_en = now(), cancelada_por = ? WHERE id = ? AND estado = 'PENDIENTE'` }),
    [motivo, usuarioId, id],
  )
}

/** Calibración del sensor (contrato §7.4, §9.2): cambia la configuración deseada ⇒ nueva versión. */
export async function actualizarCalibracion(
  con: ConTx,
  p: { sensorId: number; dispositivoId: number; usuarioId: number; cambios: Partial<{ raw_seco: number; raw_humedo: number; calibracion_confirmada: boolean }>; ip?: string | null },
) {
  const s0 = { dispositivo_id: p.dispositivoId }
  await bloquearDispositivo(con, s0.dispositivo_id)
  const s = await fila(con, 'SELECT * FROM sensores WHERE id = ? AND dispositivo_id = ? FOR UPDATE', [p.sensorId, p.dispositivoId])
  if (!s) throw new ErrorApi(404, 'SENSOR_NO_ENCONTRADO', 'Sensor no encontrado.')
  const nuevo = {
    raw_seco: p.cambios.raw_seco ?? s.raw_seco,
    raw_humedo: p.cambios.raw_humedo ?? s.raw_humedo,
    calibracion_confirmada: p.cambios.calibracion_confirmada ?? !!s.calibracion_confirmada,
  }
  if (Math.abs(nuevo.raw_seco - nuevo.raw_humedo) < 200)
    throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'Calibración inválida.', [
      { campo: 'raw_humedo', codigo: 'CALIBRACION_INSUFICIENTE', mensaje: 'La diferencia entre seco y húmedo debe ser de al menos 200 cuentas.' },
    ])
  const iguales = nuevo.raw_seco === s.raw_seco && nuevo.raw_humedo === s.raw_humedo && nuevo.calibracion_confirmada === !!s.calibracion_confirmada
  if (!iguales) {
    await ejecutar(
      con,
      sqlPorMotor({ mysql: `UPDATE sensores SET raw_seco = ?, raw_humedo = ?, calibracion_confirmada = ?,
              calibrado_por = IF(?, ?, calibrado_por), calibrado_en = IF(?, NOW(3), calibrado_en) WHERE id = ?`, postgres: `UPDATE sensores SET raw_seco = ?, raw_humedo = ?, calibracion_confirmada = ?,
              calibrado_por = (CASE WHEN ?::boolean THEN ? ELSE calibrado_por END), calibrado_en = (CASE WHEN ?::boolean THEN now() ELSE calibrado_en END) WHERE id = ?` }),
      [nuevo.raw_seco, nuevo.raw_humedo, nuevo.calibracion_confirmada ? 1 : 0, nuevo.calibracion_confirmada, p.usuarioId, nuevo.calibracion_confirmada, p.sensorId],
    )
    await incrementarVersion(con, s0.dispositivo_id)
    await auditar(con, { usuarioId: p.usuarioId, accion: 'CALIBRACION_ACTUALIZADA', entidad: 'sensor', entidadId: p.sensorId, datos: nuevo, ip: p.ip })
  }
  const d = (await fila(con, 'SELECT config_version_deseada, config_version_aplicada FROM dispositivos WHERE id = ?', [s0.dispositivo_id]))!
  return { ...nuevo, config_version_deseada: d.config_version_deseada, config_version_aplicada: d.config_version_aplicada }
}

/** Rotación del token del dispositivo (contrato §5.1): el anterior vale durante la gracia (24 h por defecto). */
export async function rotarToken(con: ConTx, p: { dispositivoId: number; usuarioId: number | null; graciaHoras?: number; ip?: string | null }) {
  const d = await bloquearDispositivo(con, p.dispositivoId)
  const gracia = Math.max(0, Math.min(72, p.graciaHoras ?? 24))
  const token = nuevoTokenDispositivo()
  // Este orden coincide con MySQL (SET de izquierda a derecha) y PostgreSQL (fila antigua).
  await ejecutar(
    con,
    sqlPorMotor({ mysql: `UPDATE dispositivos SET token_anterior_hash = IF(? > 0, token_hash, NULL), token_anterior_expira_en = IF(? > 0, NOW(3) + INTERVAL ? HOUR, NULL),
            token_hash = ?, token_prefijo = ?, token_creado_en = NOW(3) WHERE id = ?`, postgres: `UPDATE dispositivos SET token_anterior_hash = (CASE WHEN ? > 0 THEN token_hash ELSE NULL END), token_anterior_expira_en = (CASE WHEN ? > 0 THEN now() + (? * interval '1 hour') ELSE NULL END),
            token_hash = ?, token_prefijo = ?, token_creado_en = now() WHERE id = ?` }),
    [gracia, gracia, gracia, sha256(token), token.slice(0, 12), p.dispositivoId],
  )
  await auditar(con, { usuarioId: p.usuarioId, actor: p.usuarioId ? 'USUARIO' : 'SISTEMA', accion: 'TOKEN_ROTADO', entidad: 'dispositivo', entidadId: p.dispositivoId, datos: { uid: d.uid, gracia_horas: gracia }, ip: p.ip })
  return { token, uid: d.uid as string, gracia_horas: gracia }
}

const MENSAJE_MODO = {
  BLOQUEO_ACTIVO: 'Rearme el bloqueo antes de habilitar un modo.',
  CALIBRACION_NO_CONFIRMADA: 'La calibración del sensor no está confirmada.',
  HARDWARE_NO_CONFIRMADO: 'El ESP32 no reporta hardware confirmado.',
  ENCENDIDO_DESHABILITADO: 'El modo AUTOMATICO enciende la bomba y está deshabilitado en el servidor (PERMITIR_ENCENDIDO=false).',
} as const
export type MotivoModo = keyof typeof MENSAJE_MODO

/**
 * Por qué no puede activarse un modo (null = permitido). Única regla, usada por
 * PATCH /control (409) y por el estado del panel (botones deshabilitados con su motivo).
 */
export function motivoModoNoPermitido(
  modo: Modo,
  e: { bloqueo: boolean; calibrada: boolean; hardware: boolean; permitirEncendido: boolean },
): MotivoModo | null {
  if (modo === 'DESHABILITADO') return null
  if (e.bloqueo) return 'BLOQUEO_ACTIVO'
  if (!e.calibrada) return 'CALIBRACION_NO_CONFIRMADA'
  if (!e.hardware) return 'HARDWARE_NO_CONFIRMADO'
  if (modo === 'AUTOMATICO' && !e.permitirEncendido) return 'ENCENDIDO_DESHABILITADO'
  return null
}

/** PATCH /actuadores/{id}/control (contrato §11.5). */
export async function actualizarControl(
  con: ConTx,
  p: { actuadorId: number; dispositivoId: number; usuarioId: number; cambios: Partial<{ modo: Modo; umbral_inicio_pct: number; umbral_parada_pct: number; riego_max_s: number; descanso_min_s: number }>; ip?: string | null },
) {
  const a0 = { dispositivo_id: p.dispositivoId }
  const d = await bloquearDispositivo(con, a0.dispositivo_id)
  const act = await fila(
    con,
    sqlPorMotor({ mysql: `SELECT a.*, cc.*, s.calibracion_confirmada FROM actuadores a
       JOIN configuraciones_control cc ON cc.actuador_id = a.id
       LEFT JOIN sensores s ON s.id = cc.sensor_id
      WHERE a.id = ? AND a.dispositivo_id = ? FOR UPDATE`, postgres: `SELECT a.*, cc.*, s.calibracion_confirmada FROM actuadores a
       JOIN configuraciones_control cc ON cc.actuador_id = a.id
       LEFT JOIN sensores s ON s.id = cc.sensor_id
      WHERE a.id = ? AND a.dispositivo_id = ? FOR UPDATE OF a, cc` }),
    [p.actuadorId, p.dispositivoId],
  )
  if (!act) throw new ErrorApi(404, 'ACTUADOR_NO_ENCONTRADO', 'Actuador sin configuración de control.')
  const nuevo = {
    modo: p.cambios.modo ?? act.modo,
    umbral_inicio_pct: p.cambios.umbral_inicio_pct ?? Number(act.umbral_inicio_pct),
    umbral_parada_pct: p.cambios.umbral_parada_pct ?? Number(act.umbral_parada_pct),
    riego_max_s: p.cambios.riego_max_s ?? act.riego_max_s,
    descanso_min_s: p.cambios.descanso_min_s ?? act.descanso_min_s,
  }
  const detalles = []
  if (nuevo.umbral_parada_pct - nuevo.umbral_inicio_pct < 5)
    detalles.push({ campo: 'umbral_parada_pct', codigo: 'HISTERESIS_INSUFICIENTE', mensaje: 'La parada debe superar al inicio en al menos 5 puntos.' })
  if (d.tope_riego_s != null && nuevo.riego_max_s > d.tope_riego_s)
    detalles.push({ campo: 'riego_max_s', codigo: 'FUERA_DE_CAPACIDAD', mensaje: `Supera el tope del ESP32 (${d.tope_riego_s} s).` })
  if (detalles.length) throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'Configuración inválida.', detalles)

  if (p.cambios.modo && p.cambios.modo !== act.modo) {
    const motivo = motivoModoNoPermitido(nuevo.modo, {
      bloqueo: !!act.bloqueo_tipo, calibrada: !!act.calibracion_confirmada, hardware: !!d.hardware_confirmado, permitirEncendido: config().PERMITIR_ENCENDIDO,
    })
    if (motivo) throw conflicto(motivo, MENSAJE_MODO[motivo])
  }

  const iguales =
    nuevo.modo === act.modo &&
    nuevo.umbral_inicio_pct === Number(act.umbral_inicio_pct) &&
    nuevo.umbral_parada_pct === Number(act.umbral_parada_pct) &&
    nuevo.riego_max_s === act.riego_max_s &&
    nuevo.descanso_min_s === act.descanso_min_s
  if (!iguales) {
    await ejecutar(
      con,
      `UPDATE configuraciones_control SET modo = ?, modo_origen = 'USUARIO', modo_motivo = NULL, umbral_inicio_pct = ?, umbral_parada_pct = ?,
              riego_max_s = ?, descanso_min_s = ?, actualizado_por = ? WHERE actuador_id = ?`,
      [nuevo.modo, nuevo.umbral_inicio_pct, nuevo.umbral_parada_pct, nuevo.riego_max_s, nuevo.descanso_min_s, p.usuarioId, p.actuadorId],
    )
    await incrementarVersion(con, a0.dispositivo_id)
    await auditar(con, { usuarioId: p.usuarioId, accion: 'CONTROL_ACTUALIZADO', entidad: 'actuador', entidadId: p.actuadorId, datos: nuevo, ip: p.ip })
  }
  const d2 = await fila(con, 'SELECT config_version_deseada, config_version_aplicada FROM dispositivos WHERE id = ?', [a0.dispositivo_id])
  return {
    config_version_deseada: d2!.config_version_deseada,
    config_version_aplicada: d2!.config_version_aplicada,
    control: nuevo,
    advertencias: act.estado_bomba && act.estado_bomba !== 'APAGADA' && !iguales ? ['RIEGO_EN_CURSO_SE_DETENDRA'] : [],
  }
}
