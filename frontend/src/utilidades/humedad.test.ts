import { describe, expect, it } from 'vitest'
import type { VistaPanel } from '../tipos/contrato'
import { evaluarBomba } from './bomba'
import { anguloAguja, describirZonas, evaluarMedicion, puntoArco, sentidoTendencia, trazoArco, zonaHumedad } from './humedad'

const AHORA = Date.UTC(2026, 10, 6, 12, 0, 0)

function vista(cambios: (v: VistaPanel) => void = () => undefined): VistaPanel {
  const v = {
    ahora: AHORA,
    dispositivo: { conexion: 'EN_LINEA', segundos_desde_conexion: 2 },
    sensor: { calibracion_confirmada: true, valor_pct: 42, estado: 'OK', medido_en: AHORA - 3000 },
    actuador: {
      reportado: { modo: 'AUTOMATICO', estado_bomba: 'APAGADA', fiable: true, bloqueo: null, antiguedad_s: 3, reportado_en: AHORA - 3000, riego_transcurrido_s: 0, riego_restante_s: 0, descanso_restante_s: 0 },
      control: { umbral_inicio_pct: 30, umbral_parada_pct: 55 },
    },
    ordenes: [],
  } as unknown as VistaPanel
  cambios(v)
  return v
}

describe('zonas de humedad (umbrales 30 / 55)', () => {
  it.each([
    [0, 'seco'],
    [9.1, 'seco'],
    [29.9, 'seco'],
    [30, 'adecuado'],
    [42.5, 'adecuado'],
    [55, 'adecuado'],
    [55.1, 'humedo'],
    [100, 'humedo'],
  ] as const)('%s %% → %s', (pct, zona) => expect(zonaHumedad(pct, 30, 55)).toBe(zona))

  it('las zonas cubren 0–100 sin huecos y con los textos acordados', () => {
    const z = describirZonas(30, 55)
    expect(z.map((d) => [d.desde, d.hasta])).toEqual([[0, 30], [30, 55], [55, 100]])
    expect(z.map((d) => d.etiqueta)).toEqual(['Suelo seco', 'Humedad adecuada', 'Suelo muy húmedo'])
    expect(z.map((d) => d.rango)).toEqual(['0 a menos de 30 %', '30 a 55 %', 'Más de 55 a 100 %'])
  })
})

describe('geometría del medidor', () => {
  it('la aguja es proporcional y se limita a 0–180°', () => {
    expect(anguloAguja(0)).toBe(0)
    expect(anguloAguja(50)).toBe(90)
    expect(anguloAguja(100)).toBe(180)
    expect(anguloAguja(9.1)).toBeCloseTo(16.38)
    expect(anguloAguja(-5)).toBe(0)
    expect(anguloAguja(140)).toBe(180)
  })
  it('0 % a la izquierda, 50 % arriba, 100 % a la derecha', () => {
    const p = (n: number) => puntoArco(n, 100, 100, 80)
    expect(p(0).x).toBeCloseTo(20)
    expect(p(0).y).toBeCloseTo(100)
    expect(p(50).x).toBeCloseTo(100)
    expect(p(50).y).toBeCloseTo(20)
    expect(p(100).x).toBeCloseTo(180)
  })
  it('el trazo nunca usa el arco grande', () => expect(trazoArco(0, 100, 100, 100, 80)).toContain(' 0 0 1 '))
})

describe('fiabilidad de la lectura', () => {
  it('lectura reciente → válida, con decimales intactos', () => {
    const m = evaluarMedicion(vista((v) => (v.sensor.valor_pct = 29.9)))
    expect(m.estado).toBe('valida')
    expect(m.pct).toBe(29.9)
  })
  it('sin mediciones → sin dato', () => expect(evaluarMedicion(vista((v) => (v.sensor.medido_en = null))).estado).toBe('sin_dato'))
  it.each([
    ['ERROR_SENSOR', 40],
    ['FUERA_DE_RANGO', 40],
    ['OK', null],
    ['OK', 130],
    ['OK', -2],
    ['OK', Number.NaN],
  ] as const)('estado %s con valor %s → inválida y sin porcentaje inventado', (estado, pct) => {
    const m = evaluarMedicion(vista((v) => { v.sensor.estado = estado; v.sensor.valor_pct = pct }))
    expect(m.estado).toBe('invalida')
    expect(m.pct).toBeNull()
  })
  it('lectura vieja → desactualizada (conserva el valor para mostrarlo en gris)', () => {
    const m = evaluarMedicion(vista((v) => (v.sensor.medido_en = AHORA - 90_000)))
    expect(m.estado).toBe('desactualizada')
    expect(m.pct).toBe(42)
  })
  it('equipo fuera de línea con lectura vieja → sensor desconectado', () => {
    const m = evaluarMedicion(vista((v) => { v.sensor.medido_en = AHORA - 600_000; v.dispositivo.conexion = 'FUERA_DE_LINEA' }))
    expect(m.estado).toBe('desconectado')
  })
  it('sin calibrar → no se presenta como válida', () => expect(evaluarMedicion(vista((v) => (v.sensor.calibracion_confirmada = false))).estado).toBe('sin_calibrar'))
})

describe('tendencia', () => {
  it.each([
    [null, null],
    [0, 'estable'],
    [0.4, 'estable'],
    [-0.4, 'estable'],
    [1.2, 'aumentando'],
    [-3, 'disminuyendo'],
  ] as const)('Δ %s → %s', (d, s) => expect(sentidoTendencia(d)).toBe(s))
})

describe('seguridad: humedad baja con bomba bloqueada', () => {
  it('suelo seco no oculta el bloqueo: la bomba sigue reportándose bloqueada', () => {
    const v = vista((v) => {
      v.sensor.valor_pct = 9.1
      v.actuador.reportado.bloqueo = { id_bloqueo: 3, tipo: 'CRITICO', causa: 'SENSOR_INVALIDO', desde: AHORA - 1000, liberable_remotamente: false }
    })
    expect(zonaHumedad(evaluarMedicion(v).pct!, 30, 55)).toBe('seco')
    expect(evaluarBomba(v).fase).toBe('bloqueada')
  })
})
