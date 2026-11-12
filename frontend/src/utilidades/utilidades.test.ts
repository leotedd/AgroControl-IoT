import { describe, expect, it } from 'vitest'
import type { VistaPanel } from '../tipos/contrato'
import { evaluarComunicacion } from './comunicacion'
import { etiquetaTipo } from './formato'
import { aCsv, agrupar, extremos, tendencia } from './historial'

const AHORA = Date.UTC(2026, 9, 16, 12, 0, 0)

function vista(over: { conexion?: string; segundos?: number; nunca?: boolean; medidoHaceS?: number | null; estado?: string; aplicada?: number; deseada?: number; rechazada?: number | null; enlaceOk?: boolean } = {}): VistaPanel {
  return {
    ahora: AHORA,
    enlace: { ok: over.enlaceOk ?? true, ultima_actualizacion: AHORA, error: over.enlaceOk === false ? 'El backend no responde.' : null, fallos_consecutivos: over.enlaceOk === false ? 2 : 0 },
    dispositivo: {
      conexion: over.conexion ?? 'EN_LINEA', segundos_desde_conexion: over.segundos ?? 2, nunca_conectado: over.nunca ?? false,
      config_version_aplicada: over.aplicada ?? 3, config_version_deseada: over.deseada ?? 3,
      diagnostico: { config_rechazada_version: over.rechazada ?? null },
    },
    sensor: { medido_en: over.medidoHaceS === null ? null : AHORA - (over.medidoHaceS ?? 5) * 1000, estado: over.estado ?? 'OK' },
  } as unknown as VistaPanel
}
const tonos = (v: VistaPanel, demo = false) => Object.fromEntries(evaluarComunicacion(v, demo).map((i) => [i.clave, `${i.tono}:${i.texto}`]))

describe('evaluarComunicacion', () => {
  it('todo correcto en REAL: cuatro indicadores en verde', () => {
    expect(tonos(vista())).toEqual({ backend: 'ok:Conectado', esp32: 'ok:Conectado', datos: 'ok:Al día', config: 'ok:Sincronizada' })
  })
  it('DEMO no muestra el tramo del servidor', () => {
    expect(Object.keys(tonos(vista(), true))).toEqual(['esp32', 'datos', 'config'])
  })
  it('distingue backend caído, ESP32 inestable/desconectado/nunca conectado', () => {
    expect(tonos(vista({ enlaceOk: false })).backend).toBe('critico:Sin conexión')
    expect(tonos(vista({ conexion: 'INESTABLE', segundos: 45 })).esp32).toBe('aviso:Inestable')
    expect(tonos(vista({ conexion: 'FUERA_DE_LINEA', segundos: 600 })).esp32).toBe('critico:Desconectado')
    expect(tonos(vista({ nunca: true })).esp32).toBe('neutro:Nunca conectado')
  })
  it('datos desactualizados aunque el ESP32 esté en línea; lectura inválida; sin calibrar', () => {
    expect(tonos(vista({ medidoHaceS: 60 })).datos).toBe('aviso:Desactualizadas')
    expect(tonos(vista({ medidoHaceS: 600 })).datos).toBe('critico:Desactualizadas')
    expect(tonos(vista({ medidoHaceS: null })).datos).toBe('neutro:Sin lecturas')
    expect(tonos(vista({ estado: 'ERROR_SENSOR' })).datos).toBe('critico:Lectura no válida')
    expect(tonos(vista({ estado: 'SIN_CALIBRAR' })).datos).toBe('aviso:Sin calibrar')
  })
  it('configuración pendiente o rechazada por el ESP32', () => {
    expect(tonos(vista({ aplicada: 2, deseada: 3 })).config).toBe('aviso:Pendiente')
    expect(tonos(vista({ aplicada: 2, deseada: 3, rechazada: 3 })).config).toBe('critico:Rechazada')
  })
  it('recién creado (aplicada v0, deseada v1, nunca conectado): sin entregar, no un fallo', () => {
    expect(tonos(vista({ nunca: true, aplicada: 0, deseada: 1 })).config).toBe('neutro:Sin entregar')
  })
})

describe('historial', () => {
  const m = (min: number, pct: number | null) => ({ t: AHORA - min * 60_000, pct, bomba: false })
  it('agrupa por intervalo con promedio/mín/máx e ignora nulos en el promedio', () => {
    const t = agrupar([m(14, 40), m(13, 44), m(12, null), m(3, 50)], 600, AHORA - 3600_000)
    const total = t.reduce((s, x) => s + x.lecturas, 0)
    expect(total).toBe(4)
    const conNulo = t.find((x) => x.lecturas === 3)!
    expect(conNulo).toMatchObject({ promedio: 42, minimo: 40, maximo: 44 })
  })
  it('sin agrupación devuelve las lecturas dentro del rango', () => {
    expect(agrupar([m(90, 10), m(5, 20)], 0, AHORA - 3600_000)).toHaveLength(1)
  })
  it('tendencia y extremos de la última hora', () => {
    const datos = [m(15, 30), m(14, 32), m(1, 40)]
    expect(tendencia(datos, AHORA)).toBe(9)
    expect(extremos(datos, AHORA)).toEqual({ min: 30, max: 40 })
    expect(tendencia([m(1, 40)], AHORA)).toBeNull()
  })
  it('CSV con cabecera y separador ;', () => {
    const csv = aCsv([{ t: AHORA, promedio: 41.5, minimo: 40, maximo: 43, lecturas: 3 }])
    expect(csv.split('\n')).toEqual(['inicio_utc;promedio_pct;minimo_pct;maximo_pct;lecturas', '2026-10-16T12:00:00.000Z;41.5;40;43;3'])
  })
})

describe('formato', () => {
  it('etiquetaTipo no depende del simulador', () => {
    expect([etiquetaTipo('BOMBA_ENCENDER'), etiquetaTipo('BOMBA_APAGAR'), etiquetaTipo('RESTABLECER_BLOQUEO')]).toEqual(['Encender', 'Apagar', 'Rearmar'])
  })
})
