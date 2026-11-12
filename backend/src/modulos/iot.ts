import { sqlPorMotor } from '../db.js'
import { Router, type Request } from 'express'
import type { ConTx } from '../db.js'
import { z } from 'zod'
import { config } from '../config.js'
import { bd, bloquearDispositivo, ejecutar, fila, filas, transaccion, type Con, type Fila } from '../db.js'
import { ErrorApi, asincrono, conflicto, validar } from '../errores.js'
import { autenticarDispositivo, requerirHttps, sinCache } from '../middlewares/seguridad.js'
import { ahoraIso, codigo, enteroNoNeg, enumReportado, fechaUtc, idArranque, idEntero, idRuta, iso, r1 } from '../util/comun.js'
import { auditar, crearAlerta, resolverAlerta } from '../util/registro.js'
import { MARGEN_APAGADO_SEGURIDAD_S, apagadoDeSeguridad, configuracionDeseada, reconciliarModo } from './servicio.js'

// ------------------------------------------------------------------ esquemas (contrato §7)
const bloqueo = z
  .object({
    id_bloqueo: idEntero,
    tipo: enumReportado,
    causa: enumReportado,
    desde_id_arranque: idArranque.optional(),
    desde_uptime_ms: enteroNoNeg.optional(),
    desde_ts: fechaUtc.nullable().optional(),
    liberable_remotamente: z.boolean(),
  })
  .passthrough()

const estadoActuador = z
  .object({
    actuador: codigo,
    modo: enumReportado,
    estado_bomba: enumReportado,
    riego_transcurrido_s: enteroNoNeg,
    riego_restante_s: enteroNoNeg,
    descanso_restante_s: enteroNoNeg,
    bloqueo: bloqueo.nullable(),
    id_orden_activa: idEntero.nullable(),
    rearmes_remotos_episodio: z.union([z.literal(0), z.literal(1)]).optional(),
    uptime_ms: enteroNoNeg,
  })
  .passthrough()

const lectura = z.object({
  seq: enteroNoNeg.max(4294967295),
  sensor: codigo,
  tipo: enumReportado,
  valor_pct: z.number().min(0).max(100).nullable(),
  valor_raw: z.number().int().min(0).max(4095).nullable(),
  estado: enumReportado,
  ts: fechaUtc.nullable().optional(),
  uptime_ms: enteroNoNeg,
})

const telemetria = z.object({
  id_arranque: idArranque,
  uptime_ms: enteroNoNeg,
  ts: fechaUtc.nullable().optional(),
  version_firmware: z.string().min(1).max(16),
  version_contrato: z.string().regex(/^1\.\d+\.\d+$/, 'Versión mayor del contrato no soportada'),
  config_version: enteroNoNeg.max(4294967295),
  seguridad: z
    .object({
      hardware_confirmado: z.boolean(),
      calibracion_confirmada: z.boolean(),
      tope_riego_s: z.number().int().min(1).max(600),
      max_id_orden_procesada: enteroNoNeg,
      reloj_confiable: z.boolean(),
      persistencia_ok: z.boolean(),
      tls_vigencia: z.enum(['MBEDTLS', 'VERIFICADOR']).optional(),
    })
    .passthrough(),
  red: z.object({ rssi_dbm: z.number().int().min(-120).max(0).optional(), ip_local: z.string().max(45).optional() }).passthrough().optional(),
  diagnostico: z.record(z.unknown()).optional(),
  lecturas: z.array(z.unknown()).max(30),
  actuadores: z.array(estadoActuador).max(16),
})

const ack = z.object({
  resultado: z.enum(['EJECUTADA', 'RECHAZADA', 'FALLIDA']),
  codigo_motivo: enumReportado.nullable(),
  mensaje: z.string().max(200).nullable().optional(),
  duracion_aplicada_s: z.number().int().min(1).max(600).nullable(),
  ejecutada_en: fechaUtc.nullable(),
  id_arranque_origen: idArranque,
  uptime_ms: enteroNoNeg,
  config_version: enteroNoNeg.max(4294967295),
  estado_actuador: estadoActuador,
})

const ackConfig = z.object({
  config_version: enteroNoNeg.max(4294967295),
  resultado: z.enum(['APLICADA', 'RECHAZADA']),
  errores: z.array(z.object({ campo: z.string().max(100), codigo: enumReportado }).passthrough()).max(50).default([]),
  actuadores: z.array(estadoActuador).max(16).optional(),
})

const evento = z.object({
  seq: enteroNoNeg.max(4294967295),
  tipo: enumReportado,
  actuador: codigo.optional().nullable(),
  ts: fechaUtc.nullable().optional(),
  uptime_ms: enteroNoNeg,
  datos: z.record(z.unknown()).optional().nullable(),
})
const eventos = z.object({ id_arranque: idArranque, uptime_ms: enteroNoNeg, eventos: z.array(evento).max(30) })

// ------------------------------------------------------------------ utilidades
function exigirMismoArranque(req: Request, delCuerpo: string) {
  if (delCuerpo !== req.dispositivo!.idArranque)
    throw new ErrorApi(422, 'ARRANQUE_NO_COINCIDE', 'id_arranque no coincide con X-Id-Arranque.', [
      { campo: 'id_arranque', codigo: 'ARRANQUE_NO_COINCIDE', mensaje: 'Debe ser igual a la cabecera X-Id-Arranque.' },
    ])
}

/** Hora real de un dato: ts del dispositivo si es plausible (<24 h); si no, reconstruida por uptime (§7.1). */
function horaDato(ts: string | null | undefined, uptimeDato: number, uptimeEnvio: number): { fecha: Date; estimada: boolean } {
  const ahora = Date.now()
  if (ts) {
    const t = Date.parse(ts)
    if (Math.abs(ahora - t) < 24 * 3600 * 1000) return { fecha: new Date(t), estimada: false }
  }
  return { fecha: new Date(ahora - Math.max(0, uptimeEnvio - uptimeDato)), estimada: true }
}

async function actuadoresPorCodigo(con: Con, dispositivoId: number) {
  const r = await filas(con, 'SELECT id, codigo, zona_id FROM actuadores WHERE dispositivo_id = ?', [dispositivoId])
  return new Map(r.map((a) => [a.codigo as string, a]))
}

/** Snapshot del actuador sólo si es más reciente que el guardado (mismo arranque y mayor uptime, o arranque actual distinto). */
async function guardarSnapshot(con: Con, actuadorId: number, idArranqueActual: string, e: z.infer<typeof estadoActuador>) {
  const b = e.bloqueo
  await ejecutar(
    con,
    sqlPorMotor({ mysql: `UPDATE actuadores SET modo_reportado = ?, estado_bomba = ?, riego_transcurrido_s = ?, riego_restante_s = ?, descanso_restante_s = ?,
            bloqueo_id = ?, bloqueo_tipo = ?, bloqueo_causa = ?, bloqueo_liberable_remoto = ?,
            bloqueo_desde_id_arranque = ?, bloqueo_desde_uptime_ms = ?, bloqueo_desde_ts = ?,
            rearmes_remotos_episodio = ?, id_orden_activa = ?,
            reportado_id_arranque = ?, reportado_uptime_ms = ?, reportado_en = NOW(3)
      WHERE id = ? AND (reportado_id_arranque IS NULL OR reportado_id_arranque <> ? OR reportado_uptime_ms <= ?)`, postgres: `UPDATE actuadores SET modo_reportado = ?, estado_bomba = ?, riego_transcurrido_s = ?, riego_restante_s = ?, descanso_restante_s = ?,
            bloqueo_id = ?, bloqueo_tipo = ?, bloqueo_causa = ?, bloqueo_liberable_remoto = ?,
            bloqueo_desde_id_arranque = ?, bloqueo_desde_uptime_ms = ?, bloqueo_desde_ts = ?,
            rearmes_remotos_episodio = ?, id_orden_activa = ?,
            reportado_id_arranque = ?, reportado_uptime_ms = ?, reportado_en = now()
      WHERE id = ? AND (reportado_id_arranque IS NULL OR reportado_id_arranque <> ? OR reportado_uptime_ms <= ?)` }),
    [
      e.modo, e.estado_bomba, e.riego_transcurrido_s, e.riego_restante_s, e.descanso_restante_s,
      b?.id_bloqueo ?? null, b?.tipo ?? null, b?.causa ?? null, b ? (b.liberable_remotamente ? 1 : 0) : null,
      b?.desde_id_arranque ?? null, b?.desde_uptime_ms ?? null, b?.desde_ts ? new Date(b.desde_ts) : null,
      e.rearmes_remotos_episodio ?? null, e.id_orden_activa,
      idArranqueActual, e.uptime_ms, actuadorId, idArranqueActual, e.uptime_ms,
    ],
  )
}

// ------------------------------------------------------------------ rutas
export const rutasIot = Router()
rutasIot.use(requerirHttps, sinCache, autenticarDispositivo)

/** 7.1 POST /iot/telemetria */
rutasIot.post(
  '/telemetria',
  asincrono(async (req, res) => {
    const t = validar(telemetria, req.body)
    exigirMismoArranque(req, t.id_arranque)
    const dev = req.dispositivo!
    const sensores = new Map((await filas(bd(), 'SELECT id, codigo FROM sensores WHERE dispositivo_id = ?', [dev.id])).map((s) => [s.codigo as string, s.id as number]))
    const actuadores = await actuadoresPorCodigo(bd(), dev.id)

    let recibidas = 0
    let duplicadas = 0
    const descartadas: { seq: number | null; codigo: string }[] = []
    for (const bruta of t.lecturas) {
      const l = lectura.safeParse(bruta)
      if (!l.success) {
        descartadas.push({ seq: typeof (bruta as { seq?: unknown })?.seq === 'number' ? (bruta as { seq: number }).seq : null, codigo: 'VALIDACION_FALLIDA' })
        continue
      }
      const sensorId = sensores.get(l.data.sensor)
      if (!sensorId) {
        descartadas.push({ seq: l.data.seq, codigo: 'SENSOR_DESCONOCIDO' }) // P-2: nunca se asocia a otro dispositivo
        continue
      }
      const { fecha, estimada } = horaDato(l.data.ts, l.data.uptime_ms, t.uptime_ms)
      const valor = l.data.estado === 'OK' && l.data.valor_pct !== null ? r1(l.data.valor_pct) : null
      const r = await ejecutar(
        bd(),
        sqlPorMotor({ mysql: `INSERT IGNORE INTO mediciones (sensor_id, valor, valor_raw, estado, medido_en, hora_estimada, id_arranque, seq, uptime_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, postgres: `INSERT INTO mediciones (sensor_id, valor, valor_raw, estado, medido_en, hora_estimada, id_arranque, seq, uptime_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sensor_id, id_arranque, seq) DO NOTHING RETURNING id` }),
        [sensorId, valor, l.data.valor_raw, l.data.estado, fecha, estimada ? 1 : 0, t.id_arranque, l.data.seq, l.data.uptime_ms],
      )
      if (r.affectedRows === 0) {
        duplicadas++
        continue
      }
      recibidas++
      await ejecutar(
        bd(),
        `UPDATE sensores SET ultimo_valor = ?, ultimo_raw = ?, ultimo_estado = ?, ultima_lectura_en = ?
          WHERE id = ? AND (ultima_lectura_en IS NULL OR ultima_lectura_en <= ?)`,
        [valor, l.data.valor_raw, l.data.estado, fecha, sensorId, fecha],
      )
    }

    const s = t.seguridad
    await ejecutar(
      bd(),
      `UPDATE dispositivos SET version_firmware = ?, version_contrato = ?, config_version_aplicada = ?, uptime_ms = ?,
              hardware_confirmado = ?, tope_riego_s = ?, max_id_orden_procesada = ?, reloj_confiable = ?, persistencia_ok = ?,
              tls_vigencia = ?, rssi_dbm = ?, ip_local = ?, diagnostico = ?
        WHERE id = ?`,
      [
        t.version_firmware, t.version_contrato, t.config_version, t.uptime_ms,
        s.hardware_confirmado ? 1 : 0, s.tope_riego_s, s.max_id_orden_procesada, s.reloj_confiable ? 1 : 0, s.persistencia_ok ? 1 : 0,
        s.tls_vigencia ?? null, t.red?.rssi_dbm ?? null, t.red?.ip_local ?? null, t.diagnostico ? JSON.stringify(t.diagnostico) : null,
        dev.id,
      ],
    )

    const modos = new Map<number, string>()
    for (const e of t.actuadores) {
      const a = actuadores.get(e.actuador)
      if (!a) continue // P-2
      await guardarSnapshot(bd(), a.id, dev.idArranque, e)
      modos.set(a.id, e.modo)
      if (e.estado_bomba !== 'APAGADA' && e.riego_transcurrido_s > config().ENCENDIDO_MAX_S + MARGEN_APAGADO_SEGURIDAD_S)
        await transaccion((con) => apagadoDeSeguridad(con, dev.id, a.id, e.riego_transcurrido_s))
      if (e.bloqueo) await crearAlerta(bd(), { dispositivoId: dev.id, tipo: 'BLOQUEO_ACTIVADO', severidad: e.bloqueo.tipo === 'CRITICO' ? 'CRITICA' : 'ADVERTENCIA', mensaje: `Bloqueo ${e.bloqueo.tipo} #${e.bloqueo.id_bloqueo}: ${e.bloqueo.causa}`, clave: `BLOQUEO:${a.id}:${e.bloqueo.id_bloqueo}` })
    }
    // Reconciliación §9.3: sólo telemetría fresca del arranque actual.
    if (modos.size) await transaccion((con) => reconciliarModo(con, dev.id, t.config_version, modos))

    if (!s.reloj_confiable) await crearAlerta(bd(), { dispositivoId: dev.id, tipo: 'RELOJ_NO_CONFIABLE', severidad: 'ADVERTENCIA', mensaje: 'El ESP32 reporta reloj no confiable.' })
    else await resolverAlerta(bd(), `RELOJ_NO_CONFIABLE:${dev.id}`)
    if (!s.persistencia_ok) await crearAlerta(bd(), { dispositivoId: dev.id, tipo: 'PERSISTENCIA_DISPOSITIVO', severidad: 'CRITICA', mensaje: 'El ESP32 reporta fallo de memoria persistente.' })

    const d = await fila(bd(), 'SELECT config_version_deseada FROM dispositivos WHERE id = ?', [dev.id])
    const pend = await fila(
      bd(),
      sqlPorMotor({ mysql: "SELECT COUNT(*) AS n FROM ordenes_riego WHERE dispositivo_id = ? AND expira_en > NOW(3) AND (estado = 'PENDIENTE' OR (estado = 'ENTREGADA' AND id_arranque_entrega = ?))", postgres: `SELECT COUNT(*) AS n FROM ordenes_riego WHERE dispositivo_id = ? AND expira_en > now() AND (estado = 'PENDIENTE' OR (estado = 'ENTREGADA' AND id_arranque_entrega = ?))` }),
      [dev.id, dev.idArranque],
    )
    res.json({ data: { recibidas, duplicadas, descartadas, config_version: d!.config_version_deseada, ordenes_pendientes: Number(pend!.n), hora_servidor: ahoraIso() } })
  }),
)

/** 7.2 GET /iot/ordenes — una orden por actuador, la de mayor id entregable (§8.2). */
rutasIot.get(
  '/ordenes',
  asincrono(async (req, res) => {
    const dev = req.dispositivo!
    const entregable = await fila(bd(), sqlPorMotor({
      mysql: "SELECT 1 AS n FROM ordenes_riego WHERE dispositivo_id = ? AND expira_en > NOW(3) AND (estado = 'PENDIENTE' OR (estado = 'ENTREGADA' AND id_arranque_entrega = ?)) LIMIT 1",
      postgres: "SELECT 1 AS n FROM ordenes_riego WHERE dispositivo_id = ? AND expira_en > now() AND (estado = 'PENDIENTE' OR (estado = 'ENTREGADA' AND id_arranque_entrega = ?)) LIMIT 1",
    }), [dev.id, dev.idArranque])
    if (!entregable) {
      const d = await fila(bd(), 'SELECT config_version_deseada FROM dispositivos WHERE id = ?', [dev.id])
      return void res.json({ data: { ordenes: [], config_version: d!.config_version_deseada, hora_servidor: ahoraIso() } })
    }
    const resultado = await transaccion(async (con) => {
      const d = await bloquearDispositivo(con, dev.id)
      const permitir = config().PERMITIR_ENCENDIDO
      if (!permitir) {
        // Defensa en profundidad: con el encendido deshabilitado, ningún BOMBA_ENCENDER llega al ESP32,
        // aunque se hubiera creado antes con el permiso activo.
        const r = await ejecutar(
          con,
          sqlPorMotor({ mysql: "UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = 'ENCENDIDO_DESHABILITADO', cancelada_en = NOW(3) WHERE dispositivo_id = ? AND tipo = 'BOMBA_ENCENDER' AND estado = 'PENDIENTE' AND motivo_cierre IS NULL", postgres: `UPDATE ordenes_riego SET estado = 'CANCELADA', motivo_cierre = 'ENCENDIDO_DESHABILITADO', cancelada_en = now() WHERE dispositivo_id = ? AND tipo = 'BOMBA_ENCENDER' AND estado = 'PENDIENTE' AND motivo_cierre IS NULL` }),
          [dev.id],
        )
        if (r.affectedRows) await auditar(con, { actor: 'SISTEMA', accion: 'ENCENDIDOS_CANCELADOS', entidad: 'dispositivo', entidadId: dev.id, datos: { motivo: 'PERMITIR_ENCENDIDO=false', ordenes: r.affectedRows } })
      }
      const candidatas = await filas(
        con,
        sqlPorMotor({ mysql: `SELECT o.*, a.codigo AS actuador_codigo FROM ordenes_riego o JOIN actuadores a ON a.id = o.actuador_id
          WHERE o.dispositivo_id = ? AND o.expira_en > NOW(3)
            AND (o.estado = 'PENDIENTE' OR (o.estado = 'ENTREGADA' AND o.id_arranque_entrega = ?))
            AND (? OR o.tipo <> 'BOMBA_ENCENDER')
          ORDER BY o.actuador_id, o.id DESC FOR UPDATE`, postgres: `SELECT o.*, a.codigo AS actuador_codigo FROM ordenes_riego o JOIN actuadores a ON a.id = o.actuador_id
          WHERE o.dispositivo_id = ? AND o.expira_en > now()
            AND (o.estado = 'PENDIENTE' OR (o.estado = 'ENTREGADA' AND o.id_arranque_entrega = ?))
            AND (? OR o.tipo <> 'BOMBA_ENCENDER')
          ORDER BY o.actuador_id, o.id DESC FOR UPDATE OF o` }),
        [dev.id, dev.idArranque, permitir],
      )
      const vistas = new Set<number>()
      const entregar = []
      for (const o of candidatas) {
        if (vistas.has(o.actuador_id)) continue
        vistas.add(o.actuador_id)
        entregar.push(o)
      }
      for (const o of entregar) {
        if (o.estado === 'PENDIENTE')
          await ejecutar(con, sqlPorMotor({ mysql: "UPDATE ordenes_riego SET estado = 'ENTREGADA', entregada_en = NOW(3), id_arranque_entrega = ?, ultima_entrega_en = NOW(3), intentos_entrega = intentos_entrega + 1 WHERE id = ? AND estado = 'PENDIENTE'", postgres: `UPDATE ordenes_riego SET estado = 'ENTREGADA', entregada_en = now(), id_arranque_entrega = ?, ultima_entrega_en = now(), intentos_entrega = intentos_entrega + 1 WHERE id = ? AND estado = 'PENDIENTE'` }), [dev.idArranque, o.id])
        else await ejecutar(con, sqlPorMotor({ mysql: 'UPDATE ordenes_riego SET ultima_entrega_en = NOW(3), intentos_entrega = intentos_entrega + 1 WHERE id = ?', postgres: `UPDATE ordenes_riego SET ultima_entrega_en = now(), intentos_entrega = intentos_entrega + 1 WHERE id = ?` }), [o.id])
      }
      entregar.sort((a, b) => Number(a.id) - Number(b.id))
      return { entregar, version: d.config_version_deseada }
    })
    res.json({
      data: {
        ordenes: resultado.entregar.map((o) => ({
          id: Number(o.id),
          tipo: o.tipo,
          actuador: o.actuador_codigo,
          parametros: typeof o.parametros === 'string' ? JSON.parse(o.parametros) : o.parametros,
          creada_en: iso(o.creada_en),
          expira_en: iso(o.expira_en),
        })),
        config_version: resultado.version,
        hora_servidor: ahoraIso(),
      },
    })
  }),
)

/** 7.3 POST /iot/ordenes/{id}/confirmacion — ACK inmutable y equivalencia (§7.3.2). */
rutasIot.post(
  '/ordenes/:id/confirmacion',
  asincrono(async (req, res) => {
    const id = idRuta(req.params.id)
    const a = validar(ack, req.body)
    const dev = req.dispositivo!
    const r = await transaccion(async (con: ConTx) => {
      await bloquearDispositivo(con, dev.id)
      const o = await fila(con, 'SELECT * FROM ordenes_riego WHERE id = ? AND dispositivo_id = ? FOR UPDATE', [id, dev.id])
      if (!o) throw new ErrorApi(404, 'ORDEN_NO_ENCONTRADA', 'Orden no encontrada.') // P-3: igual si es de otro dispositivo
      // Los rechazos se devuelven (no se lanzan) para que la alerta/auditoría se confirmen antes del 409.
      if (['EXPIRADA', 'CANCELADA', 'PENDIENTE'].includes(o.estado)) {
        await crearAlerta(con, { dispositivoId: dev.id, tipo: 'ACK_INCOHERENTE', severidad: 'CRITICA', mensaje: `ACK de la orden #${id} que nunca se entregó (${o.estado}).`, clave: `ACK_NO_ENTREGADA:${id}`, ordenId: id })
        return { rechazo: conflicto('ORDEN_NO_ENTREGADA', 'La orden nunca se entregó.') }
      }
      if (o.resultado !== null) {
        const equivalente =
          o.tipo === 'BOMBA_APAGAR'
            ? o.resultado === 'EJECUTADA' && a.resultado === 'EJECUTADA'
            : o.resultado === a.resultado && (o.codigo_motivo ?? null) === a.codigo_motivo && (o.duracion_aplicada_s ?? null) === a.duracion_aplicada_s
        if (equivalente) return { orden: o, repetido: true }
        await ejecutar(con, 'UPDATE ordenes_riego SET ack_conflictos = ack_conflictos + 1 WHERE id = ?', [id])
        await auditar(con, { actor: 'DISPOSITIVO', accion: 'ACK_CONFLICTO', entidad: 'orden', entidadId: id, datos: { original: o.resultado, recibido: a } })
        return { rechazo: conflicto('ORDEN_YA_FINALIZADA', 'La orden ya tiene un resultado distinto registrado.') }
      }
      const tardia = o.estado === 'SIN_CONFIRMAR'
      await ejecutar(
        con,
        sqlPorMotor({ mysql: `UPDATE ordenes_riego SET estado = ?, resultado = ?, codigo_motivo = ?, mensaje = ?, duracion_aplicada_s = ?, ejecutada_en = ?,
                confirmada_en = NOW(3), confirmacion_tardia = ?, ack_uptime_ms = ?, ack_id_arranque_origen = ?, ack_id_arranque_envio = ?,
                ack_config_version = ?, ack_cuerpo = ?
          WHERE id = ? AND dispositivo_id = ? AND resultado IS NULL AND estado IN ('ENTREGADA','SIN_CONFIRMAR')`, postgres: `UPDATE ordenes_riego SET estado = ?, resultado = ?, codigo_motivo = ?, mensaje = ?, duracion_aplicada_s = ?, ejecutada_en = ?,
                confirmada_en = now(), confirmacion_tardia = ?, ack_uptime_ms = ?, ack_id_arranque_origen = ?, ack_id_arranque_envio = ?,
                ack_config_version = ?, ack_cuerpo = ?
          WHERE id = ? AND dispositivo_id = ? AND resultado IS NULL AND estado IN ('ENTREGADA','SIN_CONFIRMAR')` }),
        [
          a.resultado, a.resultado, a.codigo_motivo, a.mensaje ?? null, a.duracion_aplicada_s, a.ejecutada_en ? new Date(a.ejecutada_en) : null,
          tardia ? 1 : 0, a.uptime_ms, a.id_arranque_origen, dev.idArranque, a.config_version, JSON.stringify(a), id, dev.id,
        ],
      )
      // ACK histórico (§7.3.2 punto 4): sólo actualiza el snapshot si es del arranque actual.
      if (a.id_arranque_origen === dev.idArranque) {
        const act = await fila(con, 'SELECT id FROM actuadores WHERE dispositivo_id = ? AND codigo = ?', [dev.id, a.estado_actuador.actuador])
        if (act) await guardarSnapshot(con, act.id, dev.idArranque, a.estado_actuador)
      }
      const incierto = a.resultado === 'FALLIDA' && a.codigo_motivo === 'RESULTADO_INCIERTO_REINICIO'
      if (o.id_arranque_entrega && a.id_arranque_origen !== o.id_arranque_entrega && !incierto)
        await crearAlerta(con, { dispositivoId: dev.id, tipo: 'ACK_INCOHERENTE', severidad: 'ADVERTENCIA', mensaje: `ACK de la orden #${id} con arranque distinto al de entrega.`, clave: `ACK_INCOHERENTE:${id}`, ordenId: id })
      if (a.resultado === 'FALLIDA')
        await crearAlerta(con, { dispositivoId: dev.id, tipo: 'ORDEN_FALLIDA', severidad: 'ADVERTENCIA', mensaje: `La orden #${id} falló: ${a.codigo_motivo ?? 'sin motivo'}.`, clave: `ORDEN_FALLIDA:${id}`, ordenId: id })
      return { orden: { ...o, estado: a.resultado, confirmacion_tardia: tardia ? 1 : 0 }, repetido: false }
    })
    if ('rechazo' in r) throw r.rechazo
    res.json({ data: { id, estado: r.orden.estado, confirmacion_tardia: !!r.orden.confirmacion_tardia, hora_servidor: ahoraIso() } })
  }),
)

/** 7.4 GET /iot/configuracion (ETag / 304). */
rutasIot.get(
  '/configuracion',
  asincrono(async (req, res) => {
    const c = await configuracionDeseada(bd(), req.dispositivo!.id)
    // Con el encendido deshabilitado nunca se entrega AUTOMATICO (riega solo). El ESP32 aplicará MANUAL,
    // lo reportará y la reconciliación (§9.3) bajará también el modo deseado: estado coherente y auditado.
    if (!config().PERMITIR_ENCENDIDO) for (const ctl of c.control) if (ctl.modo === 'AUTOMATICO') ctl.modo = 'MANUAL'
    const etag = `"${c.config_version}"`
    res.setHeader('ETag', etag)
    if (req.header('if-none-match') === etag) {
      res.status(304).end()
      return
    }
    res.json({ data: { ...c, hora_servidor: ahoraIso() } })
  }),
)

/** 7.5 POST /iot/configuracion/confirmacion */
rutasIot.post(
  '/configuracion/confirmacion',
  asincrono(async (req, res) => {
    const c = validar(ackConfig, req.body)
    const dev = req.dispositivo!
    const r = await transaccion(async (con) => {
      const d = await bloquearDispositivo(con, dev.id)
      if (c.config_version < 1 || c.config_version > d.config_version_deseada) throw conflicto('VERSION_CONFIG_DESCONOCIDA', 'Versión de configuración desconocida.')
      if (c.resultado === 'APLICADA') {
        await ejecutar(con, sqlPorMotor({ mysql: 'UPDATE dispositivos SET config_version_aplicada = GREATEST(config_version_aplicada, ?), config_aplicada_en = NOW(3) WHERE id = ?', postgres: `UPDATE dispositivos SET config_version_aplicada = GREATEST(config_version_aplicada, ?), config_aplicada_en = now() WHERE id = ?` }), [c.config_version, dev.id])
        await resolverAlerta(con, `CONFIG_RECHAZADA:${dev.id}`)
      } else {
        await ejecutar(con, 'UPDATE dispositivos SET config_rechazada_version = ?, config_rechazo_errores = ? WHERE id = ?', [c.config_version, JSON.stringify(c.errores), dev.id])
        await crearAlerta(con, { dispositivoId: dev.id, tipo: 'CONFIG_RECHAZADA', severidad: 'ADVERTENCIA', mensaje: `El ESP32 rechazó la configuración v${c.config_version}.`, datos: c.errores })
      }
      if (c.actuadores) {
        const porCodigo = await actuadoresPorCodigo(con, dev.id)
        for (const e of c.actuadores) {
          const a = porCodigo.get(e.actuador)
          if (a) await guardarSnapshot(con, a.id, dev.idArranque, e)
        }
      }
      const d2 = await fila(con, 'SELECT config_version_aplicada FROM dispositivos WHERE id = ?', [dev.id])
      return d2!.config_version_aplicada
    })
    res.json({ data: { config_version_aplicada: r, hora_servidor: ahoraIso() } })
  }),
)

/** 7.6 POST /iot/eventos — deduplicados por (id_arranque, seq); efectos sólo la primera vez. */
rutasIot.post(
  '/eventos',
  asincrono(async (req, res) => {
    const cuerpo = validar(eventos, req.body)
    exigirMismoArranque(req, cuerpo.id_arranque)
    const dev = req.dispositivo!
    const actuadores = await actuadoresPorCodigo(bd(), dev.id)
    let recibidos = 0
    let duplicados = 0
    for (const e of cuerpo.eventos) {
      const act = e.actuador ? actuadores.get(e.actuador) : undefined
      const { fecha, estimada } = horaDato(e.ts, e.uptime_ms, cuerpo.uptime_ms)
      const r = await ejecutar(
        bd(),
        sqlPorMotor({ mysql: `INSERT IGNORE INTO eventos_dispositivo (dispositivo_id, actuador_id, tipo, datos, ocurrido_en, hora_estimada, id_arranque, seq, uptime_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, postgres: `INSERT INTO eventos_dispositivo (dispositivo_id, actuador_id, tipo, datos, ocurrido_en, hora_estimada, id_arranque, seq, uptime_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dispositivo_id, id_arranque, seq) DO NOTHING RETURNING id` }),
        [dev.id, act?.id ?? null, e.tipo, e.datos ? JSON.stringify(e.datos) : null, fecha, estimada ? 1 : 0, cuerpo.id_arranque, e.seq, e.uptime_ms],
      )
      if (r.affectedRows === 0) {
        duplicados++
        continue
      }
      recibidos++
      await efectoEvento(dev.id, act ?? null, e, fecha, cuerpo.id_arranque)
    }
    res.json({ data: { recibidos, duplicados, hora_servidor: ahoraIso() } })
  }),
)

async function efectoEvento(dispositivoId: number, act: Fila | null, e: z.infer<typeof evento>, fecha: Date, arranque: string) {
  const d = (e.datos ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  switch (e.tipo) {
    case 'RIEGO_INICIADO':
      // Nombres del contrato §7.5; se aceptan también duracion_s/humedad_inicio_pct (firmware 0.3.0-trial, pendiente de alinear con Codex).
      if (act)
        await ejecutar(
          bd(),
          'INSERT INTO ciclos_riego (actuador_id, zona_id, orden_id, id_arranque, origen, iniciado_en, duracion_programada_s, humedad_inicio_pct) VALUES (?, ?, (SELECT id FROM ordenes_riego WHERE id = ? AND dispositivo_id = ?), ?, ?, ?, ?, ?) RETURNING id',
          [act.id, act.zona_id, num(d.id_orden), dispositivoId, arranque, String(d.origen ?? 'AUTOMATICO').slice(0, 20), fecha, num(d.duracion_programada_s ?? d.duracion_s), num(d.humedad_pct ?? d.humedad_inicio_pct)],
        )
      break
    case 'RIEGO_FINALIZADO':
      if (act)
        await ejecutar(
          bd(),
          sqlPorMotor({ mysql: `UPDATE ciclos_riego SET finalizado_en = ?, duracion_s = ?, motivo_fin = ?, humedad_fin_pct = ?
            WHERE actuador_id = ? AND finalizado_en IS NULL ORDER BY iniciado_en DESC, id DESC LIMIT 1`, postgres: `UPDATE ciclos_riego SET finalizado_en = ?, duracion_s = ?, motivo_fin = ?, humedad_fin_pct = ?
            WHERE id = (SELECT id FROM ciclos_riego WHERE actuador_id = ? AND finalizado_en IS NULL ORDER BY iniciado_en DESC, id DESC LIMIT 1 FOR UPDATE)` }),
          [fecha, num(d.duracion_s), String(d.motivo_fin ?? 'DESCONOCIDO').slice(0, 30), num(d.humedad_fin_pct), act.id],
        )
      break
    case 'BLOQUEO_ACTIVADO':
      await crearAlerta(bd(), {
        dispositivoId,
        tipo: 'BLOQUEO_ACTIVADO',
        severidad: d.tipo === 'CRITICO' ? 'CRITICA' : 'ADVERTENCIA',
        mensaje: `Bloqueo ${String(d.tipo)} #${String(d.id_bloqueo)}: ${String(d.causa)}`,
        datos: d,
        clave: `BLOQUEO:${act?.id ?? 0}:${String(d.id_bloqueo)}`,
      })
      break
    case 'BLOQUEO_LIBERADO':
      await resolverAlerta(bd(), `BLOQUEO:${act?.id ?? 0}:${String(d.id_bloqueo)}`)
      break
    case 'FALLA_SENSOR':
      await crearAlerta(bd(), { dispositivoId, tipo: 'FALLA_SENSOR', severidad: 'CRITICA', mensaje: `Falla del sensor ${String(d.sensor ?? '')}`, datos: d })
      break
    case 'SENSOR_RECUPERADO':
      await resolverAlerta(bd(), `FALLA_SENSOR:${dispositivoId}`)
      break
    case 'ARRANQUE':
      if (d.motivo_reinicio && !['POWERON', 'SOFTWARE'].includes(String(d.motivo_reinicio)))
        await crearAlerta(bd(), { dispositivoId, tipo: 'REINICIO_INESPERADO', severidad: 'ADVERTENCIA', mensaje: `Reinicio por ${String(d.motivo_reinicio)}`, datos: d, clave: `REINICIO:${dispositivoId}:${arranque}` })
      await ejecutar(bd(), 'UPDATE arranques_dispositivo SET motivo_reinicio = ?, version_firmware = ? WHERE dispositivo_id = ? AND id_arranque = ?', [
        d.motivo_reinicio ? String(d.motivo_reinicio).slice(0, 20) : null, d.version_firmware ? String(d.version_firmware).slice(0, 16) : null, dispositivoId, arranque,
      ])
      break
    case 'CORTE_RESPALDO':
      await crearAlerta(bd(), { dispositivoId, tipo: 'BLOQUEO_ACTIVADO', severidad: 'CRITICA', mensaje: 'Se disparó el corte de respaldo del relé.', datos: d, clave: `CORTE:${dispositivoId}:${arranque}:${e.seq}` })
      break
    case 'DATOS_DESCARTADOS':
      await crearAlerta(bd(), { dispositivoId, tipo: 'DATOS_PERDIDOS', severidad: 'ADVERTENCIA', mensaje: 'El ESP32 descartó datos por desbordamiento de búfer.', datos: d, clave: `DATOS:${dispositivoId}:${arranque}:${e.seq}` })
      break
    case 'CONFIG_RECHAZADA':
      await crearAlerta(bd(), { dispositivoId, tipo: 'CONFIG_RECHAZADA', severidad: 'ADVERTENCIA', mensaje: 'El ESP32 rechazó una configuración.', datos: d })
      break
    default:
      break // tipos desconocidos: se almacenan sin efecto (§7.6)
  }
}
