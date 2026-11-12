// ============================================================================
// SIMULADOR DE ESP32 (no es firmware ni controla hardware).
// Habla con el backend real por la API /iot del contrato 1.0.2 para probar el
// flujo extremo a extremo antes de que el firmware de Codex tenga cliente REST.
//
// Uso (backend con IOT_PERMITIR_HTTP_LOCAL=true, sólo desarrollo):
//   SIM_TOKEN=agc_dev_... npm run simulador
// Variables: SIM_URL (por defecto http://127.0.0.1:3000/api/v1), SIM_TANQUE_VACIO=true
// ============================================================================
import 'dotenv/config'
import { randomBytes } from 'node:crypto'

const URL_BASE = process.env.SIM_URL ?? 'http://127.0.0.1:3000/api/v1'
const TOKEN = process.env.SIM_TOKEN ?? ''
const TANQUE_VACIO = process.env.SIM_TANQUE_VACIO === 'true'
if (!/^agc_dev_[\w-]{20,}$/.test(TOKEN)) {
  console.error('Defina SIM_TOKEN con el token del dispositivo (lo imprime npm run db:seed).')
  process.exit(1)
}

const ID_ARRANQUE = randomBytes(4).toString('hex')
const INICIO = Date.now()
const uptime = () => Date.now() - INICIO
const TOPE_ABSOLUTO_RIEGO_S = 600
let seq = 0

type Modo = 'DESHABILITADO' | 'MANUAL' | 'AUTOMATICO'
const s = {
  hum: 42,
  modo: 'DESHABILITADO' as Modo, // arranque seguro (§10.1)
  bomba: 'APAGADA' as 'APAGADA' | 'RIEGO_MANUAL' | 'RIEGO_AUTOMATICO',
  riegoInicio: 0,
  riegoFin: 0,
  ordenActiva: null as number | null,
  descansoHasta: Date.now() + 60_000, // descanso desde el arranque
  bloqueo: null as null | { id_bloqueo: number; tipo: string; causa: string; desde_id_arranque: string; desde_uptime_ms: number; desde_ts: string; liberable_remotamente: boolean },
  secBloqueo: 0,
  rearmes: 0,
  configAplicada: 0,
  calibrada: false,
  control: { umbral_inicio_pct: 30, umbral_parada_pct: 55, riego_max_s: 15, descanso_min_s: 60 },
  maxId: 0,
  barrera: 0,
  diario: new Map<number, Record<string, unknown>>(),
  lecturas: [] as Record<string, unknown>[],
  eventos: [] as Record<string, unknown>[],
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function api(metodo: string, ruta: string, cuerpo?: unknown) {
  const r = await fetch(URL_BASE + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Id-Arranque': ID_ARRANQUE, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    redirect: 'error', // §4.1: nunca seguir redirecciones
  })
  const datos = r.status === 304 ? null : await r.json().catch(() => null)
  if (!r.ok && r.status !== 304) log(`HTTP ${r.status} ${metodo} ${ruta}:`, JSON.stringify(datos?.error ?? datos))
  return { estado: r.status, datos: datos?.data }
}

function evento(tipo: string, datos: Record<string, unknown>) {
  s.eventos.push({ seq: seq++, tipo, actuador: 'BOMBA1', ts: new Date().toISOString(), uptime_ms: uptime(), datos })
  log('evento', tipo, JSON.stringify(datos))
}

function estadoActuador() {
  const ahora = Date.now()
  const regando = s.bomba !== 'APAGADA'
  return {
    actuador: 'BOMBA1',
    modo: s.modo,
    estado_bomba: s.bomba,
    riego_transcurrido_s: regando ? Math.floor((ahora - s.riegoInicio) / 1000) : 0,
    riego_restante_s: regando ? Math.max(0, Math.ceil((s.riegoFin - ahora) / 1000)) : 0,
    descanso_restante_s: Math.max(0, Math.ceil((s.descansoHasta - ahora) / 1000)),
    bloqueo: s.bloqueo,
    id_orden_activa: s.ordenActiva,
    rearmes_remotos_episodio: s.rearmes,
    uptime_ms: uptime(),
  }
}

function encender(estado: 'RIEGO_MANUAL' | 'RIEGO_AUTOMATICO', duracion: number, orden: number | null) {
  s.bomba = estado
  s.riegoInicio = Date.now()
  s.riegoFin = s.riegoInicio + duracion * 1000
  s.ordenActiva = orden
  evento('RIEGO_INICIADO', { origen: estado === 'RIEGO_MANUAL' ? 'MANUAL' : 'AUTOMATICO', humedad_pct: +s.hum.toFixed(1), duracion_programada_s: duracion, id_orden: orden })
}

function apagar(motivo: string) {
  if (s.bomba === 'APAGADA') return
  const dur = Math.round((Date.now() - s.riegoInicio) / 1000)
  const origen = s.bomba === 'RIEGO_MANUAL' ? 'MANUAL' : 'AUTOMATICO'
  s.bomba = 'APAGADA'
  s.descansoHasta = Date.now() + s.control.descanso_min_s * 1000
  evento('RIEGO_FINALIZADO', { origen, motivo_fin: motivo, duracion_s: dur, humedad_fin_pct: +s.hum.toFixed(1), id_orden: s.ordenActiva })
  s.ordenActiva = null
}

function bloquear(tipo: 'CRITICO' | 'PREVENTIVO', causa: string) {
  apagar(causa)
  let t = tipo
  let c = causa
  if (tipo === 'PREVENTIVO' && s.rearmes >= 1) {
    t = 'CRITICO'
    c = 'PREVENTIVO_REPETIDO'
  }
  s.bloqueo = { id_bloqueo: ++s.secBloqueo, tipo: t, causa: c, desde_id_arranque: ID_ARRANQUE, desde_uptime_ms: uptime(), desde_ts: new Date().toISOString(), liberable_remotamente: c !== 'PREVENTIVO_REPETIDO' }
  s.modo = 'DESHABILITADO'
  evento('BLOQUEO_ACTIVADO', { id_bloqueo: s.bloqueo.id_bloqueo, tipo: t, causa: c, liberable_remotamente: s.bloqueo.liberable_remotamente, rearmes_remotos_episodio: s.rearmes })
}

/** Lógica local (§10). */
function tick() {
  const ahora = Date.now()
  const regando = s.bomba !== 'APAGADA'
  s.hum += regando && !TANQUE_VACIO ? 2.2 : -0.1
  s.hum = Math.min(98, Math.max(2, s.hum + (Math.random() - 0.5) * 0.3))
  const c = s.control
  if (regando) {
    if (s.hum >= c.umbral_parada_pct) {
      apagar('UMBRAL_ALCANZADO')
      s.rearmes = 0
    } else if (s.bomba === 'RIEGO_MANUAL' && ahora >= s.riegoFin) apagar('DURACION_CUMPLIDA')
    else if (s.bomba === 'RIEGO_AUTOMATICO' && ahora - s.riegoInicio >= c.riego_max_s * 1000) bloquear('PREVENTIVO', 'TIEMPO_MAXIMO')
  } else if (s.modo === 'AUTOMATICO' && !s.bloqueo && s.calibrada && ahora >= s.descansoHasta && s.hum < c.umbral_inicio_pct) {
    encender('RIEGO_AUTOMATICO', c.riego_max_s, null)
  }
  if (uptime() % 5000 < 1000)
    s.lecturas.push({ seq: seq++, sensor: 'HUM1', tipo: 'HUMEDAD_SUELO', valor_pct: s.calibrada ? +s.hum.toFixed(1) : null, valor_raw: Math.round(3000 - 17 * s.hum), estado: s.calibrada ? 'OK' : 'SIN_CALIBRAR', ts: new Date().toISOString(), uptime_ms: uptime() })
}

/** Procesa una orden (§8.3, §10.3, §10.3.1) y devuelve el ACK. */
function procesar(o: { id: number; tipo: string; parametros: Record<string, unknown>; expira_en: string }) {
  const previo = s.diario.get(o.id)
  if (previo) return previo
  const ack = (resultado: string, codigo: string | null, duracion: number | null = null) => {
    const a = { resultado, codigo_motivo: codigo, mensaje: null, duracion_aplicada_s: duracion, ejecutada_en: new Date().toISOString(), id_arranque_origen: ID_ARRANQUE, uptime_ms: uptime(), config_version: s.configAplicada, estado_actuador: estadoActuador() }
    s.diario.set(o.id, a)
    if (o.tipo !== 'BOMBA_APAGAR') s.maxId = Math.max(s.maxId, o.id)
    return a
  }
  if (o.tipo === 'BOMBA_APAGAR') {
    const estaba = s.bomba !== 'APAGADA'
    apagar('ORDEN_APAGAR')
    if (s.modo === 'AUTOMATICO') s.modo = 'MANUAL'
    s.barrera = Math.max(s.barrera, o.id)
    return ack('EJECUTADA', estaba ? null : 'SIN_CAMBIO')
  }
  if (o.id <= s.maxId) return ack('RECHAZADA', 'ORDEN_DUPLICADA')
  if (o.id < s.barrera) return ack('RECHAZADA', 'ANULADA_POR_APAGAR')
  if (Date.now() >= Date.parse(o.expira_en)) return ack('RECHAZADA', 'ORDEN_CADUCADA')
  if (o.tipo === 'RESTABLECER_BLOQUEO') {
    const p = o.parametros
    if (!s.bloqueo || s.bloqueo.id_bloqueo !== p.id_bloqueo || s.bloqueo.causa !== p.causa) return ack('RECHAZADA', 'BLOQUEO_NO_COINCIDE')
    if (!s.bloqueo.liberable_remotamente) return ack('RECHAZADA', 'BLOQUEO_NO_LIBERABLE')
    if (s.bloqueo.tipo === 'PREVENTIVO' && p.inspeccion_confirmada !== true) return ack('RECHAZADA', 'INSPECCION_NO_CONFIRMADA')
    if (s.bloqueo.tipo === 'PREVENTIVO') s.rearmes = 1
    evento('BLOQUEO_LIBERADO', { id_bloqueo: s.bloqueo.id_bloqueo, por: 'ORDEN', id_orden: o.id })
    s.bloqueo = null
    s.modo = 'DESHABILITADO'
    s.descansoHasta = Date.now() + s.control.descanso_min_s * 1000
    return ack('EJECUTADA', null)
  }
  if (o.tipo !== 'BOMBA_ENCENDER') return ack('RECHAZADA', 'TIPO_DESCONOCIDO')
  if (s.modo !== 'MANUAL') return ack('RECHAZADA', 'MODO_INCORRECTO')
  if (s.bloqueo) return ack('RECHAZADA', 'BLOQUEO_SEGURIDAD')
  if (!s.calibrada) return ack('RECHAZADA', 'SENSOR_INVALIDO')
  if (s.hum >= s.control.umbral_parada_pct) return ack('RECHAZADA', 'HUMEDAD_SUFICIENTE')
  if (Date.now() < s.descansoHasta) return ack('RECHAZADA', 'DESCANSO_ACTIVO')
  if (s.bomba !== 'APAGADA') return ack('RECHAZADA', 'ACTUADOR_OCUPADO')
  const pedida = Number(o.parametros.duracion_s)
  const aplicada = Math.min(pedida, s.control.riego_max_s, TOPE_ABSOLUTO_RIEGO_S)
  encender('RIEGO_MANUAL', aplicada, o.id)
  return ack('EJECUTADA', aplicada < pedida ? 'DURACION_RECORTADA' : null, aplicada)
}

async function sincronizarConfig(version: number) {
  if (version <= s.configAplicada) return
  const r = await api('GET', '/iot/configuracion')
  if (r.estado !== 200) return
  const c = r.datos
  const ctl = c.control.find((x: { actuador: string }) => x.actuador === 'BOMBA1')
  const sen = c.sensores.find((x: { sensor: string }) => x.sensor === 'HUM1')
  if (s.bomba !== 'APAGADA') apagar(ctl.modo !== s.modo ? 'CAMBIO_MODO' : 'CONFIG_ACTUALIZADA') // §9.4
  s.descansoHasta = Math.max(s.descansoHasta, Date.now() + ctl.descanso_min_s * 1000)
  s.control = { umbral_inicio_pct: ctl.umbral_inicio_pct, umbral_parada_pct: ctl.umbral_parada_pct, riego_max_s: ctl.riego_max_s, descanso_min_s: ctl.descanso_min_s }
  s.calibrada = !!sen?.calibracion_confirmada
  s.modo = s.bloqueo ? 'DESHABILITADO' : ctl.modo // una configuración nunca libera un bloqueo
  s.configAplicada = c.config_version
  await api('POST', '/iot/configuracion/confirmacion', { config_version: c.config_version, resultado: 'APLICADA', errores: [], actuadores: [estadoActuador()] })
  log(`configuración v${c.config_version} aplicada: modo ${s.modo}, calibrada=${s.calibrada}`)
}

async function ciclo(n: number) {
  tick()
  if (n % 3 === 0) {
    const r = await api('GET', '/iot/ordenes')
    if (r.estado === 200) {
      for (const o of r.datos.ordenes) {
        const a = procesar(o)
        log(`orden #${o.id} ${o.tipo} -> ${a.resultado}${a.codigo_motivo ? ` (${a.codigo_motivo})` : ''}`)
        await api('POST', `/iot/ordenes/${o.id}/confirmacion`, a)
      }
      await sincronizarConfig(r.datos.config_version)
    }
  }
  if (s.eventos.length) {
    const lote = s.eventos.splice(0, 30)
    const r = await api('POST', '/iot/eventos', { id_arranque: ID_ARRANQUE, uptime_ms: uptime(), eventos: lote })
    if (r.estado >= 500 || r.estado === 0) s.eventos.unshift(...lote)
  }
  if (n % 5 === 0) {
    const lote = s.lecturas.splice(0, 30)
    const r = await api('POST', '/iot/telemetria', {
      id_arranque: ID_ARRANQUE, uptime_ms: uptime(), ts: new Date().toISOString(), version_firmware: '0.0.0-sim', version_contrato: '1.0.2',
      config_version: s.configAplicada,
      seguridad: { hardware_confirmado: true, calibracion_confirmada: s.calibrada, tope_riego_s: TOPE_ABSOLUTO_RIEGO_S, max_id_orden_procesada: s.maxId, reloj_confiable: true, persistencia_ok: true, tls_vigencia: 'VERIFICADOR' },
      red: { rssi_dbm: -60, ip_local: '127.0.0.1' }, diagnostico: { simulador: 1 }, lecturas: lote, actuadores: [estadoActuador()],
    })
    if (r.estado !== 200) s.lecturas.unshift(...lote)
    else await sincronizarConfig(r.datos.config_version)
  }
}

async function principal() {
  log(`SIMULADOR ESP32 · arranque ${ID_ARRANQUE} · ${URL_BASE}${TANQUE_VACIO ? ' · TANQUE VACÍO' : ''}`)
  const salud = await fetch(URL_BASE + '/salud').then((r) => r.json())
  const delta = Math.abs(Date.now() - Date.parse(salud.data.hora_servidor)) / 1000
  if (delta > 30) throw new Error(`Reloj no confiable (Δ ${delta.toFixed(1)} s > 30 s): no se envía el token (§4.2)`)
  evento('ARRANQUE', { motivo_reinicio: 'POWERON', version_firmware: '0.0.0-sim', modo_inicial: s.modo, ordenes_inciertas: [] })
  let n = 0
  for (;;) {
    try {
      await ciclo(n++)
    } catch (e) {
      log('error de red:', (e as Error).message)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

principal().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
