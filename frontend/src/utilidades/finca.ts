// Traducción del estado técnico a lenguaje sencillo para quien maneja la finca.
// Funciones puras (probadas): no inventan datos; sólo interpretan la vista recibida del backend o del simulador DEMO.
import type { RolTerreno, VistaPanel } from '../tipos/contrato'
import { evaluarBomba } from './bomba'
import { DATOS_AL_DIA_S, DATOS_VIEJOS_S } from './comunicacion'
import { haceTiempo, texto } from './formato'
import { describirZonas, numero, zonaHumedad } from './humedad'

export type Nivel = 'ok' | 'atencion' | 'problema' | 'neutro'
export type ClavePieza = 'servidor' | 'equipo' | 'sensor' | 'bomba'

/** Una de las cuatro partes del sistema, explicada para alguien sin conocimientos técnicos. */
export interface Pieza {
  clave: ClavePieza
  titulo: string
  estado: string
  nivel: Nivel
  /** Qué significa este estado. */
  explicacion: string
  /** Qué hacer (sólo si hay algo que hacer). */
  queHacer?: string
  /** Momento del último dato que respalda el estado (epoch ms). */
  actualizado: number | null
}

const segundosDesde = (v: VistaPanel, t: number | null) => (t === null ? null : Math.max(0, Math.round((v.ahora - t) / 1000)))

export function piezaServidor(v: VistaPanel, esDemo: boolean): Pieza {
  if (esDemo)
    return {
      clave: 'servidor', titulo: 'Servidor', estado: 'Simulado', nivel: 'neutro', actualizado: v.ahora,
      explicacion: 'En la demostración no hay servidor: los datos se generan dentro de este navegador.',
    }
  const e = v.enlace
  if (e && !e.ok)
    return {
      clave: 'servidor', titulo: 'Servidor', estado: 'Sin conexión', nivel: 'problema', actualizado: e.ultima_actualizacion,
      explicacion: 'La página no logra comunicarse con el servidor de AgroControl. Lo que ve son los últimos datos recibidos.',
      queHacer: 'Compruebe que el computador del servidor esté encendido y en la misma red. La página reintenta sola.',
    }
  return {
    clave: 'servidor', titulo: 'Servidor', estado: 'Conectado', nivel: 'ok', actualizado: e?.ultima_actualizacion ?? v.ahora,
    explicacion: 'El servidor y la base de datos responden: los datos de esta página están actualizados.',
  }
}

export function piezaEquipo(v: VistaPanel, esDemo: boolean): Pieza {
  const d = v.dispositivo
  const base = { clave: 'equipo' as const, titulo: 'Equipo de campo', actualizado: d.ultima_conexion_en }
  if (!esDemo && v.enlace && !v.enlace.ok)
    return { ...base, estado: 'Desconocido', nivel: 'neutro', explicacion: 'Sin conexión con el servidor no se puede saber si el equipo (ESP32) está comunicando.' }
  if (d.nunca_conectado || d.ultima_conexion_en === null)
    return {
      ...base, estado: 'Aún no se conecta', nivel: 'atencion',
      explicacion: 'El equipo de campo (ESP32) todavía no ha enviado ningún dato a la plataforma.',
      queHacer: 'Encienda el equipo y verifique que tenga Wi-Fi. Los pasos de instalación están en la sección Equipo.',
    }
  if (d.conexion === 'EN_LINEA')
    return { ...base, estado: 'Conectado', nivel: 'ok', explicacion: `El equipo de campo envió datos ${haceTiempo(d.segundos_desde_conexion)}.` }
  if (d.conexion === 'INESTABLE')
    return {
      ...base, estado: 'Conexión intermitente', nivel: 'atencion',
      explicacion: `El equipo no se comunica desde ${haceTiempo(d.segundos_desde_conexion).replace('hace ', '')}; puede ser una señal Wi-Fi débil.`,
      queHacer: 'Acerque el punto de acceso Wi-Fi al equipo o revise que el hotspot siga encendido.',
    }
  return {
    ...base, estado: 'Sin conexión', nivel: 'problema',
    explicacion: `El equipo de campo no se comunica desde ${haceTiempo(d.segundos_desde_conexion).replace('hace ', '')}. Sus reglas de seguridad siguen funcionando localmente.`,
    queHacer: 'Revise que el ESP32 tenga energía y que el Wi-Fi (hotspot) esté encendido y al alcance.',
  }
}

export function piezaSensor(v: VistaPanel): Pieza {
  const s = v.sensor
  const edad = segundosDesde(v, s.medido_en)
  const base = { clave: 'sensor' as const, titulo: 'Sensor de humedad', actualizado: s.medido_en }
  if (!s.calibracion_confirmada)
    return {
      ...base, estado: 'Sin calibrar', nivel: 'atencion',
      explicacion: 'El sensor aún no tiene una calibración confirmada, así que el porcentaje de humedad no es confiable y el riego queda bloqueado.',
      queHacer: 'Calibre el sensor (suelo seco y suelo húmedo) en Equipo › Calibración.',
    }
  if (edad === null)
    return { ...base, estado: 'Sin lecturas', nivel: 'neutro', explicacion: 'Todavía no se ha recibido ninguna medición de este sensor.' }
  if (s.estado === 'ERROR_SENSOR' || s.estado === 'FUERA_DE_RANGO')
    return {
      ...base, estado: 'Lectura no válida', nivel: 'problema',
      explicacion: 'El sensor envía valores imposibles; puede estar desconectado, dañado o fuera de la tierra. El riego automático se detiene por seguridad.',
      queHacer: 'Revise el cable del sensor y que esté bien enterrado en la zona de raíces.',
    }
  if (edad > DATOS_VIEJOS_S)
    return {
      ...base, estado: 'Sin datos recientes', nivel: 'problema',
      explicacion: `La última medición llegó ${haceTiempo(edad)}. El valor mostrado puede no representar el suelo ahora.`,
      queHacer: 'Revise la conexión del equipo de campo.',
    }
  if (edad > DATOS_AL_DIA_S)
    return { ...base, estado: 'Retrasado', nivel: 'atencion', explicacion: `La última medición llegó ${haceTiempo(edad)}; normalmente llega cada pocos segundos.` }
  return { ...base, estado: 'Midiendo', nivel: 'ok', explicacion: `Mide la humedad del suelo; última lectura ${haceTiempo(edad)}.` }
}

export function piezaBomba(v: VistaPanel): Pieza {
  const b = evaluarBomba(v)
  const base = { clave: 'bomba' as const, titulo: 'Bomba de riego', actualizado: v.actuador.reportado.reportado_en }
  switch (b.fase) {
    case 'encendida':
      return { ...base, estado: 'Regando', nivel: 'ok', explicacion: b.detalle }
    case 'apagada':
      return { ...base, estado: 'Apagada', nivel: 'ok', explicacion: 'La bomba está detenida, confirmado por el equipo de campo.' }
    case 'pendiente':
      return { ...base, estado: 'Orden en camino', nivel: 'atencion', explicacion: b.detalle }
    case 'bloqueada':
      return {
        ...base, estado: 'Bloqueada', nivel: 'problema', explicacion: b.detalle,
        queHacer: 'Revise tanque, manguera y sensor. Después puede rearmarla desde Riego (si el bloqueo lo permite) o en el propio equipo.',
      }
    case 'error':
      return { ...base, estado: 'Requiere revisión', nivel: 'problema', explicacion: b.detalle, queHacer: 'Revise la conexión del equipo de campo y el historial de órdenes en Equipo.' }
    default:
      return { ...base, estado: 'Sin confirmar', nivel: 'neutro', explicacion: b.detalle }
  }
}

export function piezas(v: VistaPanel, esDemo: boolean): Pieza[] {
  return [piezaServidor(v, esDemo), piezaEquipo(v, esDemo), piezaSensor(v), piezaBomba(v)]
}

export interface ResumenGeneral {
  nivel: Nivel
  titulo: string
  frase: string
  /** Puntos que requieren atención, de mayor a menor gravedad (máx. 3). */
  prioridades: Pieza[]
}

const PESO: Record<Nivel, number> = { problema: 3, atencion: 2, neutro: 1, ok: 0 }

/** Veredicto de una línea sobre la finca, a partir de las cuatro piezas y las alertas abiertas. */
export function resumenGeneral(v: VistaPanel, esDemo: boolean): ResumenGeneral {
  const ps = piezas(v, esDemo)
  const pendientes = ps.filter((p) => p.nivel === 'problema' || p.nivel === 'atencion').sort((a, b) => PESO[b.nivel] - PESO[a.nivel])
  const criticas = (v.alertas ?? []).filter((a) => a.estado === 'ACTIVA' && a.severidad === 'CRITICA').length
  if (!esDemo && v.enlace && !v.enlace.ok)
    return { nivel: 'problema', titulo: 'Sin conexión con el servidor', frase: 'Los datos pueden no estar al día y las acciones están en pausa hasta recuperar la conexión.', prioridades: pendientes.slice(0, 3) }
  if (pendientes.some((p) => p.nivel === 'problema') || criticas > 0)
    return {
      nivel: 'problema',
      titulo: 'Necesita atención',
      frase: criticas > 0 ? `Hay ${criticas === 1 ? 'una alerta crítica' : `${criticas} alertas críticas`} y ${pendientes.length ? 'puntos por revisar' : 'conviene revisarla'}.` : 'Hay un problema que impide el funcionamiento normal del riego.',
      prioridades: pendientes.slice(0, 3),
    }
  const sinAtender = (v.alertas ?? []).filter((a) => a.estado === 'ACTIVA').length
  if (!pendientes.length && sinAtender > 0)
    return {
      nivel: 'atencion',
      titulo: 'Funciona, con avisos por revisar',
      frase: `Todo responde, pero hay ${sinAtender === 1 ? 'una alerta sin atender' : `${sinAtender} alertas sin atender`}.`,
      prioridades: [],
    }
  if (pendientes.length)
    return { nivel: 'atencion', titulo: 'Funciona, con puntos por revisar', frase: 'Nada urgente, pero conviene resolver estos puntos para que el riego funcione sin restricciones.', prioridades: pendientes.slice(0, 3) }
  return { nivel: 'ok', titulo: 'Todo en orden', frase: 'El equipo está conectado, el sensor mide y la bomba responde.', prioridades: [] }
}

export interface LecturaHumedad {
  nivel: Nivel
  etiqueta: string
  frase: string
}

/**
 * Interpreta el porcentaje frente a los umbrales configurados (inicio y parada del riego).
 * Las zonas vienen de `zonaHumedad` (única fuente de la regla): seco < inicio ≤ adecuado ≤ parada < muy húmedo.
 */
export function interpretarHumedad(pct: number | null, inicio: number, parada: number): LecturaHumedad {
  if (pct === null) return { nivel: 'neutro', etiqueta: 'Sin dato', frase: 'No hay una lectura válida del sensor para interpretar.' }
  const z = describirZonas(inicio, parada).find((d) => d.zona === zonaHumedad(pct, inicio, parada))!
  if (z.zona === 'seco') return { nivel: 'atencion', etiqueta: z.etiqueta, frase: `Está por debajo del ${numero(inicio)} % que activa el riego: la planta puede necesitar agua.` }
  if (z.zona === 'humedo') return { nivel: 'ok', etiqueta: z.etiqueta, frase: `Supera el ${numero(parada)} %: hay más agua de la deseada y no hace falta regar.` }
  return { nivel: 'ok', etiqueta: z.etiqueta, frase: `Está entre ${numero(inicio)} % y ${numero(parada)} %, el rango deseado.` }
}

export interface Condicion {
  clave: string
  texto: string
  cumple: boolean
  /** Explicación cuando no se cumple. */
  ayuda: string
}

/**
 * Condiciones para regar manualmente, en el mismo orden que las valida el servidor (contrato §11.3).
 * La decisión final es siempre `acciones.encender` del servidor; esta lista sólo la explica.
 */
export function condicionesRiego(v: VistaPanel, esDemo: boolean): Condicion[] {
  const a = v.actuador
  const r = a.reportado
  const motivos = [a.acciones.motivo_encender_no_permitido, ...Object.values(a.acciones.modos_no_permitidos ?? {})]
  const servidorPermite = esDemo || !motivos.includes('ENCENDIDO_DESHABILITADO')
  const c: Condicion[] = []
  if (!esDemo) c.push({ clave: 'servidor', texto: 'Conexión con el servidor', cumple: !v.enlace || v.enlace.ok, ayuda: 'Sin servidor no se pueden enviar órdenes.' })
  c.push(
    { clave: 'habilitado', texto: 'Riego remoto habilitado en el servidor', cumple: servidorPermite, ayuda: 'Por seguridad, el administrador mantiene desactivado el encendido remoto (PERMITIR_ENCENDIDO=false). Sólo se permite apagar.' },
    { clave: 'equipo', texto: 'Equipo de campo conectado', cumple: r.fiable, ayuda: 'La orden necesita que el ESP32 esté comunicando para confirmarla.' },
    { clave: 'bloqueo', texto: 'Sin bloqueos de seguridad', cumple: !r.bloqueo, ayuda: 'La bomba se bloqueó para protegerse; revise la causa y rearme.' },
    { clave: 'modo', texto: 'Modo Manual activo', cumple: a.modo_configurado === 'MANUAL' && r.modo === 'MANUAL', ayuda: 'El riego por orden sólo funciona en modo Manual.' },
    { clave: 'config', texto: 'Configuración aplicada en el equipo', cumple: v.dispositivo.config_version_aplicada === v.dispositivo.config_version_deseada, ayuda: 'El equipo aún no recibe el último cambio de configuración.' },
    { clave: 'calibracion', texto: 'Sensor calibrado', cumple: v.sensor.calibracion_confirmada, ayuda: 'Sin calibración el porcentaje de humedad no es confiable.' },
    { clave: 'hardware', texto: 'Instalación eléctrica confirmada', cumple: v.dispositivo.hardware_confirmado, ayuda: 'Un técnico debe confirmar el cableado de la bomba en el firmware antes de accionarla.' },
    { clave: 'libre', texto: 'Bomba libre y descanso cumplido', cumple: r.estado_bomba === 'APAGADA' && r.descanso_restante_s <= 0, ayuda: r.estado_bomba !== 'APAGADA' ? 'Ya hay un riego en curso.' : 'La bomba debe descansar entre riegos.' },
  )
  return c
}

/** Texto del motivo principal por el que no se puede regar (del servidor). */
export const motivoRiego = (v: VistaPanel) => (v.actuador.acciones.encender ? null : texto(v.actuador.acciones.motivo_encender_no_permitido) || 'No disponible')

const NIVEL_ROL: Record<RolTerreno, number> = { LECTOR: 1, OPERADOR: 2, PROPIETARIO: 3 }
export const NOMBRE_ROL: Record<RolTerreno, string> = { LECTOR: 'Lector', OPERADOR: 'Operador', PROPIETARIO: 'Propietario' }

export interface Permisos {
  rol: RolTerreno
  /** Cambiar modo, enviar órdenes, gestionar alertas (OPERADOR o más). */
  operar: boolean
  /** Calibrar el sensor (PROPIETARIO). */
  administrar: boolean
}

/** Permisos en el terreno del dispositivo mostrado. El servidor los vuelve a validar (403). DEMO: sin restricciones. */
export function permisos(v: VistaPanel, esDemo: boolean): Permisos {
  const rol: RolTerreno = esDemo ? 'PROPIETARIO' : (v.finca?.terrenos.find((t) => t.id === v.finca!.terreno_id)?.rol ?? 'LECTOR')
  return { rol, operar: NIVEL_ROL[rol] >= 2, administrar: NIVEL_ROL[rol] >= 3 }
}
