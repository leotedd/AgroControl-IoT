// Tipos alineados con documentacion/CONTRATO_API_IOT.md v1.0.2.
// La vista del panel reproduce la forma de GET /api/v1/dispositivos/{id}/estado (§11.3),
// ampliada con historial, ciclos, órdenes y eventos para el prototipo.

export type Modo = 'DESHABILITADO' | 'MANUAL' | 'AUTOMATICO'
export type EstadoBomba = 'APAGADA' | 'RIEGO_MANUAL' | 'RIEGO_AUTOMATICO'
export type Conexion = 'EN_LINEA' | 'INESTABLE' | 'FUERA_DE_LINEA'
export type TipoBloqueo = 'CRITICO' | 'PREVENTIVO'
export type TipoOrden = 'BOMBA_ENCENDER' | 'BOMBA_APAGAR' | 'RESTABLECER_BLOQUEO'
export type EstadoOrden =
  | 'PENDIENTE'
  | 'ENTREGADA'
  | 'EJECUTADA'
  | 'RECHAZADA'
  | 'FALLIDA'
  | 'EXPIRADA'
  | 'CANCELADA'
  | 'SIN_CONFIRMAR'
export type EstadoLectura = 'OK' | 'FUERA_DE_RANGO' | 'ERROR_SENSOR' | 'SIN_CALIBRAR'

export interface Bloqueo {
  id_bloqueo: number
  tipo: TipoBloqueo
  causa: string
  causa_original?: string
  desde: number // epoch ms (equivale a desde_ts del contrato)
  liberable_remotamente: boolean
}

export interface Control {
  modo: Modo
  umbral_inicio_pct: number
  umbral_parada_pct: number
  riego_max_s: number
  descanso_min_s: number
}

export interface Orden {
  id: number
  tipo: TipoOrden
  parametros: Record<string, unknown>
  estado: EstadoOrden
  creada_en: number
  expira_en: number
  entregada_en?: number
  confirmada_en?: number
  codigo_motivo?: string | null
  duracion_aplicada_s?: number | null
  motivo_cierre?: string
}

export interface Muestra {
  t: number
  pct: number | null
  bomba: boolean
}

export interface Ciclo {
  inicio: number
  fin: number | null
  origen: 'MANUAL' | 'AUTOMATICO'
  duracion_s: number | null
  motivo_fin: string | null
  humedad_inicio: number | null
  humedad_fin: number | null
}

export type NivelEvento = 'info' | 'aviso' | 'critico'

export interface Evento {
  id: number
  t: number
  tipo: string
  detalle: string
  nivel: NivelEvento
}

export interface AccionesPermitidas {
  encender: boolean
  apagar: boolean
  rearmar: boolean
  motivo_encender_no_permitido: string | null
  /** Motivo por el que el servidor rechazaría (409) activar cada modo; null = permitido. Sólo REAL. */
  modos_no_permitidos?: Partial<Record<Modo, string | null>>
}

export interface DiagnosticoDispositivo {
  id_arranque: string | null
  arranque_detectado_en: number | null
  uptime_ms: number | null
  ultima_ip: string | null
  ip_local: string | null
  token_prefijo: string | null
  max_id_orden_procesada: number | null
  config_rechazada_version: number | null
  config_rechazo_errores: unknown
  contadores: Record<string, unknown> | null
}

export interface Alerta {
  id: number
  tipo: string
  severidad: 'INFO' | 'ADVERTENCIA' | 'CRITICA'
  mensaje: string
  estado: 'ACTIVA' | 'RECONOCIDA' | 'RESUELTA'
  creada_en: number
}

/** Sólo modo REAL: estado de la comunicación navegador ⇄ backend. */
export interface EnlaceBackend {
  ok: boolean
  ultima_actualizacion: number | null
  error: string | null
  fallos_consecutivos: number
}

/** Rol del usuario en un terreno (GET /terrenos). ADMIN global se recibe como PROPIETARIO. */
export type RolTerreno = 'LECTOR' | 'OPERADOR' | 'PROPIETARIO'

/** Dispositivo listado por GET /terrenos/{id}/dispositivos. */
export interface DispositivoTerreno {
  id: number
  uid: string
  nombre: string
  estado: string
  conexion: Conexion
  ultima_conexion_en: number | null
}

export interface Terreno {
  id: number
  nombre: string
  ubicacion: string | null
  rol: RolTerreno
  dispositivos: DispositivoTerreno[]
}

/** Sólo REAL: terrenos visibles, el terreno y dispositivo mostrados, y la zona del sensor (GET /dispositivos/{id}/estado). */
export interface Finca {
  terrenos: Terreno[]
  terreno_id: number
  dispositivo_id: number
  zona: { id: number; nombre: string } | null
}

export interface VistaPanel {
  ahora: number
  enlace?: EnlaceBackend
  finca?: Finca
  alertas?: Alerta[]
  dispositivo: {
    uid: string
    nombre: string
    conexion: Conexion
    ultima_conexion_en: number | null
    segundos_desde_conexion: number
    rssi_dbm: number | null
    version_firmware: string
    version_contrato: string
    tls_vigencia: string
    reloj_confiable: boolean
    persistencia_ok: boolean
    hardware_confirmado: boolean
    tope_riego_s: number
    config_version_deseada: number
    config_version_aplicada: number
    nunca_conectado?: boolean
    diagnostico?: DiagnosticoDispositivo
  }
  sensor: {
    id?: number
    raw_seco?: number
    raw_humedo?: number
    calibrado_en?: number | null
    codigo: string
    modelo: string
    calibracion_confirmada: boolean
    valor_pct: number | null
    valor_raw: number | null
    estado: EstadoLectura
    medido_en: number | null
  }
  actuador: {
    codigo: string
    modo_configurado: Modo
    reportado: {
      modo: Modo
      estado_bomba: EstadoBomba
      riego_transcurrido_s: number
      riego_restante_s: number
      descanso_restante_s: number
      bloqueo: Bloqueo | null
      rearmes_remotos_episodio: number
      id_orden_activa: number | null
      reportado_en: number | null
      antiguedad_s: number
      fiable: boolean
    }
    control: Control
    valores_de_banco: boolean
    acciones: AccionesPermitidas
    /** Tope del servidor para un encendido (ENCENDIDO_MAX_S; primera prueba 5 s). Sólo REAL. */
    encendido_max_s?: number
  }
  historial: Muestra[]
  ciclos: Ciclo[]
  ordenes: Orden[]
  eventos: Evento[]
  escenarios: EscenariosDemo
}

export interface EscenariosDemo {
  conectado: boolean
  falla_sensor: boolean
  tanque_vacio: boolean
}

/** Opciones de POST /dispositivos/{id}/ordenes ya previstas por el contrato (§11.4). */
export interface OpcionesOrden {
  ttl_s?: number
  /** Prefijo del Idempotency-Key (p. ej. 'diag-' para las pruebas de comunicación). */
  prefijo_clave?: string
}

export type ResultadoAccion = { ok: true; orden?: Orden } | { ok: false; codigo: string; mensaje: string }

/** Fuente de datos del panel: hoy el simulador DEMO; mañana el cliente HTTP del backend. */
export interface FuenteDatos {
  readonly esDemo: boolean
  suscribir(oyente: () => void): () => void
  vista(): VistaPanel
  enviarOrden(tipo: TipoOrden, parametros: Record<string, unknown>, opciones?: OpcionesOrden): ResultadoAccion | Promise<ResultadoAccion>
  cambiarModo(modo: Modo): ResultadoAccion | Promise<ResultadoAccion>
}
