// "Probar comunicación con ESP32": ida y vuelta web → backend → ESP32 → ACK, sin tocar la bomba.
// Reutiliza el mecanismo existente del contrato: una orden BOMBA_APAGAR con la bomba ya apagada.
// El firmware la confirma EJECUTADA/SIN_CAMBIO sin escribir GPIO26 (driver deshabilitado en la
// compilación). No hay orden nueva ni cambio de contrato. Funciones puras (probadas).
import type { Orden, VistaPanel } from '../tipos/contrato'
import { texto } from './formato'

/** TTL mínimo de BOMBA_APAGAR (contrato: 30–900 s): si el ESP32 no responde, la orden caduca pronto. */
export const TTL_DIAGNOSTICO_S = 30
/** Prefijo del Idempotency-Key: identifica las pruebas en MySQL (ordenes_riego.idempotency_key). */
export const PREFIJO_DIAGNOSTICO = 'diag-'

/**
 * Motivo por el que la prueba no se ofrece; null = disponible.
 * Sólo se envía cuando el APAGAR es realmente inocuo: bomba apagada confirmada, sin órdenes
 * en curso (un APAGAR las cancelaría) y fuera de AUTOMATICO (un APAGAR lo cambiaría a MANUAL).
 */
export function motivoSinDiagnostico(v: VistaPanel): string | null {
  const rep = v.actuador.reportado
  if (v.enlace && !v.enlace.ok) return 'Sin conexión con el backend.'
  if (v.dispositivo.nunca_conectado) return 'El ESP32 nunca se ha conectado.'
  if (v.dispositivo.conexion !== 'EN_LINEA') return 'El ESP32 no está en línea.'
  if (!rep.fiable) return 'Sin telemetría reciente: no se puede confirmar que la bomba esté apagada.'
  if (rep.estado_bomba !== 'APAGADA') return 'La bomba informa riego en curso: use Apagar.'
  if (v.actuador.modo_configurado === 'AUTOMATICO') return 'En modo Automático un apagado cambiaría el modo.'
  if (v.ordenes.some((o) => o.estado === 'PENDIENTE' || o.estado === 'ENTREGADA')) return 'Hay una orden en curso; espere a que termine.'
  return null
}

export type FaseDiagnostico = 'enviada' | 'entregada' | 'confirmada' | 'rechazada' | 'sin_respuesta'

export interface ResultadoDiagnostico {
  fase: FaseDiagnostico
  titulo: string
  detalle: string
  tono: 'ok' | 'aviso' | 'critico' | 'neutro'
  /** Tiempos medidos con las marcas del servidor (ms desde la creación). */
  entrega_ms: number | null
  confirmacion_ms: number | null
}

const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Estado de la prueba a partir de la orden tal como la devuelve el backend. Nunca supone un ACK. */
export function evaluarDiagnostico(o: Orden): ResultadoDiagnostico {
  const entrega_ms = o.entregada_en ? o.entregada_en - o.creada_en : null
  const confirmacion_ms = o.confirmada_en ? o.confirmada_en - o.creada_en : null
  const base = { entrega_ms, confirmacion_ms }
  const motivo = texto(o.codigo_motivo ?? o.motivo_cierre)
  switch (o.estado) {
    case 'PENDIENTE':
      return { ...base, fase: 'enviada', titulo: 'Esperando al ESP32', detalle: `Orden #${o.id} registrada en el servidor; el ESP32 aún no la recoge.`, tono: 'neutro' }
    case 'ENTREGADA':
      return { ...base, fase: 'entregada', titulo: 'Recibida por el ESP32', detalle: `El ESP32 recogió la orden #${o.id}${entrega_ms !== null ? ` en ${seg(entrega_ms)}` : ''}; esperando su confirmación.`, tono: 'aviso' }
    case 'EJECUTADA':
      return {
        ...base,
        fase: 'confirmada',
        titulo: 'Comunicación confirmada',
        detalle: `El ESP32 confirmó la orden #${o.id}${confirmacion_ms !== null ? ` en ${seg(confirmacion_ms)}` : ''}${motivo ? ` (${motivo})` : ''}. La bomba no se accionó.`,
        tono: 'ok',
      }
    case 'RECHAZADA':
    case 'FALLIDA':
      // Hubo respuesta real del ESP32: el canal funciona, pero la orden no se aplicó.
      return {
        ...base,
        fase: 'rechazada',
        titulo: 'El ESP32 respondió con rechazo',
        detalle: `Confirmación real de la orden #${o.id}: ${texto(o.estado).toLowerCase()}${motivo ? ` — ${motivo}` : ''}. La comunicación funciona.`,
        tono: 'aviso',
      }
    default:
      return {
        ...base,
        fase: 'sin_respuesta',
        titulo: 'Sin confirmación del ESP32',
        detalle: `La orden #${o.id} quedó ${texto(o.estado).toLowerCase()}${motivo ? ` (${motivo})` : ''}. No hubo confirmación del ESP32.`,
        tono: 'critico',
      }
  }
}
