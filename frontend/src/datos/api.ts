// Fuente de datos REAL: backend AgroControl (contrato API IoT 1.0.2, §11).
// Sesión: JWT de acceso en memoria + refresco por cookie HttpOnly (nunca en localStorage).
// Ante fallos del backend conserva los últimos datos, los marca como NO fiables, deshabilita
// las acciones y reintenta con espera creciente (3 s → 15 s).
import type {
  Alerta,
  Ciclo,
  Conexion,
  EnlaceBackend,
  EstadoBomba,
  Evento,
  Finca,
  FuenteDatos,
  Modo,
  Muestra,
  NivelEvento,
  Orden,
  ResultadoAccion,
  OpcionesOrden,
  RolTerreno,
  Terreno,
  TipoOrden,
  VistaPanel,
} from '../tipos/contrato'
import { texto } from '../utilidades/formato'
import { RANGOS, periodoPersonalizado, type Rango, type Tramo } from '../utilidades/historial'

const BASE = '/api/v1'
const INTERVALO_MS = 3000
const INTERVALO_MAX_MS = 15000
const TIEMPO_ESPERA_MS = 8000

export type EstadoSesion =
  | { tipo: 'verificando' }
  | { tipo: 'anonimo'; error?: string }
  | { tipo: 'autenticado'; usuario: { nombre: string; email: string; rol: string } }

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export class ErrorHttp extends Error {
  constructor(public estado: number, public codigo: string, mensaje: string) {
    super(mensaje)
  }
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null)

/**
 * UUID v4 para Idempotency-Key. `crypto.randomUUID` sólo existe en contextos seguros (HTTPS o localhost);
 * en un celular por http://<IP-LAN> se usa `getRandomValues`, disponible en cualquier contexto.
 */
export function claveIdempotencia(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Mensaje accionable cuando el backend rechaza el origen de la página (CORS_ORIGENES del backend). */
export const mensajeOrigen = () =>
  `El backend no admite el origen ${window.location.origin}. Añádalo a CORS_ORIGENES en backend/.env y reinicie el backend.`

export class FuenteApi implements FuenteDatos {
  readonly esDemo = false
  private token: string | null = null
  private sesionActual: EstadoSesion = { tipo: 'verificando' }
  private vistaActual: VistaPanel | null = null
  private sinDispositivo = false
  private enlace: EnlaceBackend = { ok: true, ultima_actualizacion: null, error: null, fallos_consecutivos: 0 }
  private ids: { dispositivo: number; sensor: number | null; actuador: number | null; zona: number | null; actuadorCodigo: string } | null = null
  private terrenos: Terreno[] = []
  private terrenoActual: number | null = null
  /** Dispositivo elegido por el usuario en la pantalla Finca (si no, el primero con datos). */
  private preferido: number | null = null
  private oyentes = new Set<() => void>()
  private temporizador: ReturnType<typeof setTimeout> | null = null
  private activo = false
  private instantanea: { sesion: EstadoSesion; vista: VistaPanel | null; error: string | null; sinDispositivo: boolean } | null = null

  constructor() {
    void this.restaurarSesion()
  }

  // ---------------------------------------------------------------- suscripción
  suscribir(oyente: () => void) {
    this.oyentes.add(oyente)
    return () => this.oyentes.delete(oyente)
  }
  estado() {
    if (!this.instantanea)
      this.instantanea = { sesion: this.sesionActual, vista: this.vistaActual, error: this.enlace.error, sinDispositivo: this.sinDispositivo }
    return this.instantanea
  }
  vista(): VistaPanel {
    if (!this.vistaActual) throw new Error('Sin datos todavía')
    return this.vistaActual
  }
  private publicar() {
    this.instantanea = null
    for (const o of this.oyentes) o()
  }

  // ---------------------------------------------------------------- HTTP
  private async http(ruta: string, opciones: RequestInit = {}, reintentar = true): Promise<Json> {
    let r: Response
    try {
      r = await fetch(BASE + ruta, {
        ...opciones,
        credentials: 'same-origin',
        signal: AbortSignal.timeout(TIEMPO_ESPERA_MS),
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(opciones.headers ?? {}) },
      })
    } catch {
      throw new ErrorHttp(0, 'BACKEND_NO_DISPONIBLE', 'No hay respuesta del backend.')
    }
    const cuerpo = await r.json().catch(() => ({}))
    if (r.status === 401 && reintentar && !ruta.startsWith('/auth/')) {
      if (await this.refrescar()) return this.http(ruta, opciones, false)
    }
    if (!r.ok) {
      // El proxy de Vite devuelve 5xx sin cuerpo JSON cuando el backend está apagado.
      const codigo = cuerpo?.error?.codigo ?? (r.status >= 500 ? 'BACKEND_NO_DISPONIBLE' : 'ERROR')
      throw new ErrorHttp(r.status, codigo, cuerpo?.error?.mensaje ?? (r.status >= 500 ? 'El backend no responde.' : `HTTP ${r.status}`))
    }
    return cuerpo
  }

  private refrescando: Promise<boolean> | null = null

  /**
   * Un solo refresco a la vez: el token de refresco rota en cada uso y el backend revoca la
   * sesión entera si recibe uno ya usado. Dos peticiones que caducan a la vez comparten esta promesa.
   */
  private refrescar(): Promise<boolean> {
    this.refrescando ??= this.refrescarUnaVez().finally(() => {
      this.refrescando = null
    })
    return this.refrescando
  }

  private async refrescarUnaVez(): Promise<boolean> {
    try {
      const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(TIEMPO_ESPERA_MS) })
      if (r.status >= 500) throw new ErrorHttp(r.status, 'BACKEND_NO_DISPONIBLE', 'El backend no responde.')
      if (!r.ok) {
        const codigo = (await r.json().catch(() => ({})))?.error?.codigo
        throw new ErrorHttp(r.status, codigo ?? 'NO_AUTENTICADO', 'sesión')
      }
      const d = (await r.json()).data
      this.token = d.token_acceso
      this.sesionActual = { tipo: 'autenticado', usuario: d.usuario }
      return true
    } catch (e) {
      const teniaSesion = this.sesionActual.tipo === 'autenticado'
      this.token = null
      this.detener()
      const codigo = e instanceof ErrorHttp ? e.codigo : null
      const caido = codigo === 'BACKEND_NO_DISPONIBLE' || (e as Error).name === 'TimeoutError' || (e as Error).name === 'TypeError'
      this.sesionActual = {
        tipo: 'anonimo',
        error: caido
          ? 'No hay conexión con el backend. ¿Está en marcha (npm run dev en backend/)?'
          : codigo === 'ORIGEN_NO_PERMITIDO'
            ? mensajeOrigen()
            : teniaSesion
              ? 'Su sesión terminó. Inicie sesión de nuevo.'
              : undefined,
      }
      this.publicar()
      return false
    }
  }

  private async restaurarSesion() {
    if (await this.refrescar()) await this.iniciar()
  }

  async iniciarSesion(email: string, password: string) {
    try {
      const d = (await this.http('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })).data
      this.token = d.token_acceso
      this.sesionActual = { tipo: 'autenticado', usuario: d.usuario }
      this.publicar()
      await this.iniciar()
    } catch (e) {
      this.sesionActual = {
        tipo: 'anonimo',
        error: e instanceof ErrorHttp ? (e.codigo === 'ORIGEN_NO_PERMITIDO' ? mensajeOrigen() : e.message) : 'No se pudo conectar con el backend.',
      }
      this.publicar()
    }
  }

  async cerrarSesion() {
    await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
    this.token = null
    this.detener()
    this.vistaActual = null
    this.ids = null
    this.terrenos = []
    this.preferido = null
    this.sesionActual = { tipo: 'anonimo' }
    this.publicar()
  }

  // ---------------------------------------------------------------- carga periódica con espera creciente
  private async iniciar() {
    this.detener()
    this.activo = true
    await this.ciclo()
  }
  private detener() {
    this.activo = false
    if (this.temporizador) clearTimeout(this.temporizador)
    this.temporizador = null
  }
  private async ciclo() {
    await this.cargar()
    if (!this.activo) return
    const espera = this.enlace.ok ? INTERVALO_MS : Math.min(INTERVALO_MAX_MS, INTERVALO_MS * 2 ** Math.max(0, this.enlace.fallos_consecutivos - 1))
    this.temporizador = setTimeout(() => void this.ciclo(), espera)
  }

  /** Terrenos visibles y sus dispositivos (GET /terrenos y /terrenos/{id}/dispositivos). */
  private async cargarTerrenos(): Promise<Terreno[]> {
    const terrenos = (await this.http('/terrenos')).data as Json[]
    const dispositivos = await Promise.all(terrenos.map((t) => this.http(`/terrenos/${t.id}/dispositivos`).then((r) => r.data as Json[])))
    return terrenos.map((t, i) => ({
      id: t.id,
      nombre: t.nombre,
      ubicacion: t.ubicacion ?? null,
      rol: t.rol as RolTerreno,
      dispositivos: dispositivos[i].map((d) => ({ id: d.id, uid: d.uid, nombre: d.nombre, estado: d.estado, conexion: d.conexion as Conexion, ultima_conexion_en: ms(d.ultima_conexion_en) })),
    }))
  }

  private async localizarDispositivo() {
    this.terrenos = await this.cargarTerrenos()
    const todos = this.terrenos.flatMap((t) => t.dispositivos.map((d) => ({ terreno: t.id, id: d.id })))
    const elegido = todos.find((d) => d.id === this.preferido) ?? todos[0]
    this.terrenoActual = elegido?.terreno ?? null
    return elegido?.id ?? null
  }

  /** Actualiza la lista de terrenos y dispositivos (pantalla Finca). */
  async actualizarFinca() {
    try {
      this.terrenos = await this.cargarTerrenos()
      if (this.vistaActual?.finca) this.vistaActual = { ...this.vistaActual, finca: { ...this.vistaActual.finca, terrenos: this.terrenos } }
      this.publicar()
    } catch {
      // El ciclo periódico ya informa la falta de conexión.
    }
  }

  /** Cambia el dispositivo mostrado en el panel. */
  async seleccionarDispositivo(id: number) {
    if (this.ids?.dispositivo === id) return
    this.preferido = id
    this.ids = null
    this.vistaActual = null
    this.publicar()
    await this.cargar()
  }

  /** Recarga inmediata (tras una acción). */
  async recargar() {
    await this.cargar()
  }

  private async cargar() {
    try {
      if (!this.ids) {
        const id = await this.localizarDispositivo()
        this.sinDispositivo = id === null
        if (id === null) {
          this.enlace = { ok: true, ultima_actualizacion: Date.now(), error: null, fallos_consecutivos: 0 }
          return this.publicar()
        }
        this.ids = { dispositivo: id, sensor: null, actuador: null, zona: null, actuadorCodigo: 'BOMBA1' }
      }
      const idD = this.ids.dispositivo
      const estado = (await this.http(`/dispositivos/${idD}/estado`)).data
      const sensor = estado.sensores[0] ?? null
      const actuador = estado.actuadores[0] ?? null
      this.ids.sensor = sensor?.id ?? null
      this.ids.actuador = actuador?.id ?? null
      this.ids.zona = sensor?.zona?.id ?? null
      this.ids.actuadorCodigo = actuador?.codigo ?? 'BOMBA1'
      const [mediciones, ordenes, eventos, riegos, alertas] = await Promise.all([
        sensor ? this.http(`/sensores/${sensor.id}/mediciones`).then((r) => r.data as Json[]) : Promise.resolve([]),
        this.http(`/dispositivos/${idD}/ordenes?limite=12`).then((r) => r.data as Json[]),
        this.http(`/dispositivos/${idD}/eventos`).then((r) => r.data as Json[]),
        this.ids.zona ? this.http(`/zonas/${this.ids.zona}/riegos`).then((r) => r.data as Json[]) : Promise.resolve([]),
        this.http('/alertas').then((r) => r.data as Json[]),
      ])
      this.enlace = { ok: true, ultima_actualizacion: Date.now(), error: null, fallos_consecutivos: 0 }
      this.vistaActual = this.construirVista(estado, sensor, actuador, mediciones, ordenes, eventos, riegos, alertas)
    } catch (e) {
      if (this.sesionActual.tipo !== 'autenticado') return
      this.enlace = {
        ok: false,
        ultima_actualizacion: this.enlace.ultima_actualizacion,
        error: e instanceof ErrorHttp ? (e.codigo === 'BACKEND_NO_DISPONIBLE' ? e.message : `${e.codigo}: ${e.message}`) : 'No se pudo conectar con el backend.',
        fallos_consecutivos: this.enlace.fallos_consecutivos + 1,
      }
      if (this.vistaActual) this.vistaActual = degradar(this.vistaActual, this.enlace)
    }
    this.publicar()
  }

  private construirVista(estado: Json, sensor: Json | null, actuador: Json | null, mediciones: Json[], ordenes: Json[], eventos: Json[], riegos: Json[], alertas: Json[]): VistaPanel {
    const ahora = Date.now()
    const d = estado.dispositivo
    const rep = actuador?.reportado ?? null
    const ciclos: Ciclo[] = riegos.map((c) => ({
      inicio: ms(c.iniciado_en)!,
      fin: ms(c.finalizado_en),
      origen: c.origen === 'MANUAL' ? 'MANUAL' : 'AUTOMATICO',
      duracion_s: c.duracion_s,
      motivo_fin: c.motivo_fin,
      humedad_inicio: c.humedad_inicio_pct,
      humedad_fin: c.humedad_fin_pct,
    }))
    const enRiego = (t: number) => ciclos.some((c) => t >= c.inicio && t <= (c.fin ?? ahora))
    const historial: Muestra[] = mediciones.map((m) => ({ t: ms(m.medido_en)!, pct: m.valor_pct, bomba: enRiego(ms(m.medido_en)!) }))
    const control = actuador?.control ?? { umbral_inicio_pct: 30, umbral_parada_pct: 55, riego_max_s: 15, descanso_min_s: 60 }
    const lectura = sensor?.ultima_lectura ?? null
    const diag = d.diagnostico ?? null
    const finca: Finca | undefined =
      this.terrenoActual !== null
        ? { terrenos: this.terrenos, terreno_id: this.terrenoActual, dispositivo_id: d.id, zona: sensor?.zona ? { id: sensor.zona.id, nombre: sensor.zona.nombre } : null }
        : undefined
    return {
      ahora,
      enlace: this.enlace,
      finca,
      alertas: alertas
        .filter((a) => a.dispositivo_id === d.id && a.estado !== 'RESUELTA')
        .map((a): Alerta => ({ id: a.id, tipo: a.tipo, severidad: a.severidad, mensaje: a.mensaje, estado: a.estado, creada_en: ms(a.creada_en)! })),
      dispositivo: {
        uid: d.uid,
        nombre: d.nombre,
        conexion: d.conexion as Conexion,
        ultima_conexion_en: ms(d.ultima_conexion_en),
        segundos_desde_conexion: d.segundos_desde_conexion ?? 0,
        rssi_dbm: d.rssi_dbm,
        version_firmware: d.version_firmware ?? '—',
        version_contrato: d.version_contrato ?? '—',
        tls_vigencia: d.tls_vigencia ?? '—',
        reloj_confiable: !!d.reloj_confiable,
        persistencia_ok: !!d.persistencia_ok,
        hardware_confirmado: !!d.hardware_confirmado,
        tope_riego_s: d.tope_riego_s ?? 0,
        config_version_deseada: d.config_version_deseada,
        config_version_aplicada: d.config_version_aplicada,
        nunca_conectado: !!d.nunca_conectado,
        diagnostico: diag
          ? { ...diag, arranque_detectado_en: ms(diag.arranque_detectado_en) }
          : undefined,
      },
      sensor: {
        id: sensor?.id,
        raw_seco: sensor?.raw_seco,
        raw_humedo: sensor?.raw_humedo,
        calibrado_en: ms(sensor?.calibrado_en),
        codigo: sensor?.codigo ?? '—',
        modelo: sensor?.modelo ?? '',
        calibracion_confirmada: !!sensor?.calibracion_confirmada,
        valor_pct: lectura?.valor_pct ?? null,
        valor_raw: lectura?.valor_raw ?? null,
        estado: lectura?.estado ?? 'SIN_CALIBRAR',
        medido_en: ms(lectura?.medido_en),
      },
      actuador: {
        codigo: actuador?.codigo ?? '—',
        modo_configurado: (actuador?.modo_configurado ?? 'DESHABILITADO') as Modo,
        reportado: {
          modo: (rep?.modo ?? 'DESHABILITADO') as Modo,
          estado_bomba: (rep?.estado_bomba ?? 'APAGADA') as EstadoBomba,
          riego_transcurrido_s: rep?.riego_transcurrido_s ?? 0,
          riego_restante_s: rep?.riego_restante_s ?? 0,
          descanso_restante_s: rep?.descanso_restante_s ?? 0,
          bloqueo: rep?.bloqueo ? { ...rep.bloqueo, desde: ms(rep.bloqueo.desde_ts) ?? ahora } : null,
          rearmes_remotos_episodio: rep?.rearmes_remotos_episodio ?? 0,
          id_orden_activa: rep?.id_orden_activa ?? null,
          reportado_en: ms(rep?.reportado_en),
          antiguedad_s: rep?.antiguedad_s ?? 0,
          fiable: !!rep?.fiable,
        },
        control: { modo: (actuador?.modo_configurado ?? 'DESHABILITADO') as Modo, ...control },
        valores_de_banco: !!control.valores_de_banco,
        encendido_max_s: estado.servidor?.encendido_max_s,
        acciones: actuador
          ? { ...actuador.acciones_permitidas, modos_no_permitidos: actuador.modos_no_permitidos }
          : { encender: false, apagar: true, rearmar: false, motivo_encender_no_permitido: 'SIN_DATOS' },
      },
      historial,
      ciclos,
      ordenes: ordenes.map(
        (o): Orden => ({
          id: o.id,
          tipo: o.tipo,
          parametros: o.parametros,
          estado: o.estado,
          creada_en: ms(o.creada_en)!,
          expira_en: ms(o.expira_en)!,
          entregada_en: ms(o.entregada_en) ?? undefined,
          confirmada_en: ms(o.confirmada_en) ?? undefined,
          codigo_motivo: o.codigo_motivo,
          duracion_aplicada_s: o.duracion_aplicada_s,
          motivo_cierre: o.motivo_cierre ?? undefined,
        }),
      ),
      eventos: eventos.map((e): Evento => ({ id: e.id, t: ms(e.ocurrido_en)!, tipo: e.tipo, detalle: describirEvento(e), nivel: nivelEvento(e) })),
      escenarios: { conectado: true, falla_sensor: false, tanque_vacio: false },
    }
  }

  // ---------------------------------------------------------------- acciones
  private resultadoError(e: unknown): ResultadoAccion {
    return { ok: false, codigo: e instanceof ErrorHttp ? e.codigo : 'ERROR', mensaje: e instanceof Error ? e.message : 'Error' }
  }

  async enviarOrden(tipo: TipoOrden, parametros: Record<string, unknown>, opciones: OpcionesOrden = {}): Promise<ResultadoAccion> {
    if (!this.ids) return { ok: false, codigo: 'SIN_DISPOSITIVO', mensaje: 'No hay dispositivo cargado.' }
    try {
      const r = await this.http(`/dispositivos/${this.ids.dispositivo}/ordenes`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `${opciones.prefijo_clave ?? ''}${claveIdempotencia()}` },
        body: JSON.stringify({ tipo, actuador: this.ids.actuadorCodigo, parametros, ...(opciones.ttl_s ? { ttl_s: opciones.ttl_s } : {}) }),
      })
      void this.cargar()
      return { ok: true, orden: { ...r.data, creada_en: ms(r.data.creada_en), expira_en: ms(r.data.expira_en) } }
    } catch (e) {
      return this.resultadoError(e)
    }
  }

  async cambiarModo(modo: Modo): Promise<ResultadoAccion> {
    if (!this.ids?.actuador) return { ok: false, codigo: 'SIN_DISPOSITIVO', mensaje: 'No hay actuador cargado.' }
    try {
      await this.http(`/actuadores/${this.ids.actuador}/control`, { method: 'PATCH', body: JSON.stringify({ modo }) })
      void this.cargar()
      return { ok: true }
    } catch (e) {
      return this.resultadoError(e)
    }
  }

  /** PATCH /sensores/{id} — calibración (rol PROPIETARIO). */
  async calibrar(cambios: { raw_seco?: number; raw_humedo?: number; calibracion_confirmada?: boolean }): Promise<ResultadoAccion> {
    if (!this.ids?.sensor) return { ok: false, codigo: 'SIN_DISPOSITIVO', mensaje: 'No hay sensor cargado.' }
    try {
      await this.http(`/sensores/${this.ids.sensor}`, { method: 'PATCH', body: JSON.stringify(cambios) })
      void this.cargar()
      return { ok: true }
    } catch (e) {
      return this.resultadoError(e)
    }
  }

  /** Historial agregado en MySQL (GET /sensores/{id}/mediciones?agrupacion=, contrato §11.1). */
  async historial(rango: Rango | { desde: number; hasta: number }): Promise<Tramo[]> {
    if (!this.ids?.sensor) return []
    const c = typeof rango === 'string' ? { ...RANGOS[rango], desde: Date.now() - RANGOS[rango].ms, hasta: null } : { ...periodoPersonalizado(rango.desde, rango.hasta), ...rango }
    const hasta = c.hasta === null ? '' : `&hasta=${new Date(c.hasta).toISOString()}`
    const r = await this.http(`/sensores/${this.ids.sensor}/mediciones?agrupacion=${c.agrupacion}&desde=${new Date(c.desde).toISOString()}${hasta}&limite=5000`)
    // Un campo ausente o no numérico se trata como "sin dato" (nunca NaN en pantalla).
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    return (r.data as Json[]).map((x) =>
      c.agrupacion === 'crudo'
        ? { t: ms(x.medido_en)!, promedio: num(x.valor_pct), minimo: num(x.valor_pct), maximo: num(x.valor_pct), lecturas: 1 }
        : { t: ms(x.inicio)!, promedio: num(x.promedio_pct), minimo: num(x.minimo_pct), maximo: num(x.maximo_pct), lecturas: num(x.lecturas) ?? 0 },
    )
  }

  /** Todas las alertas visibles (incluidas resueltas) para la pantalla de alertas. */
  async alertasDetalle(): Promise<Alerta[]> {
    const r = await this.http('/alertas')
    const id = this.ids?.dispositivo
    return (r.data as Json[])
      .filter((a) => id === undefined || a.dispositivo_id === id)
      .map((a) => ({ id: a.id, tipo: a.tipo, severidad: a.severidad, mensaje: a.mensaje, estado: a.estado, creada_en: ms(a.creada_en)! }))
  }

  async cambiarAlerta(id: number, accion: 'reconocer' | 'resolver'): Promise<ResultadoAccion> {
    try {
      await this.http(`/alertas/${id}/${accion}`, { method: 'POST' })
      void this.cargar()
      return { ok: true }
    } catch (e) {
      return this.resultadoError(e)
    }
  }
}

/** Datos conservados cuando el backend no responde: nada se presenta como actual. */
export function degradar(v: VistaPanel, enlace: EnlaceBackend): VistaPanel {
  return {
    ...v,
    enlace,
    actuador: {
      ...v.actuador,
      reportado: { ...v.actuador.reportado, fiable: false },
      acciones: {
        encender: false, apagar: false, rearmar: false, motivo_encender_no_permitido: 'BACKEND_NO_DISPONIBLE',
        modos_no_permitidos: { DESHABILITADO: 'BACKEND_NO_DISPONIBLE', MANUAL: 'BACKEND_NO_DISPONIBLE', AUTOMATICO: 'BACKEND_NO_DISPONIBLE' },
      },
    },
  }
}

function describirEvento(e: Json): string {
  const d = (e.datos ?? {}) as Json
  switch (e.tipo) {
    case 'RIEGO_INICIADO':
      return `Riego ${d.origen === 'MANUAL' ? 'manual' : 'automático'} iniciado${d.duracion_programada_s ? ` (${d.duracion_programada_s} s máx.)` : ''}`
    case 'RIEGO_FINALIZADO':
      return `Riego finalizado: ${texto(d.motivo_fin)}`
    case 'BLOQUEO_ACTIVADO':
      return `Bloqueo ${texto(d.tipo).toLowerCase()} #${d.id_bloqueo}: ${texto(d.causa)}`
    case 'BLOQUEO_LIBERADO':
      return `Bloqueo #${d.id_bloqueo} liberado (${d.por === 'LOCAL' ? 'en el dispositivo' : 'por orden remota'})`
    case 'ARRANQUE':
      return `ESP32 arrancó (${d.motivo_reinicio ?? 'motivo desconocido'})`
    case 'CONEXION_RECUPERADA':
      return `Conexión recuperada tras ${d.sin_conexion_s ?? '?'} s (${d.causa ?? ''})`
    default:
      return texto(e.tipo)
  }
}

function nivelEvento(e: Json): NivelEvento {
  if (e.tipo === 'BLOQUEO_ACTIVADO') return e.datos?.tipo === 'CRITICO' ? 'critico' : 'aviso'
  if (['FALLA_SENSOR', 'CORTE_RESPALDO'].includes(e.tipo)) return 'critico'
  if (['DATOS_DESCARTADOS', 'CONFIG_RECHAZADA'].includes(e.tipo) || (e.tipo === 'RIEGO_FINALIZADO' && e.datos?.motivo_fin === 'TIEMPO_MAXIMO')) return 'aviso'
  return 'info'
}
