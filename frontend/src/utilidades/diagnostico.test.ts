import { describe, expect, it } from 'vitest'
import type { Orden, VistaPanel } from '../tipos/contrato'
import { evaluarDiagnostico, motivoSinDiagnostico } from './diagnostico'

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0)

function orden(over: Partial<Orden>): Orden {
  return { id: 41, tipo: 'BOMBA_APAGAR', parametros: {}, estado: 'PENDIENTE', creada_en: T0, expira_en: T0 + 30_000, ...over } as Orden
}

function vista(over: { conexion?: string; nunca?: boolean; fiable?: boolean; bomba?: string; modo?: string; ordenes?: Orden[]; enlaceOk?: boolean } = {}): VistaPanel {
  return {
    ahora: T0,
    enlace: { ok: over.enlaceOk ?? true, ultima_actualizacion: T0, error: null, fallos_consecutivos: 0 },
    dispositivo: { conexion: over.conexion ?? 'EN_LINEA', nunca_conectado: over.nunca ?? false },
    actuador: {
      modo_configurado: over.modo ?? 'DESHABILITADO',
      reportado: { fiable: over.fiable ?? true, estado_bomba: over.bomba ?? 'APAGADA', bloqueo: null },
    },
    ordenes: over.ordenes ?? [],
  } as unknown as VistaPanel
}

describe('motivoSinDiagnostico: la prueba sólo se ofrece cuando el APAGAR es inocuo', () => {
  it('disponible con el ESP32 en línea y la bomba apagada confirmada', () => {
    expect(motivoSinDiagnostico(vista())).toBeNull()
  })
  it('no disponible sin conexión, sin telemetría, con riego, en AUTOMATICO o con órdenes en curso', () => {
    expect(motivoSinDiagnostico(vista({ enlaceOk: false }))).toMatch(/backend/)
    expect(motivoSinDiagnostico(vista({ nunca: true }))).toMatch(/nunca/)
    expect(motivoSinDiagnostico(vista({ conexion: 'INESTABLE' }))).toMatch(/en línea/)
    expect(motivoSinDiagnostico(vista({ fiable: false }))).toMatch(/telemetría/)
    expect(motivoSinDiagnostico(vista({ bomba: 'RIEGO_MANUAL' }))).toMatch(/Apagar/)
    expect(motivoSinDiagnostico(vista({ modo: 'AUTOMATICO' }))).toMatch(/Automático/)
    expect(motivoSinDiagnostico(vista({ ordenes: [orden({ estado: 'ENTREGADA' })] }))).toMatch(/en curso/)
  })
})

describe('evaluarDiagnostico: "confirmada" sólo con ACK real del ESP32', () => {
  it('pendiente y entregada no son confirmación', () => {
    expect(evaluarDiagnostico(orden({})).fase).toBe('enviada')
    const e = evaluarDiagnostico(orden({ estado: 'ENTREGADA', entregada_en: T0 + 2100 }))
    expect(e).toMatchObject({ fase: 'entregada', entrega_ms: 2100, confirmacion_ms: null })
  })
  it('EJECUTADA/SIN_CAMBIO: comunicación confirmada con tiempos del servidor', () => {
    const e = evaluarDiagnostico(orden({ estado: 'EJECUTADA', codigo_motivo: 'SIN_CAMBIO', entregada_en: T0 + 2000, confirmada_en: T0 + 3500 }))
    expect(e).toMatchObject({ fase: 'confirmada', tono: 'ok', entrega_ms: 2000, confirmacion_ms: 3500 })
    expect(e.detalle).toContain('Ya estaba apagada')
    expect(e.detalle).toContain('no se accionó')
  })
  it('rechazo real cuenta como respuesta; caducada o sin ACK es fallo', () => {
    expect(evaluarDiagnostico(orden({ estado: 'RECHAZADA', codigo_motivo: 'RELOJ_NO_CONFIABLE' })).fase).toBe('rechazada')
    for (const estado of ['EXPIRADA', 'SIN_CONFIRMAR', 'CANCELADA'] as const)
      expect(evaluarDiagnostico(orden({ estado })).fase).toBe('sin_respuesta')
  })
})
