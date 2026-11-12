// ============================================================================
// SIMULADOR DEMO — NO controla ningún hardware.
// Modela en el navegador el ESP32 (firmware) y el servidor según el contrato
// API IoT v1.0.2, para poder ver la plataforma funcionando sin el dispositivo.
// Todo lo que produce está marcado como DEMO en la interfaz.
// ============================================================================
import type {
  Bloqueo,
  Ciclo,
  Conexion,
  Control,
  EscenariosDemo,
  EstadoBomba,
  Evento,
  FuenteDatos,
  Modo,
  Muestra,
  NivelEvento,
  Orden,
  ResultadoAccion,
  TipoOrden,
  VistaPanel,
} from '../tipos/contrato'
import { etiquetaTipo, texto } from '../utilidades/formato'

// Parámetros físicos de la simulación (no son parámetros agronómicos).
const SUBIDA_RIEGO_PCT_S = 2.2
const EVAPORACION_PCT_S = 0.1
const RUIDO_PCT = 0.15
const RAW_SECO = 3000
const RAW_HUMEDO = 1300
const TOPE_ABSOLUTO_RIEGO_S = 600
const INTERVALO_SYNC_S = 3 // consulta de órdenes y telemetría (contrato: órdenes cada 3 s)
const INTERVALO_MUESTRA_S = 5
const HISTORIAL_MAX_MS = 2 * 60 * 60 * 1000
const PRECARGA_S = 60 * 60

// Valores de BANCO (contrato §7.4): conservadores, no agronómicos.
const CONTROL_BANCO: Control = {
  modo: 'AUTOMATICO',
  umbral_inicio_pct: 30,
  umbral_parada_pct: 55,
  riego_max_s: 15,
  descanso_min_s: 60,
}

const RANGO_MODO: Record<Modo, number> = { DESHABILITADO: 0, MANUAL: 1, AUTOMATICO: 2 }
const TTL_S: Record<TipoOrden, number> = { BOMBA_ENCENDER: 30, BOMBA_APAGAR: 300, RESTABLECER_BLOQUEO: 60 }
const CAUSAS_REMOTAS = new Set([
  'FALLA_SENSOR',
  'SENSOR_CADUCADO',
  'CONFIG_INVALIDA',
  'CALIBRACION_INVALIDA',
  'TIEMPO_MAXIMO',
  'RESULTADO_INCIERTO_REINICIO',
])

interface Ack {
  resultado: 'EJECUTADA' | 'RECHAZADA' | 'FALLIDA'
  codigo_motivo: string | null
  duracion_aplicada_s: number | null
}

/** Estado interno del "ESP32" simulado. */
interface Dispositivo {
  hum: number
  sensorValido: boolean
  sensorValidoDesde: number | null
  modo: Modo
  bomba: EstadoBomba
  riegoInicio: number
  riegoFin: number
  humInicio: number | null
  ordenActiva: number | null
  descansoHasta: number
  bloqueo: Bloqueo | null
  secuenciaBloqueo: number
  rearmes: number
  control: Control
  configAplicada: number
  maxIdProcesada: number
  barreraApagado: number
  diario: Map<number, Ack>
  buferMuestras: Muestra[]
  rssi: number
}

/** Estado del "servidor" simulado (lo que vería la web a través de la API). */
interface Servidor {
  control: Control
  configDeseada: number
  configAplicada: number
  ordenes: Orden[]
  siguienteId: number
  ultimaConexion: number | null
  reporte: {
    modo: Modo
    bomba: EstadoBomba
    riegoInicio: number
    riegoFin: number
    descansoHasta: number
    bloqueo: Bloqueo | null
    rearmes: number
    ordenActiva: number | null
    pct: number | null
    raw: number | null
    sensorValido: boolean
    medidoEn: number
    rssi: number
    reportadoEn: number
  } | null
  historial: Muestra[]
  ciclos: Ciclo[]
  eventos: Evento[]
}

const r1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

export class SimuladorDemo implements FuenteDatos {
  readonly esDemo = true

  private dev!: Dispositivo
  private srv!: Servidor
  private esc: EscenariosDemo = { conectado: true, falla_sensor: false, tanque_vacio: false }
  private reloj = 0
  private contadorTicks = 0
  private secuenciaEvento = 0
  private oyentes = new Set<() => void>()
  private temporizador: ReturnType<typeof setInterval> | null = null
  private cache: VistaPanel | null = null

  constructor() {
    this.reiniciar()
  }

  // --------------------------------------------------------------- ciclo de vida
  iniciar() {
    if (this.temporizador) return
    this.temporizador = setInterval(() => this.paso(Date.now()), 1000)
  }

  detener() {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
  }

  reiniciar() {
    const ahora = Date.now()
    const inicio = ahora - PRECARGA_S * 1000
    this.reloj = inicio
    this.contadorTicks = 0
    this.esc = { conectado: true, falla_sensor: false, tanque_vacio: false }
    this.dev = {
      hum: 44,
      sensorValido: true,
      sensorValidoDesde: inicio,
      modo: 'AUTOMATICO',
      bomba: 'APAGADA',
      riegoInicio: 0,
      riegoFin: 0,
      humInicio: null,
      ordenActiva: null,
      descansoHasta: 0,
      bloqueo: null,
      secuenciaBloqueo: 0,
      rearmes: 0,
      control: { ...CONTROL_BANCO },
      configAplicada: 3,
      maxIdProcesada: 1000,
      barreraApagado: 0,
      diario: new Map(),
      buferMuestras: [],
      rssi: -61,
    }
    this.srv = {
      control: { ...CONTROL_BANCO },
      configDeseada: 3,
      configAplicada: 3,
      ordenes: [],
      siguienteId: 1001,
      ultimaConexion: inicio,
      reporte: null,
      historial: [],
      ciclos: [],
      eventos: [],
    }
    // Precarga: una hora de funcionamiento automático para que las gráficas tengan historia.
    for (let t = inicio; t <= ahora; t += 1000) this.paso(t, true)
    this.srv.eventos = this.srv.eventos.slice(-6)
    this.evento('DEMO_INICIADA', 'Simulación iniciada con 1 h de historial sintético', 'info')
    this.publicar()
  }

  // ------------------------------------------------------------------- API pública
  suscribir(oyente: () => void) {
    this.oyentes.add(oyente)
    return () => this.oyentes.delete(oyente)
  }

  vista(): VistaPanel {
    if (!this.cache) this.cache = this.construirVista()
    return this.cache
  }

  escenarios() {
    return { ...this.esc }
  }

  cambiarEscenario(cambios: Partial<EscenariosDemo>) {
    const antes = { ...this.esc }
    this.esc = { ...this.esc, ...cambios }
    if (antes.conectado !== this.esc.conectado)
      this.evento(
        this.esc.conectado ? 'CONEXION_RECUPERADA' : 'DEMO_DESCONEXION',
        this.esc.conectado ? 'El ESP32 vuelve a comunicarse' : 'Escenario: el ESP32 deja de comunicarse',
        this.esc.conectado ? 'info' : 'aviso',
      )
    if (antes.falla_sensor !== this.esc.falla_sensor)
      this.evento('DEMO_SENSOR', this.esc.falla_sensor ? 'Escenario: sensor desconectado' : 'Escenario: sensor reconectado', 'aviso')
    if (antes.tanque_vacio !== this.esc.tanque_vacio)
      this.evento('DEMO_TANQUE', this.esc.tanque_vacio ? 'Escenario: tanque vacío (la bomba no aporta agua)' : 'Escenario: tanque rellenado', 'aviso')
    this.publicar()
  }

  /** POST /dispositivos/{id}/ordenes (§11.4) con las comprobaciones previas del servidor. */
  enviarOrden(tipo: TipoOrden, parametros: Record<string, unknown>): ResultadoAccion {
    const ahora = Date.now()
    const s = this.srv
    const rep = s.reporte
    const conexion = this.conexion(ahora)
    const activas = s.ordenes.filter((o) => o.estado === 'PENDIENTE' || o.estado === 'ENTREGADA')

    if (tipo === 'BOMBA_ENCENDER') {
      const dur = Number(parametros.duracion_s)
      if (conexion !== 'EN_LINEA') return this.error('DISPOSITIVO_FUERA_DE_LINEA', 'El ESP32 no está en línea.')
      if (s.control.modo !== 'MANUAL' || rep?.modo !== 'MANUAL')
        return this.error('MODO_NO_MANUAL', 'Encender sólo se permite en modo MANUAL (configurado y efectivo).')
      if (rep?.bloqueo) return this.error('BLOQUEO_ACTIVO', 'Hay un bloqueo de seguridad activo.')
      if (s.configAplicada !== s.configDeseada)
        return this.error('CONFIG_NO_SINCRONIZADA', 'La configuración aún no se ha aplicado en el ESP32.')
      if (activas.some((o) => o.tipo === 'BOMBA_APAGAR'))
        return this.error('APAGADO_PENDIENTE', 'Hay un apagado pendiente de confirmar.')
      if (!Number.isInteger(dur) || dur < 1 || dur > 600) return this.error('VALIDACION_FALLIDA', 'Duración inválida.')
      if (dur > s.control.riego_max_s)
        return this.error('DURACION_EXCEDE_MAXIMO', `La duración supera el máximo configurado (${s.control.riego_max_s} s).`)
      for (const o of activas)
        if (o.tipo === 'BOMBA_ENCENDER' && o.estado === 'PENDIENTE') this.cerrar(o, 'CANCELADA', 'REEMPLAZADA')
    }

    if (tipo === 'RESTABLECER_BLOQUEO') {
      const b = rep?.bloqueo
      if (conexion !== 'EN_LINEA') return this.error('DISPOSITIVO_FUERA_DE_LINEA', 'El ESP32 no está en línea.')
      if (!b || b.id_bloqueo !== parametros.id_bloqueo || b.causa !== parametros.causa)
        return this.error('BLOQUEO_NO_COINCIDE', 'El bloqueo indicado ya no es el activo.')
      if (!b.liberable_remotamente)
        return this.error('BLOQUEO_NO_LIBERABLE_REMOTAMENTE', 'Este bloqueo sólo puede rearmarse en el dispositivo.')
      if (b.tipo === 'PREVENTIVO' && parametros.inspeccion_confirmada !== true)
        return this.error('VALIDACION_FALLIDA', 'Debe confirmar la inspección física.')
    }

    const orden: Orden = {
      id: s.siguienteId++,
      tipo,
      parametros: { ...parametros },
      estado: 'PENDIENTE',
      creada_en: ahora,
      expira_en: ahora + TTL_S[tipo] * 1000,
    }

    if (tipo === 'BOMBA_APAGAR') {
      for (const o of activas)
        if (o.estado === 'PENDIENTE') this.cerrar(o, 'CANCELADA', o.tipo === 'BOMBA_APAGAR' ? 'REEMPLAZADA' : 'REEMPLAZADA_POR_APAGAR')
      if (s.control.modo === 'AUTOMATICO') {
        s.control = { ...s.control, modo: 'MANUAL' }
        s.configDeseada++
        this.evento('MODO_DESEADO', 'Apagar en AUTOMÁTICO cambia el modo configurado a MANUAL', 'info')
      }
    }

    s.ordenes.unshift(orden)
    s.ordenes = s.ordenes.slice(0, 30)
    this.evento('ORDEN_CREADA', `Orden #${orden.id} ${etiquetaTipo(tipo)} enviada`, 'info')
    this.publicar()
    return { ok: true, orden }
  }

  /** PATCH /actuadores/{id}/control (§11.5): sólo cambia la configuración deseada. */
  cambiarModo(modo: Modo): ResultadoAccion {
    const s = this.srv
    if (modo === s.control.modo) return { ok: true }
    if (modo !== 'DESHABILITADO' && s.reporte?.bloqueo)
      return this.error('BLOQUEO_ACTIVO', 'Rearme el bloqueo antes de habilitar un modo.')
    s.control = { ...s.control, modo }
    s.configDeseada++
    this.evento('CONFIG_DESEADA', `Modo configurado: ${modo} (versión ${s.configDeseada})`, 'info')
    this.publicar()
    return { ok: true }
  }

  // --------------------------------------------------------------------- motor
  private paso(t: number, precarga = false) {
    this.reloj = t
    this.contadorTicks++
    this.fisica()
    this.firmware(t)
    if (this.contadorTicks % INTERVALO_MUESTRA_S === 0)
      this.dev.buferMuestras.push({ t, pct: this.lecturaPct(), bomba: this.dev.bomba !== 'APAGADA' })
    if (this.esc.conectado && this.contadorTicks % INTERVALO_SYNC_S === 0) this.sincronizar(t)
    this.tareasServidor(t)
    if (!precarga) this.publicar()
  }

  private fisica() {
    const d = this.dev
    const regando = d.bomba !== 'APAGADA'
    d.hum += regando && !this.esc.tanque_vacio ? SUBIDA_RIEGO_PCT_S : -EVAPORACION_PCT_S
    d.hum += (Math.random() - 0.5) * 2 * RUIDO_PCT
    d.hum = clamp(d.hum, 2, 98)
    d.rssi = Math.round(clamp(d.rssi + (Math.random() - 0.5) * 3, -78, -52))
  }

  private lecturaPct(): number | null {
    return this.dev.sensorValido ? r1(this.dev.hum) : null
  }

  /** Lógica local del ESP32 (contrato §10). */
  private firmware(t: number) {
    const d = this.dev
    const c = d.control

    // Sensor (§10.6): una falla apaga y bloquea de inmediato.
    d.sensorValido = !this.esc.falla_sensor
    if (!d.sensorValido) {
      d.sensorValidoDesde = null
      if (!d.bloqueo || d.bloqueo.tipo !== 'CRITICO') this.bloquear(t, 'CRITICO', 'FALLA_SENSOR')
      return
    }
    if (d.sensorValidoDesde === null) {
      d.sensorValidoDesde = t
      this.evento('SENSOR_RECUPERADO', 'Lecturas válidas de nuevo (el bloqueo no se libera solo)', 'info', t)
    }
    const pct = d.hum

    if (d.bomba !== 'APAGADA') {
      const transcurrido = (t - d.riegoInicio) / 1000
      if (pct >= c.umbral_parada_pct) {
        this.apagar(t, 'UMBRAL_ALCANZADO')
        d.rearmes = 0 // evidencia de que el agua llega (§10.5)
      } else if (d.bomba === 'RIEGO_MANUAL' && t >= d.riegoFin) {
        this.apagar(t, 'DURACION_CUMPLIDA')
      } else if (d.bomba === 'RIEGO_AUTOMATICO' && transcurrido >= c.riego_max_s) {
        this.apagar(t, 'TIEMPO_MAXIMO')
        this.bloquear(t, 'PREVENTIVO', 'TIEMPO_MAXIMO')
      }
      return
    }

    // Lazo AUTOMATICO con histéresis (§10.4).
    if (d.modo === 'AUTOMATICO' && !d.bloqueo && t >= d.descansoHasta && pct < c.umbral_inicio_pct) {
      this.encender(t, 'RIEGO_AUTOMATICO', c.riego_max_s, null)
    }
  }

  private encender(t: number, estado: EstadoBomba, duracion_s: number, orden: number | null) {
    const d = this.dev
    d.bomba = estado
    d.riegoInicio = t
    d.riegoFin = t + duracion_s * 1000
    d.humInicio = r1(d.hum)
    d.ordenActiva = orden
    const origen = estado === 'RIEGO_MANUAL' ? 'MANUAL' : 'AUTOMATICO'
    this.srv.ciclos.push({
      inicio: t,
      fin: null,
      origen,
      duracion_s: null,
      motivo_fin: null,
      humedad_inicio: d.humInicio,
      humedad_fin: null,
    })
    this.srv.ciclos = this.srv.ciclos.slice(-40)
    this.evento('RIEGO_INICIADO', `Riego ${origen === 'MANUAL' ? 'manual' : 'automático'} iniciado (${duracion_s} s máx.)`, 'info', t)
  }

  private apagar(t: number, motivo: string) {
    const d = this.dev
    if (d.bomba === 'APAGADA') return
    d.bomba = 'APAGADA'
    d.ordenActiva = null
    d.descansoHasta = t + d.control.descanso_min_s * 1000
    const ciclo = [...this.srv.ciclos].reverse().find((c) => c.fin === null)
    if (ciclo) {
      ciclo.fin = t
      ciclo.duracion_s = Math.round((t - ciclo.inicio) / 1000)
      ciclo.motivo_fin = motivo
      ciclo.humedad_fin = this.lecturaPct()
    }
    const nivel: NivelEvento = motivo === 'TIEMPO_MAXIMO' || motivo === 'FALLA_SENSOR' ? 'aviso' : 'info'
    this.evento('RIEGO_FINALIZADO', `Riego finalizado: ${texto(motivo)}`, nivel, t)
  }

  /** Bloqueo con escalado por episodio (§10.5). */
  private bloquear(t: number, tipo: 'CRITICO' | 'PREVENTIVO', causa: string) {
    const d = this.dev
    if (d.bomba !== 'APAGADA') this.apagar(t, causa === 'FALLA_SENSOR' ? 'FALLA_SENSOR' : causa)
    let causaFinal = causa
    let tipoFinal = tipo
    let causaOriginal: string | undefined
    if (tipo === 'PREVENTIVO' && d.rearmes >= 1) {
      tipoFinal = 'CRITICO'
      causaFinal = 'PREVENTIVO_REPETIDO'
      causaOriginal = causa
    }
    d.secuenciaBloqueo++
    d.bloqueo = {
      id_bloqueo: d.secuenciaBloqueo,
      tipo: tipoFinal,
      causa: causaFinal,
      causa_original: causaOriginal,
      desde: t,
      liberable_remotamente: CAUSAS_REMOTAS.has(causaFinal),
    }
    if (d.modo !== 'DESHABILITADO') d.modo = 'DESHABILITADO'
    this.evento(
      'BLOQUEO_ACTIVADO',
      `Bloqueo ${tipoFinal} #${d.secuenciaBloqueo}: ${texto(causaFinal)}${causaOriginal ? ` (origen: ${texto(causaOriginal)})` : ''}`,
      tipoFinal === 'CRITICO' ? 'critico' : 'aviso',
      t,
    )
  }

  /** Comunicación ESP32 ⇄ servidor: configuración, órdenes y telemetría (§6–§7). */
  private sincronizar(t: number) {
    const d = this.dev
    const s = this.srv
    s.ultimaConexion = t

    // Configuración (§7.4, §9.4): una versión nueva apaga el riego e inicia descanso.
    if (s.configDeseada > d.configAplicada) {
      const cambiaModo = s.control.modo !== d.control.modo
      if (d.bomba !== 'APAGADA') this.apagar(t, cambiaModo ? 'CAMBIO_MODO' : 'CONFIG_ACTUALIZADA')
      d.descansoHasta = Math.max(d.descansoHasta, t + s.control.descanso_min_s * 1000)
      d.control = { ...s.control }
      d.modo = d.bloqueo ? 'DESHABILITADO' : s.control.modo
      d.configAplicada = s.configDeseada
      this.evento('CONFIG_APLICADA', `ESP32 aplicó la configuración v${d.configAplicada} (modo ${d.modo})`, 'info', t)
    }

    // Órdenes (§8): una por actuador, la de mayor id vigente.
    const vigentes = s.ordenes.filter((o) => (o.estado === 'PENDIENTE' || o.estado === 'ENTREGADA') && o.expira_en > t)
    const orden = vigentes.sort((a, b) => b.id - a.id)[0]
    if (orden) {
      if (orden.estado === 'PENDIENTE') {
        orden.estado = 'ENTREGADA'
        orden.entregada_en = t
      }
      const ack = this.procesarOrden(t, orden)
      orden.estado = ack.resultado
      orden.codigo_motivo = ack.codigo_motivo
      orden.duracion_aplicada_s = ack.duracion_aplicada_s
      orden.confirmada_en = t
      this.evento(
        'ORDEN_CONFIRMADA',
        `Orden #${orden.id} ${etiquetaTipo(orden.tipo)}: ${texto(ack.resultado)}${ack.codigo_motivo ? ` (${texto(ack.codigo_motivo)})` : ''}`,
        ack.resultado === 'EJECUTADA' ? 'info' : 'aviso',
        t,
      )
    }

    // Telemetría (§7.1): lecturas acumuladas y estado real.
    s.historial.push(...d.buferMuestras)
    d.buferMuestras = []
    const corte = t - HISTORIAL_MAX_MS
    while (s.historial.length && s.historial[0].t < corte) s.historial.shift()
    s.configAplicada = d.configAplicada
    s.reporte = {
      modo: d.modo,
      bomba: d.bomba,
      riegoInicio: d.riegoInicio,
      riegoFin: d.bomba === 'RIEGO_AUTOMATICO' ? d.riegoInicio + d.control.riego_max_s * 1000 : d.riegoFin,
      descansoHasta: d.descansoHasta,
      bloqueo: d.bloqueo ? { ...d.bloqueo } : null,
      rearmes: d.rearmes,
      ordenActiva: d.ordenActiva,
      pct: this.lecturaPct(),
      raw: d.sensorValido ? Math.round(RAW_SECO + ((RAW_HUMEDO - RAW_SECO) * d.hum) / 100) : null,
      sensorValido: d.sensorValido,
      medidoEn: t,
      rssi: d.rssi,
      reportadoEn: t,
    }

    // Reconciliación (§9.3): el servidor sólo BAJA el modo deseado.
    if (d.configAplicada === s.configDeseada && RANGO_MODO[d.modo] < RANGO_MODO[s.control.modo]) {
      s.control = { ...s.control, modo: d.modo }
      s.configDeseada++
      this.evento('MODO_RECONCILIADO', `El sistema bajó el modo configurado a ${d.modo} (seguridad)`, 'aviso', t)
    }
  }

  /** Procesamiento de una orden en el ESP32 (§8.3, §10.3, §10.3.1). */
  private procesarOrden(t: number, o: Orden): Ack {
    const d = this.dev
    const previo = d.diario.get(o.id)
    if (previo) return previo
    const registrar = (ack: Ack) => {
      d.diario.set(o.id, ack)
      // §8.3.3: BOMBA_APAGAR no mueve la marca de agua global (usa la barrera por actuador).
      if (o.tipo !== 'BOMBA_APAGAR') d.maxIdProcesada = Math.max(d.maxIdProcesada, o.id)
      return ack
    }
    const rechazo = (codigo: string): Ack => registrar({ resultado: 'RECHAZADA', codigo_motivo: codigo, duracion_aplicada_s: null })

    if (o.tipo === 'BOMBA_APAGAR') {
      const estabaEncendida = d.bomba !== 'APAGADA'
      this.apagar(t, 'ORDEN_APAGAR')
      if (d.modo === 'AUTOMATICO') d.modo = 'MANUAL'
      d.barreraApagado = Math.max(d.barreraApagado, o.id)
      return registrar({ resultado: 'EJECUTADA', codigo_motivo: estabaEncendida ? null : 'SIN_CAMBIO', duracion_aplicada_s: null })
    }

    if (o.id <= d.maxIdProcesada) return rechazo('ORDEN_DUPLICADA')
    if (o.id < d.barreraApagado) return rechazo('ANULADA_POR_APAGAR')
    if (t >= o.expira_en) return rechazo('ORDEN_CADUCADA')

    if (o.tipo === 'RESTABLECER_BLOQUEO') {
      const b = d.bloqueo
      const p = o.parametros
      if (!b || b.id_bloqueo !== p.id_bloqueo || b.causa !== p.causa) return rechazo('BLOQUEO_NO_COINCIDE')
      if (!b.liberable_remotamente) return rechazo('BLOQUEO_NO_LIBERABLE')
      if (b.tipo === 'PREVENTIVO' && p.inspeccion_confirmada !== true) return rechazo('INSPECCION_NO_CONFIRMADA')
      const sensorEstable = d.sensorValido && d.sensorValidoDesde !== null && t - d.sensorValidoDesde >= 10_000
      if (!sensorEstable || d.bomba !== 'APAGADA') return rechazo('BLOQUEO_NO_LIBERABLE')
      if (b.tipo === 'PREVENTIVO') d.rearmes = 1
      d.bloqueo = null
      d.modo = 'DESHABILITADO'
      d.descansoHasta = t + d.control.descanso_min_s * 1000
      this.evento('BLOQUEO_LIBERADO', `Bloqueo #${b.id_bloqueo} liberado por orden remota`, 'info', t)
      return registrar({ resultado: 'EJECUTADA', codigo_motivo: null, duracion_aplicada_s: null })
    }

    // BOMBA_ENCENDER (§10.3)
    if (d.modo !== 'MANUAL') return rechazo('MODO_INCORRECTO')
    if (d.bloqueo) return rechazo('BLOQUEO_SEGURIDAD')
    if (!d.sensorValido) return rechazo('SENSOR_INVALIDO')
    if (d.hum >= d.control.umbral_parada_pct) return rechazo('HUMEDAD_SUFICIENTE')
    if (t < d.descansoHasta) return rechazo('DESCANSO_ACTIVO')
    if (d.bomba !== 'APAGADA') return rechazo('ACTUADOR_OCUPADO')
    const solicitada = Number(o.parametros.duracion_s)
    const aplicada = Math.min(solicitada, d.control.riego_max_s, TOPE_ABSOLUTO_RIEGO_S)
    this.encender(t, 'RIEGO_MANUAL', aplicada, o.id)
    return registrar({
      resultado: 'EJECUTADA',
      codigo_motivo: aplicada < solicitada ? 'DURACION_RECORTADA' : null,
      duracion_aplicada_s: aplicada,
    })
  }

  /** Caducidad (§8.6). */
  private tareasServidor(t: number) {
    for (const o of this.srv.ordenes) {
      if (o.estado === 'PENDIENTE' && t >= o.expira_en) this.cerrar(o, 'EXPIRADA', 'VENCIDA_SIN_ENTREGA')
      else if (o.estado === 'ENTREGADA' && t >= o.expira_en + 30_000) this.cerrar(o, 'SIN_CONFIRMAR', 'SIN_ACK')
    }
  }

  // ------------------------------------------------------------------- auxiliares
  private cerrar(o: Orden, estado: Orden['estado'], motivo: string) {
    o.estado = estado
    o.motivo_cierre = motivo
  }

  private error(codigo: string, mensaje: string): ResultadoAccion {
    return { ok: false, codigo, mensaje }
  }

  private evento(tipo: string, detalle: string, nivel: NivelEvento, t = this.reloj) {
    this.srv.eventos.push({ id: ++this.secuenciaEvento, t, tipo, detalle, nivel })
    if (this.srv.eventos.length > 60) this.srv.eventos.shift()
  }

  private conexion(ahora: number): Conexion {
    const u = this.srv.ultimaConexion
    if (u === null) return 'FUERA_DE_LINEA'
    const s = (ahora - u) / 1000
    return s <= 30 ? 'EN_LINEA' : s <= 120 ? 'INESTABLE' : 'FUERA_DE_LINEA'
  }

  private publicar() {
    this.cache = null
    for (const o of this.oyentes) o()
  }

  private construirVista(): VistaPanel {
    const ahora = Date.now()
    const s = this.srv
    const rep = s.reporte
    const conexion = this.conexion(ahora)
    const fiable = conexion === 'EN_LINEA'
    const bomba = rep?.bomba ?? 'APAGADA'
    const regando = bomba !== 'APAGADA'
    const restante = regando && rep ? Math.max(0, Math.ceil((rep.riegoFin - ahora) / 1000)) : 0
    const transcurrido = regando && rep ? Math.max(0, Math.floor((ahora - rep.riegoInicio) / 1000)) : 0
    const descanso = rep ? Math.max(0, Math.ceil((rep.descansoHasta - ahora) / 1000)) : 0
    const activas = s.ordenes.filter((o) => o.estado === 'PENDIENTE' || o.estado === 'ENTREGADA')

    // acciones_permitidas (§11.3): ayuda de interfaz; la decisión final es del ESP32.
    let motivo: string | null = null
    if (!fiable) motivo = 'DISPOSITIVO_FUERA_DE_LINEA'
    else if (rep?.bloqueo) motivo = 'BLOQUEO_ACTIVO'
    else if (s.control.modo !== 'MANUAL' || rep?.modo !== 'MANUAL') motivo = 'MODO_NO_MANUAL'
    else if (s.configAplicada !== s.configDeseada) motivo = 'CONFIG_NO_SINCRONIZADA'
    else if (!rep?.sensorValido) motivo = 'SENSOR_INVALIDO'
    else if (regando) motivo = 'ACTUADOR_OCUPADO'
    else if (descanso > 0) motivo = 'DESCANSO_ACTIVO'
    else if ((rep?.pct ?? 0) >= s.control.umbral_parada_pct) motivo = 'HUMEDAD_SUFICIENTE'
    else if (activas.some((o) => o.tipo === 'BOMBA_APAGAR')) motivo = 'APAGADO_PENDIENTE'

    return {
      ahora,
      dispositivo: {
        uid: 'AGC-ESP32-0001',
        nombre: 'ESP32 Banco (DEMO)',
        conexion,
        ultima_conexion_en: s.ultimaConexion,
        segundos_desde_conexion: s.ultimaConexion ? Math.round((ahora - s.ultimaConexion) / 1000) : 0,
        rssi_dbm: rep?.rssi ?? null,
        version_firmware: '0.2.0-demo',
        version_contrato: '1.0.2',
        tls_vigencia: 'VERIFICADOR',
        reloj_confiable: true,
        persistencia_ok: true,
        hardware_confirmado: true,
        tope_riego_s: TOPE_ABSOLUTO_RIEGO_S,
        config_version_deseada: s.configDeseada,
        config_version_aplicada: s.configAplicada,
      },
      sensor: {
        codigo: 'HUM1',
        modelo: 'Capacitivo D43',
        calibracion_confirmada: true,
        valor_pct: rep?.pct ?? null,
        valor_raw: rep?.raw ?? null,
        estado: rep?.sensorValido === false ? 'ERROR_SENSOR' : 'OK',
        medido_en: rep?.medidoEn ?? null,
      },
      actuador: {
        codigo: 'BOMBA1',
        modo_configurado: s.control.modo,
        reportado: {
          modo: rep?.modo ?? 'DESHABILITADO',
          estado_bomba: bomba,
          riego_transcurrido_s: transcurrido,
          riego_restante_s: restante,
          descanso_restante_s: descanso,
          bloqueo: rep?.bloqueo ?? null,
          rearmes_remotos_episodio: rep?.rearmes ?? 0,
          id_orden_activa: rep?.ordenActiva ?? null,
          reportado_en: rep?.reportadoEn ?? null,
          antiguedad_s: rep ? Math.round((ahora - rep.reportadoEn) / 1000) : 0,
          fiable,
        },
        control: { ...s.control },
        valores_de_banco: true,
        acciones: {
          encender: motivo === null,
          apagar: true,
          rearmar: fiable && !!rep?.bloqueo?.liberable_remotamente,
          motivo_encender_no_permitido: motivo,
        },
      },
      historial: s.historial,
      ciclos: s.ciclos,
      ordenes: s.ordenes.slice(0, 12),
      eventos: [...s.eventos].reverse().slice(0, 30),
      escenarios: { ...this.esc },
    }
  }
}

export { etiquetaTipo } from '../utilidades/formato'
