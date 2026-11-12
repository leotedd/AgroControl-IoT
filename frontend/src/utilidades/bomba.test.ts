import { describe, expect, it } from 'vitest'
import type { Orden, VistaPanel } from '../tipos/contrato'
import { evaluarBomba } from './bomba'

const AHORA = Date.UTC(2026, 9, 16, 12, 0, 0)

function orden(over: Partial<Orden>): Orden {
  return { id: 7, tipo: 'BOMBA_ENCENDER', parametros: { duracion_s: 5 }, estado: 'PENDIENTE', creada_en: AHORA - 2000, expira_en: AHORA + 28_000, ...over } as Orden
}

function vista(over: { fiable?: boolean; nunca?: boolean; bomba?: string; bloqueo?: boolean; reportadoHaceS?: number; ordenes?: Orden[] } = {}): VistaPanel {
  return {
    ahora: AHORA,
    dispositivo: { nunca_conectado: over.nunca ?? false },
    actuador: {
      reportado: {
        fiable: over.fiable ?? true,
        estado_bomba: over.bomba ?? 'APAGADA',
        riego_transcurrido_s: 2,
        riego_restante_s: 3,
        antiguedad_s: over.reportadoHaceS ?? 1,
        reportado_en: AHORA - (over.reportadoHaceS ?? 1) * 1000,
        bloqueo: over.bloqueo ? { id_bloqueo: 4, tipo: 'CRITICO', causa: 'SENSOR_INVALIDO', liberable_remotamente: false } : null,
      },
    },
    ordenes: over.ordenes ?? [],
  } as unknown as VistaPanel
}
const fase = (v: VistaPanel) => evaluarBomba(v).fase

describe('evaluarBomba: "Encendida" sólo con confirmación del ESP32', () => {
  it('apagada confirmada por telemetría', () => {
    expect(evaluarBomba(vista())).toMatchObject({ fase: 'apagada', titulo: 'Apagada' })
  })
  it('una orden creada o entregada es sólo una solicitud pendiente, nunca "Encendida"', () => {
    expect(fase(vista({ ordenes: [orden({ estado: 'PENDIENTE' })] }))).toBe('pendiente')
    expect(evaluarBomba(vista({ ordenes: [orden({ estado: 'ENTREGADA' })] })).detalle).toContain('esperando su confirmación')
    expect(evaluarBomba(vista({ ordenes: [orden({ tipo: 'BOMBA_APAGAR', estado: 'PENDIENTE' })] })).titulo).toBe('Solicitud de apagado pendiente')
  })
  it('encendida cuando la telemetría lo informa, o por ACK EJECUTADA más reciente que la telemetría', () => {
    expect(fase(vista({ bomba: 'RIEGO_MANUAL' }))).toBe('encendida')
    const ack = orden({ estado: 'EJECUTADA', confirmada_en: AHORA - 500, duracion_aplicada_s: 5 })
    expect(fase(vista({ reportadoHaceS: 2, ordenes: [ack] }))).toBe('encendida')
    // Telemetría posterior al ACK que dice APAGADA manda (el riego ya terminó).
    expect(fase(vista({ reportadoHaceS: 0, ordenes: [orden({ estado: 'EJECUTADA', confirmada_en: AHORA - 6000, duracion_aplicada_s: 5 })] }))).toBe('apagada')
  })
  it('error: orden rechazada, fallida, sin confirmar o expirada reciente', () => {
    for (const estado of ['RECHAZADA', 'FALLIDA', 'SIN_CONFIRMAR', 'EXPIRADA'] as const)
      expect(fase(vista({ ordenes: [orden({ estado, codigo_motivo: 'HARDWARE_NO_CONFIRMADO' })] }))).toBe('error')
    expect(fase(vista({ ordenes: [orden({ estado: 'RECHAZADA', creada_en: AHORA - 600_000 })] }))).toBe('apagada')
  })
  it('bloqueada tiene prioridad; sin telemetría fiable no se afirma ningún estado', () => {
    expect(fase(vista({ bloqueo: true, bomba: 'RIEGO_MANUAL' }))).toBe('bloqueada')
    expect(evaluarBomba(vista({ fiable: false, bomba: 'RIEGO_MANUAL' }))).toMatchObject({ fase: 'error', titulo: 'Sin confirmación' })
    expect(fase(vista({ fiable: false, nunca: true }))).toBe('desconocida')
  })
})
