import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimuladorDemo } from './simulador'

// Reloj virtual coherente: el simulador usa Date.now() tanto al crear órdenes como al avanzar.
let t = 0
let s: SimuladorDemo
// Acceso a internos sólo en pruebas.
const interno = () => s as unknown as { paso(t: number): void; dev: { hum: number } }
const avanzar = (n: number) => {
  for (let i = 0; i < n; i++) {
    t += 1000
    interno().paso(t)
  }
}

beforeEach(() => {
  t = Date.UTC(2026, 9, 15, 12, 0, 0)
  vi.spyOn(Date, 'now').mockImplementation(() => t)
  s = new SimuladorDemo()
})
afterEach(() => vi.restoreAllMocks())

describe('SimuladorDemo (reglas del contrato 1.0.2)', () => {
  it('precarga una hora de historial y ciclos automáticos sin bloqueos', () => {
    const v = s.vista()
    expect(v.historial.length).toBeGreaterThan(500)
    expect(v.ciclos.filter((c) => c.fin).length).toBeGreaterThanOrEqual(5)
    expect(v.actuador.reportado.bloqueo).toBeNull()
  })

  it('encender en AUTOMATICO → MODO_NO_MANUAL', () => {
    const r = s.enviarOrden('BOMBA_ENCENDER', { duracion_s: 10 })
    expect(r).toMatchObject({ ok: false, codigo: 'MODO_NO_MANUAL' })
  })

  it('MANUAL: encender ejecuta riego manual; apagar lo detiene; duración > máximo rechazada', () => {
    s.cambiarModo('MANUAL')
    avanzar(70)
    expect(s.vista().actuador.reportado.modo).toBe('MANUAL')
    interno().dev.hum = 35
    avanzar(3)
    expect(s.enviarOrden('BOMBA_ENCENDER', { duracion_s: 10 }).ok).toBe(true)
    avanzar(3)
    let v = s.vista()
    expect(v.ordenes[0].estado).toBe('EJECUTADA')
    expect(v.actuador.reportado.estado_bomba).toBe('RIEGO_MANUAL')
    s.enviarOrden('BOMBA_APAGAR', {})
    avanzar(3)
    v = s.vista()
    expect(v.actuador.reportado.estado_bomba).toBe('APAGADA')
    expect(s.enviarOrden('BOMBA_ENCENDER', { duracion_s: 99 }).ok).toBe(false)
  })

  it('tanque vacío → PREVENTIVO; rearme con inspección; segundo episodio → PREVENTIVO_REPETIDO sólo local', () => {
    s.cambiarModo('AUTOMATICO')
    s.cambiarEscenario({ tanque_vacio: true })
    interno().dev.hum = 25
    avanzar(90)
    let b = s.vista().actuador.reportado.bloqueo!
    expect(b).toMatchObject({ tipo: 'PREVENTIVO', causa: 'TIEMPO_MAXIMO' })
    expect(s.vista().actuador.modo_configurado).toBe('DESHABILITADO') // reconciliación
    expect(s.enviarOrden('RESTABLECER_BLOQUEO', { id_bloqueo: b.id_bloqueo, causa: b.causa, inspeccion_confirmada: false }).ok).toBe(false)
    s.enviarOrden('RESTABLECER_BLOQUEO', { id_bloqueo: b.id_bloqueo, causa: b.causa, inspeccion_confirmada: true })
    avanzar(3)
    const r = s.vista().actuador.reportado
    expect(r.bloqueo).toBeNull()
    expect(r.modo).toBe('DESHABILITADO')
    s.cambiarModo('AUTOMATICO')
    avanzar(90)
    b = s.vista().actuador.reportado.bloqueo!
    expect(b).toMatchObject({ tipo: 'CRITICO', causa: 'PREVENTIVO_REPETIDO', liberable_remotamente: false })
  })

  it('desconexión: INESTABLE a los 40 s, estado no fiable y encender rechazado', () => {
    s.cambiarEscenario({ conectado: false })
    avanzar(40)
    const v = s.vista()
    expect(v.dispositivo.conexion).toBe('INESTABLE')
    expect(v.actuador.reportado.fiable).toBe(false)
    expect(s.enviarOrden('BOMBA_ENCENDER', { duracion_s: 5 })).toMatchObject({ ok: false, codigo: 'DISPOSITIVO_FUERA_DE_LINEA' })
  })

  it('fallo de sensor: sin lectura y bloqueo CRITICO', () => {
    s.cambiarEscenario({ falla_sensor: true })
    avanzar(4)
    const v = s.vista()
    expect(v.sensor.valor_pct).toBeNull()
    expect(v.actuador.reportado.bloqueo?.tipo).toBe('CRITICO')
  })
})
