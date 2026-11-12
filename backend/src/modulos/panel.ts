import { sqlPorMotor } from '../db.js'
import { Router, type Request } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { bd, bloquearDispositivo, ejecutar, fila, filas, transaccion } from '../db.js'
import { ErrorApi, asincrono, conflicto, validar } from '../errores.js'
import { autenticarUsuario, exigirRol, terrenosVisibles } from '../middlewares/seguridad.js'
import { MODOS, ahoraIso, codigo, fechaUtc, idEntero, idRuta, iso } from '../util/comun.js'
import { auditar } from '../util/registro.js'
import { actualizarCalibracion, actualizarControl, conexionDe, crearOrden, motivoModoNoPermitido, rotarToken, serializarOrden } from './servicio.js'

export const rutasPanel = Router()
rutasPanel.use(autenticarUsuario)

const terrenoDeDispositivo = async (id: number) => (await fila(bd(), 'SELECT terreno_id FROM dispositivos WHERE id = ?', [id]))?.terreno_id

rutasPanel.get(
  '/terrenos',
  asincrono(async (req, res) => {
    const t = await terrenosVisibles(req)
    res.json({ data: t.map((x) => ({ id: x.id, nombre: x.nombre, ubicacion: x.ubicacion, rol: x.rol })) })
  }),
)

rutasPanel.get(
  '/terrenos/:id/dispositivos',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    await exigirRol(req, (await fila(bd(), 'SELECT id FROM terrenos WHERE id = ?', [id]))?.id, 'LECTOR', 'RECURSO_NO_ENCONTRADO')
    const ds = await filas(bd(), 'SELECT id, uid, nombre, estado, ultima_conexion_en FROM dispositivos WHERE terreno_id = ? ORDER BY id', [id])
    res.json({ data: ds.map((d) => ({ id: d.id, uid: d.uid, nombre: d.nombre, estado: d.estado, conexion: conexionDe(d.ultima_conexion_en), ultima_conexion_en: iso(d.ultima_conexion_en) })) })
  }),
)

/** GET /dispositivos/{id}/estado — panel en vivo (contrato §11.3). */
rutasPanel.get(
  '/dispositivos/:id/estado',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    await exigirRol(req, await terrenoDeDispositivo(id), 'LECTOR', 'DISPOSITIVO_NO_ENCONTRADO')
    const d = (await fila(bd(), 'SELECT * FROM dispositivos WHERE id = ?', [id]))!
    const ahora = Date.now()
    const conexion = conexionDe(d.ultima_conexion_en)
    const fiable = conexion === 'EN_LINEA'
    const sensores = await filas(bd(), 'SELECT s.*, z.nombre AS zona_nombre FROM sensores s LEFT JOIN zonas z ON z.id = s.zona_id WHERE s.dispositivo_id = ? AND s.activo = 1 ORDER BY s.id', [id])
    const actuadores = await filas(
      bd(),
      `SELECT a.*, cc.modo AS modo_configurado, cc.umbral_inicio_pct, cc.umbral_parada_pct, cc.riego_max_s, cc.descanso_min_s, cc.sensor_id,
              s.calibracion_confirmada, s.ultimo_valor
         FROM actuadores a LEFT JOIN configuraciones_control cc ON cc.actuador_id = a.id LEFT JOIN sensores s ON s.id = cc.sensor_id
        WHERE a.dispositivo_id = ? AND a.activo = 1 ORDER BY a.id`,
      [id],
    )
    const activas = await filas(bd(), "SELECT * FROM ordenes_riego WHERE dispositivo_id = ? AND estado IN ('PENDIENTE','ENTREGADA') ORDER BY id DESC", [id])
    const alertas = await fila(bd(), "SELECT COUNT(*) AS n FROM alertas WHERE dispositivo_id = ? AND estado = 'ACTIVA'", [id])
    const sincronizada = d.config_version_aplicada === d.config_version_deseada
    const permitir = config().PERMITIR_ENCENDIDO

    res.json({
      data: {
        dispositivo: {
          id: d.id, uid: d.uid, nombre: d.nombre, conexion,
          ultima_conexion_en: iso(d.ultima_conexion_en),
          segundos_desde_conexion: d.ultima_conexion_en ? Math.round((ahora - new Date(d.ultima_conexion_en).getTime()) / 1000) : null,
          rssi_dbm: d.rssi_dbm, version_firmware: d.version_firmware, version_contrato: d.version_contrato,
          hardware_confirmado: d.hardware_confirmado === null ? null : !!d.hardware_confirmado,
          tope_riego_s: d.tope_riego_s, reloj_confiable: d.reloj_confiable === null ? null : !!d.reloj_confiable,
          persistencia_ok: d.persistencia_ok === null ? null : !!d.persistencia_ok, tls_vigencia: d.tls_vigencia,
          config_version_deseada: d.config_version_deseada, config_version_aplicada: d.config_version_aplicada, config_sincronizada: sincronizada,
          nunca_conectado: d.ultima_conexion_en === null,
          diagnostico: {
            id_arranque: d.id_arranque_actual, arranque_detectado_en: iso(d.arranque_detectado_en), uptime_ms: d.uptime_ms === null ? null : Number(d.uptime_ms),
            ultima_ip: d.ultima_ip, ip_local: d.ip_local, token_prefijo: d.token_prefijo,
            max_id_orden_procesada: d.max_id_orden_procesada === null ? null : Number(d.max_id_orden_procesada),
            config_rechazada_version: d.config_rechazada_version, config_rechazo_errores: d.config_rechazo_errores, contadores: d.diagnostico,
          },
        },
        sensores: sensores.map((s) => ({
          id: s.id, codigo: s.codigo, tipo: s.tipo, modelo: s.modelo, zona: s.zona_id ? { id: s.zona_id, nombre: s.zona_nombre } : null,
          calibracion_confirmada: !!s.calibracion_confirmada, raw_seco: s.raw_seco, raw_humedo: s.raw_humedo, calibrado_en: iso(s.calibrado_en),
          ultima_lectura: s.ultima_lectura_en ? { valor_pct: s.ultimo_valor === null ? null : Number(s.ultimo_valor), valor_raw: s.ultimo_raw, estado: s.ultimo_estado, medido_en: iso(s.ultima_lectura_en) } : null,
        })),
        actuadores: actuadores.map((a) => {
          const reportado = a.reportado_en
            ? {
                modo: a.modo_reportado, estado_bomba: a.estado_bomba, riego_transcurrido_s: a.riego_transcurrido_s ?? 0, riego_restante_s: a.riego_restante_s ?? 0,
                descanso_restante_s: a.descanso_restante_s ?? 0,
                bloqueo: a.bloqueo_tipo
                  ? { id_bloqueo: Number(a.bloqueo_id), tipo: a.bloqueo_tipo, causa: a.bloqueo_causa, liberable_remotamente: !!a.bloqueo_liberable_remoto,
                      desde_id_arranque: a.bloqueo_desde_id_arranque, desde_uptime_ms: a.bloqueo_desde_uptime_ms === null ? null : Number(a.bloqueo_desde_uptime_ms), desde_ts: iso(a.bloqueo_desde_ts) }
                  : null,
                rearmes_remotos_episodio: a.rearmes_remotos_episodio ?? 0,
                id_orden_activa: a.id_orden_activa === null ? null : Number(a.id_orden_activa),
                reportado_en: iso(a.reportado_en), antiguedad_s: Math.round((ahora - new Date(a.reportado_en).getTime()) / 1000), fiable,
              }
            : null
          const regando = reportado && reportado.estado_bomba !== 'APAGADA'
          const misActivas = activas.filter((o) => o.actuador_id === a.id)
          let motivo: string | null = null
          if (!permitir) motivo = 'ENCENDIDO_DESHABILITADO'
          else if (!fiable) motivo = 'DISPOSITIVO_FUERA_DE_LINEA'
          else if (reportado?.bloqueo) motivo = 'BLOQUEO_ACTIVO'
          else if (a.modo_configurado !== 'MANUAL' || reportado?.modo !== 'MANUAL') motivo = 'MODO_NO_MANUAL'
          else if (!sincronizada) motivo = 'CONFIG_NO_SINCRONIZADA'
          else if (!a.calibracion_confirmada) motivo = 'CALIBRACION_NO_CONFIRMADA'
          else if (!d.hardware_confirmado) motivo = 'HARDWARE_NO_CONFIRMADO'
          else if (regando) motivo = 'ACTUADOR_OCUPADO'
          else if ((reportado?.descanso_restante_s ?? 0) > 0) motivo = 'DESCANSO_ACTIVO'
          else if (misActivas.some((o) => o.tipo === 'BOMBA_APAGAR')) motivo = 'APAGADO_PENDIENTE'
          return {
            id: a.id, codigo: a.codigo, tipo: a.tipo, modo_configurado: a.modo_configurado, reportado,
            control: { umbral_inicio_pct: Number(a.umbral_inicio_pct), umbral_parada_pct: Number(a.umbral_parada_pct), riego_max_s: a.riego_max_s, descanso_min_s: a.descanso_min_s, valores_de_banco: Number(a.umbral_inicio_pct) === 30 && Number(a.umbral_parada_pct) === 55 && a.riego_max_s === 15 && a.descanso_min_s === 60 },
            orden_activa: misActivas[0] ? serializarOrden(misActivas[0], a.codigo) : null,
            acciones_permitidas: { encender: motivo === null, apagar: true, rearmar: fiable && !!reportado?.bloqueo?.liberable_remotamente, motivo_encender_no_permitido: motivo },
            // Motivo por el que cada modo sería rechazado con 409 (null = permitido); misma regla que PATCH /control.
            modos_no_permitidos: Object.fromEntries(MODOS.map((m) => [m, motivoModoNoPermitido(m, { bloqueo: !!a.bloqueo_tipo, calibrada: !!a.calibracion_confirmada, hardware: !!d.hardware_confirmado, permitirEncendido: permitir })])),
          }
        }),
        servidor: { permitir_encendido: permitir, encendido_max_s: config().ENCENDIDO_MAX_S },
        alertas_activas: Number(alertas!.n),
        hora_servidor: ahoraIso(),
      },
    })
  }),
)

const nuevaOrden = z.object({
  tipo: z.enum(['BOMBA_ENCENDER', 'BOMBA_APAGAR', 'RESTABLECER_BLOQUEO']),
  actuador: codigo,
  parametros: z.record(z.unknown()).default({}),
  ttl_s: z.number().int().optional(),
})
const parametrosPorTipo = {
  BOMBA_ENCENDER: z.object({ duracion_s: z.number().int().min(1).max(600) }).strict(),
  BOMBA_APAGAR: z.object({}).strict(),
  RESTABLECER_BLOQUEO: z.object({ id_bloqueo: idEntero, causa: z.string().regex(/^[A-Z_]{2,40}$/), inspeccion_confirmada: z.boolean() }).strict(),
}

/** POST /dispositivos/{id}/ordenes (contrato §11.4). */
rutasPanel.post(
  '/dispositivos/:id/ordenes',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    await exigirRol(req, await terrenoDeDispositivo(id), 'OPERADOR', 'DISPOSITIVO_NO_ENCONTRADO')
    const b = validar(nuevaOrden, req.body)
    const parametros = validar(parametrosPorTipo[b.tipo], b.parametros)
    const idem = req.header('idempotency-key')
    if (idem !== undefined && !/^[\w-]{1,64}$/.test(idem)) throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'Idempotency-Key inválida.')
    const r = await transaccion((con) =>
      crearOrden(con, { dispositivoId: id, actuadorCodigo: b.actuador, tipo: b.tipo, parametros, ttlS: b.ttl_s, usuarioId: req.usuario!.id, idempotencia: idem, ip: req.ip }),
    ).catch(async (e) => {
      // La transacción ya hizo ROLLBACK. Nunca continuar una transacción PostgreSQL abortada.
      if (idem && ['23505', 'ER_DUP_ENTRY'].includes(e.code)) {
        const previa = await fila(bd(), 'SELECT o.*, a.codigo AS actuador_codigo FROM ordenes_riego o JOIN actuadores a ON a.id = o.actuador_id WHERE o.solicitada_por = ? AND o.idempotency_key = ?', [req.usuario!.id, idem])
        if (previa) return { orden: serializarOrden(previa), canceladas: [], advertencias: [], repetida: true }
      }
      throw e
    })
    res.status(r.repetida ? 200 : 201).json({ data: { ...r.orden, canceladas: r.canceladas, advertencias: r.advertencias } })
  }),
)

rutasPanel.get(
  '/dispositivos/:id/ordenes',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    await exigirRol(req, await terrenoDeDispositivo(id), 'LECTOR', 'DISPOSITIVO_NO_ENCONTRADO')
    const { limite } = validar(z.object({ limite: z.coerce.number().int().min(1).max(100).default(20) }), req.query)
    const os = await filas(
      bd(),
      `SELECT o.*, a.codigo AS actuador_codigo, u.nombre AS solicitante_nombre FROM ordenes_riego o
         JOIN actuadores a ON a.id = o.actuador_id LEFT JOIN usuarios u ON u.id = o.solicitada_por
        WHERE o.dispositivo_id = ? ORDER BY o.id DESC LIMIT ?`,
      [id, limite],
    )
    res.json({ data: os.map((o) => serializarOrden(o)) })
  }),
)

async function cargarOrden(id: number) {
  return fila(
    bd(),
    `SELECT o.*, a.codigo AS actuador_codigo, u.nombre AS solicitante_nombre, d.terreno_id FROM ordenes_riego o
       JOIN actuadores a ON a.id = o.actuador_id JOIN dispositivos d ON d.id = o.dispositivo_id LEFT JOIN usuarios u ON u.id = o.solicitada_por
      WHERE o.id = ?`,
    [id],
  )
}

rutasPanel.get(
  '/ordenes/:id',
  asincrono(async (req, res) => {
    const o = await cargarOrden(idRuta(req.params.id))
    await exigirRol(req, o?.terreno_id, 'LECTOR', 'ORDEN_NO_ENCONTRADA')
    res.json({ data: serializarOrden(o!) })
  }),
)

rutasPanel.post(
  '/ordenes/:id/cancelar',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    const o0 = await cargarOrden(id)
    await exigirRol(req, o0?.terreno_id, 'OPERADOR', 'ORDEN_NO_ENCONTRADA')
    const r = await transaccion(async (con) => {
      await bloquearDispositivo(con, o0!.dispositivo_id)
      const o = await fila(con, 'SELECT * FROM ordenes_riego WHERE id = ? FOR UPDATE', [id])
      if (o!.tipo === 'BOMBA_APAGAR') return { rechazo: conflicto('CONFLICTO', 'Un apagado no se puede cancelar.') }
      if (o!.estado !== 'PENDIENTE') return { rechazo: conflicto('CONFLICTO', 'Sólo se cancelan órdenes PENDIENTE; una ENTREGADA pudo ejecutarse: envíe Apagar.') }
      await ejecutar(con, sqlPorMotor({ mysql: "UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = 'CANCELADA_POR_USUARIO', cancelada_en = NOW(3), cancelada_por = ? WHERE id = ? AND estado = 'PENDIENTE'", postgres: `UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = 'CANCELADA_POR_USUARIO', cancelada_en = now(), cancelada_por = ? WHERE id = ? AND estado = 'PENDIENTE'` }), [req.usuario!.id, id])
      await auditar(con, { usuarioId: req.usuario!.id, accion: 'ORDEN_CANCELADA', entidad: 'orden', entidadId: id, ip: req.ip })
      return {}
    })
    if ('rechazo' in r && r.rechazo) throw r.rechazo
    res.json({ data: serializarOrden((await cargarOrden(id))!) })
  }),
)

const cambiosControl = z
  .object({
    modo: z.enum(MODOS),
    umbral_inicio_pct: z.number().min(0).max(95),
    umbral_parada_pct: z.number().min(5).max(100),
    riego_max_s: z.number().int().min(5).max(600),
    descanso_min_s: z.number().int().min(5).max(86400),
  })
  .partial()
  .strict()

/** PATCH /actuadores/{id}/control (contrato §11.5). */
rutasPanel.patch(
  '/actuadores/:id/control',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    const t = await fila(bd(), 'SELECT d.terreno_id, d.id AS dispositivo_id FROM actuadores a JOIN dispositivos d ON d.id = a.dispositivo_id WHERE a.id = ?', [id])
    await exigirRol(req, t?.terreno_id, 'OPERADOR', 'ACTUADOR_NO_ENCONTRADO')
    const cambios = validar(cambiosControl, req.body)
    const r = await transaccion((con) => actualizarControl(con, { actuadorId: id, dispositivoId: t!.dispositivo_id, usuarioId: req.usuario!.id, cambios, ip: req.ip }))
    res.json({ data: r })
  }),
)

// Agrupación (contrato §11.1): crudo | 5m | 1h | 1d. Rango máximo por agrupación para acotar la carga.
const AGRUPACIONES = { crudo: { s: 0, maxDias: 2 }, '5m': { s: 300, maxDias: 14 }, '1h': { s: 3600, maxDias: 90 }, '1d': { s: 86400, maxDias: 730 } } as const
const consultaMediciones = z.object({
  desde: fechaUtc.optional(),
  hasta: fechaUtc.optional(),
  agrupacion: z.enum(['crudo', '5m', '1h', '1d']).default('crudo'),
  limite: z.coerce.number().int().min(1).max(5000).default(1500),
})

rutasPanel.get(
  '/sensores/:id/mediciones',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    const t = await fila(bd(), 'SELECT d.terreno_id, d.id AS dispositivo_id FROM sensores s JOIN dispositivos d ON d.id = s.dispositivo_id WHERE s.id = ?', [id])
    await exigirRol(req, t?.terreno_id, 'LECTOR', 'SENSOR_NO_ENCONTRADO')
    const q = validar(consultaMediciones, req.query)
    const hasta = q.hasta ? new Date(q.hasta) : new Date()
    const desde = q.desde ? new Date(q.desde) : new Date(hasta.getTime() - 2 * 3600 * 1000)
    const ag = AGRUPACIONES[q.agrupacion]
    if (desde >= hasta) throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'desde debe ser anterior a hasta.', [{ campo: 'desde', codigo: 'FUERA_DE_RANGO', mensaje: 'desde < hasta' }])
    if (hasta.getTime() - desde.getTime() > ag.maxDias * 86400_000)
      throw new ErrorApi(422, 'VALIDACION_FALLIDA', `Rango demasiado amplio para agrupación ${q.agrupacion} (máx. ${ag.maxDias} días).`, [{ campo: 'desde', codigo: 'FUERA_DE_RANGO', mensaje: `Máximo ${ag.maxDias} días` }])

    if (q.agrupacion === 'crudo') {
      const m = await filas(
        bd(),
        'SELECT medido_en, valor, valor_raw, estado, hora_estimada FROM mediciones WHERE sensor_id = ? AND medido_en BETWEEN ? AND ? ORDER BY medido_en DESC LIMIT ?',
        [id, desde, hasta, q.limite],
      )
      return void res.json({ data: m.reverse().map((x) => ({ medido_en: iso(x.medido_en), valor_pct: x.valor === null ? null : Number(x.valor), valor_raw: x.valor_raw, estado: x.estado, hora_estimada: !!x.hora_estimada })) })
    }
    // Promedio, mínimo y máximo por intervalo; sólo lecturas válidas (estado OK) entran en el promedio.
    const m = await filas(
      bd(),
      sqlPorMotor({ mysql: `SELECT FLOOR(UNIX_TIMESTAMP(medido_en) / ?) * ? AS inicio,
              AVG(valor) AS promedio, MIN(valor) AS minimo, MAX(valor) AS maximo,
              COUNT(*) AS lecturas, SUM(estado <> 'OK') AS invalidas
         FROM mediciones WHERE sensor_id = ? AND medido_en BETWEEN ? AND ?
        GROUP BY inicio ORDER BY inicio LIMIT ?`, postgres: `SELECT FLOOR(extract(epoch from medido_en) / ?) * ? AS inicio,
              AVG(valor) AS promedio, MIN(valor) AS minimo, MAX(valor) AS maximo,
              COUNT(*) AS lecturas, count(*) FILTER (WHERE estado <> 'OK') AS invalidas
         FROM mediciones WHERE sensor_id = ? AND medido_en BETWEEN ? AND ?
        GROUP BY inicio ORDER BY inicio LIMIT ?` }),
      [ag.s, ag.s, id, desde, hasta, q.limite],
    )
    const r1n = (v: unknown) => (v === null ? null : Math.round(Number(v) * 10) / 10)
    res.json({
      data: m.map((x) => ({
        inicio: new Date(Number(x.inicio) * 1000).toISOString(),
        promedio_pct: r1n(x.promedio),
        minimo_pct: r1n(x.minimo),
        maximo_pct: r1n(x.maximo),
        lecturas: Number(x.lecturas),
        invalidas: Number(x.invalidas),
      })),
      meta: { agrupacion: q.agrupacion, intervalo_s: ag.s, desde: desde.toISOString(), hasta: hasta.toISOString() },
    })
  }),
)

rutasPanel.get(
  '/dispositivos/:id/eventos',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    await exigirRol(req, await terrenoDeDispositivo(id), 'LECTOR', 'DISPOSITIVO_NO_ENCONTRADO')
    const ev = await filas(bd(), 'SELECT e.*, a.codigo AS actuador FROM eventos_dispositivo e LEFT JOIN actuadores a ON a.id = e.actuador_id WHERE e.dispositivo_id = ? ORDER BY e.ocurrido_en DESC, e.id DESC LIMIT 50', [id])
    res.json({ data: ev.map((e) => ({ id: Number(e.id), tipo: e.tipo, actuador: e.actuador, datos: e.datos, ocurrido_en: iso(e.ocurrido_en), hora_estimada: !!e.hora_estimada })) })
  }),
)

rutasPanel.get(
  '/zonas/:id/riegos',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    await exigirRol(req, (await fila(bd(), 'SELECT terreno_id FROM zonas WHERE id = ?', [id]))?.terreno_id, 'LECTOR', 'RECURSO_NO_ENCONTRADO')
    const c = await filas(bd(), 'SELECT * FROM ciclos_riego WHERE zona_id = ? ORDER BY iniciado_en DESC LIMIT 40', [id])
    res.json({
      data: c.reverse().map((x) => ({
        id: Number(x.id), origen: x.origen, iniciado_en: iso(x.iniciado_en), finalizado_en: iso(x.finalizado_en), duracion_s: x.duracion_s,
        motivo_fin: x.motivo_fin, humedad_inicio_pct: x.humedad_inicio_pct === null ? null : Number(x.humedad_inicio_pct),
        humedad_fin_pct: x.humedad_fin_pct === null ? null : Number(x.humedad_fin_pct), orden_id: x.orden_id === null ? null : Number(x.orden_id),
      })),
    })
  }),
)

const cambiosCalibracion = z
  .object({ raw_seco: z.number().int().min(21).max(4074), raw_humedo: z.number().int().min(21).max(4074), calibracion_confirmada: z.boolean() })
  .partial()
  .strict()

/** PATCH /sensores/{id} — calibración (contrato §11.1, rol PROPIETARIO). */
rutasPanel.patch(
  '/sensores/:id',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    const t = await fila(bd(), 'SELECT d.terreno_id, d.id AS dispositivo_id FROM sensores s JOIN dispositivos d ON d.id = s.dispositivo_id WHERE s.id = ?', [id])
    await exigirRol(req, t?.terreno_id, 'PROPIETARIO', 'SENSOR_NO_ENCONTRADO')
    const cambios = validar(cambiosCalibracion, req.body)
    const r = await transaccion((con) => actualizarCalibracion(con, { sensorId: id, dispositivoId: t!.dispositivo_id, usuarioId: req.usuario!.id, cambios, ip: req.ip }))
    res.json({ data: r })
  }),
)

/** POST /dispositivos/{id}/token/rotar (contrato §5.1). El token se devuelve UNA sola vez. */
rutasPanel.post(
  '/dispositivos/:id/token/rotar',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    await exigirRol(req, await terrenoDeDispositivo(id), 'PROPIETARIO', 'DISPOSITIVO_NO_ENCONTRADO')
    const gracia = req.body?.gracia_horas
    if (gracia !== undefined && (!Number.isInteger(gracia) || gracia < 0 || gracia > 72))
      throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'gracia_horas debe ser un entero entre 0 y 72.')
    const r = await transaccion((con) => rotarToken(con, { dispositivoId: id, usuarioId: req.usuario!.id, graciaHoras: gracia, ip: req.ip }))
    res.setHeader('Cache-Control', 'no-store')
    res.json({ data: r })
  }),
)

async function cambiarEstadoAlerta(req: Request, destino: 'RECONOCIDA' | 'RESUELTA') {
  const id = idRuta(req.params.id)
  const a = await fila(bd(), 'SELECT terreno_id, estado FROM alertas WHERE id = ?', [id])
  await exigirRol(req, a?.terreno_id, 'OPERADOR', 'RECURSO_NO_ENCONTRADO')
  if (a!.estado === 'RESUELTA') throw conflicto('CONFLICTO', 'La alerta ya está resuelta.')
  if (destino === 'RECONOCIDA')
    await ejecutar(bd(), sqlPorMotor({ mysql: "UPDATE alertas SET estado = 'RECONOCIDA', reconocida_por = ?, reconocida_en = NOW(3) WHERE id = ? AND estado = 'ACTIVA'", postgres: `UPDATE alertas SET estado = 'RECONOCIDA', reconocida_por = ?, reconocida_en = now() WHERE id = ? AND estado = 'ACTIVA'` }), [req.usuario!.id, id])
  else await ejecutar(bd(), sqlPorMotor({ mysql: "UPDATE alertas SET estado = 'RESUELTA', resuelta_en = NOW(3) WHERE id = ? AND estado <> 'RESUELTA'", postgres: `UPDATE alertas SET estado = 'RESUELTA', resuelta_en = now() WHERE id = ? AND estado <> 'RESUELTA'` }), [id])
  await auditar(bd(), { usuarioId: req.usuario!.id, accion: `ALERTA_${destino}`, entidad: 'alerta', entidadId: id, ip: req.ip })
  return { id, estado: destino }
}

rutasPanel.post('/alertas/:id/reconocer', asincrono(async (req, res) => void res.json({ data: await cambiarEstadoAlerta(req, 'RECONOCIDA') })))
rutasPanel.post('/alertas/:id/resolver', asincrono(async (req, res) => void res.json({ data: await cambiarEstadoAlerta(req, 'RESUELTA') })))

rutasPanel.get(
  '/alertas',
  asincrono(async (req, res) => {
    const visibles = (await terrenosVisibles(req)).map((t) => t.id)
    if (!visibles.length) return void res.json({ data: [] })
    const estado = typeof req.query.estado === 'string' && ['ACTIVA', 'RECONOCIDA', 'RESUELTA'].includes(req.query.estado) ? req.query.estado : null
    const a = await filas(
      bd(),
      `SELECT * FROM alertas WHERE terreno_id IN (${visibles.map(() => '?').join(',')}) ${estado ? 'AND estado = ?' : ''} ORDER BY creada_en DESC LIMIT 100`,
      [...visibles, ...(estado ? [estado] : [])],
    )
    res.json({ data: a.map((x) => ({ id: Number(x.id), dispositivo_id: x.dispositivo_id, tipo: x.tipo, severidad: x.severidad, mensaje: x.mensaje, estado: x.estado, creada_en: iso(x.creada_en) })) })
  }),
)
