// Estado de la bomba que muestra la web. Regla principal: "Encendida" sólo con confirmación
// del ESP32 (telemetría o ACK EJECUTADA). Una orden creada en el servidor es sólo una solicitud.
// Función pura (probada).
import type { Orden, VistaPanel } from '../tipos/contrato'
import { etiquetaTipo, texto } from './formato'

export type FaseBomba = 'apagada' | 'pendiente' | 'encendida' | 'error' | 'bloqueada' | 'desconocida'

export interface EstadoBombaVista {
  fase: FaseBomba
  titulo: string
  detalle: string
  tono: 'ok' | 'serie' | 'aviso' | 'critico' | 'neutro'
}

const ESTADOS_ERROR: Orden['estado'][] = ['RECHAZADA', 'FALLIDA', 'SIN_CONFIRMAR', 'EXPIRADA']
/** Un error de orden deja de destacarse pasado este tiempo (la bomba sigue mostrando su estado real). */
export const ERROR_RECIENTE_MS = 120_000

export function evaluarBomba(v: VistaPanel): EstadoBombaVista {
  const rep = v.actuador.reportado
  const activa = v.ordenes.find((o) => (o.estado === 'PENDIENTE' || o.estado === 'ENTREGADA') && o.tipo !== 'RESTABLECER_BLOQUEO')
  const ultima = v.ordenes[0]

  if (rep.bloqueo)
    return {
      fase: 'bloqueada',
      titulo: 'Bloqueada',
      detalle: `Bloqueo ${rep.bloqueo.tipo === 'CRITICO' ? 'crítico' : 'preventivo'} #${rep.bloqueo.id_bloqueo}: ${texto(rep.bloqueo.causa)}.${rep.fiable ? '' : ' (último estado conocido)'}`,
      tono: 'critico',
    }

  if (!rep.fiable) {
    if (v.dispositivo.nunca_conectado)
      return { fase: 'desconocida', titulo: 'Sin confirmar', detalle: 'El ESP32 nunca se ha conectado: no hay estado real de la bomba.', tono: 'neutro' }
    return {
      fase: 'error',
      titulo: 'Sin confirmación',
      detalle: activa
        ? `Sin telemetría reciente del ESP32; la orden #${activa.id} sigue ${texto(activa.estado).toLowerCase()}. Estado real desconocido.`
        : 'Sin telemetría reciente del ESP32: el estado real de la bomba es desconocido.',
      tono: 'critico',
    }
  }

  if (rep.estado_bomba !== 'APAGADA') {
    const apagando = activa?.tipo === 'BOMBA_APAGAR' ? ' Apagado solicitado.' : ''
    return {
      fase: 'encendida',
      titulo: 'Encendida',
      detalle: `Confirmada por el ESP32 · ${rep.riego_transcurrido_s} s, quedan ${rep.riego_restante_s} s.${apagando}`,
      tono: 'serie',
    }
  }

  // ACK EJECUTADA de un encendido más reciente que la última telemetría: el ESP32 ya lo confirmó.
  if (
    ultima?.tipo === 'BOMBA_ENCENDER' && ultima.estado === 'EJECUTADA' && ultima.confirmada_en && ultima.duracion_aplicada_s &&
    (rep.reportado_en ?? 0) < ultima.confirmada_en && v.ahora < ultima.confirmada_en + ultima.duracion_aplicada_s * 1000
  )
    return { fase: 'encendida', titulo: 'Encendida', detalle: `Confirmada por el ESP32 (orden #${ultima.id}, ${ultima.duracion_aplicada_s} s); esperando su telemetría.`, tono: 'serie' }

  if (activa)
    return {
      fase: 'pendiente',
      titulo: activa.tipo === 'BOMBA_ENCENDER' ? 'Solicitud de encendido pendiente' : 'Solicitud de apagado pendiente',
      detalle:
        activa.estado === 'PENDIENTE'
          ? `Orden #${activa.id} registrada; esperando que el ESP32 la recoja. La bomba sigue apagada.`
          : `El ESP32 recibió la orden #${activa.id}; esperando su confirmación. La bomba sigue apagada.`,
      tono: 'aviso',
    }

  if (ultima && ESTADOS_ERROR.includes(ultima.estado) && v.ahora - ultima.creada_en < ERROR_RECIENTE_MS) {
    const motivo = texto(ultima.codigo_motivo ?? ultima.motivo_cierre)
    return {
      fase: 'error',
      titulo: 'Error',
      detalle: `Orden #${ultima.id} (${etiquetaTipo(ultima.tipo).toLowerCase()}) ${texto(ultima.estado).toLowerCase()}${motivo ? `: ${motivo}` : ''}. El ESP32 informa la bomba apagada.`,
      tono: 'critico',
    }
  }

  return { fase: 'apagada', titulo: 'Apagada', detalle: `Confirmado por el ESP32 hace ${rep.antiguedad_s} s.`, tono: 'ok' }
}
