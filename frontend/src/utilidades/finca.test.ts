import { describe, expect, it } from 'vitest'
import type { Alerta, VistaPanel } from '../tipos/contrato'
import { guiaAlerta, ordenarAlertas } from './alertas'
import { condicionesRiego, interpretarHumedad, permisos, piezaEquipo, piezaSensor, resumenGeneral } from './finca'
import { periodoPersonalizado } from './historial'

const AHORA = Date.UTC(2026, 9, 26, 12, 0, 0)

/** Vista REAL sana; cada prueba cambia sólo lo que evalúa. */
function vista(cambios: (v: VistaPanel) => void = () => undefined): VistaPanel {
  const v = {
    ahora: AHORA,
    enlace: { ok: true, ultima_actualizacion: AHORA, error: null, fallos_consecutivos: 0 },
    finca: { terrenos: [{ id: 1, nombre: 'Lote Norte', ubicacion: null, rol: 'OPERADOR', dispositivos: [] }], terreno_id: 1, dispositivo_id: 1, zona: null },
    alertas: [],
    dispositivo: { conexion: 'EN_LINEA', ultima_conexion_en: AHORA - 2000, segundos_desde_conexion: 2, nunca_conectado: false, hardware_confirmado: true, config_version_aplicada: 3, config_version_deseada: 3 },
    sensor: { calibracion_confirmada: true, valor_pct: 42, estado: 'OK', medido_en: AHORA - 3000 },
    actuador: {
      modo_configurado: 'MANUAL',
      reportado: { modo: 'MANUAL', estado_bomba: 'APAGADA', fiable: true, bloqueo: null, descanso_restante_s: 0, antiguedad_s: 3, reportado_en: AHORA - 3000, riego_transcurrido_s: 0, riego_restante_s: 0 },
      acciones: { encender: true, apagar: true, rearmar: false, motivo_encender_no_permitido: null, modos_no_permitidos: {} },
      control: { umbral_inicio_pct: 30, umbral_parada_pct: 55 },
    },
    ordenes: [],
  } as unknown as VistaPanel
  cambios(v)
  return v
}

describe('resumen general de la finca', () => {
  it('todo sano → "Todo en orden" sin prioridades', () => {
    const r = resumenGeneral(vista(), false)
    expect(r.nivel).toBe('ok')
    expect(r.prioridades).toHaveLength(0)
  })

  it('sin backend → problema de servidor, aunque lo demás estuviera bien', () => {
    const r = resumenGeneral(vista((v) => (v.enlace = { ok: false, ultima_actualizacion: AHORA - 60_000, error: 'x', fallos_consecutivos: 2 })), false)
    expect(r.nivel).toBe('problema')
    expect(r.titulo).toMatch(/servidor/i)
  })

  it('ordena las prioridades: el problema antes que el aviso', () => {
    const r = resumenGeneral(
      vista((v) => {
        v.sensor.calibracion_confirmada = false // atención
        v.dispositivo.conexion = 'FUERA_DE_LINEA' // problema
        v.dispositivo.segundos_desde_conexion = 900
      }),
      false,
    )
    expect(r.nivel).toBe('problema')
    expect(r.prioridades.map((p) => p.clave)).toEqual(['equipo', 'sensor'])
    expect(r.prioridades[0].queHacer).toBeTruthy()
  })

  it('una advertencia sin atender impide decir "Todo en orden"', () => {
    const r = resumenGeneral(vista((v) => (v.alertas = [{ id: 2, tipo: 'REINICIO_INESPERADO', severidad: 'ADVERTENCIA', estado: 'ACTIVA', mensaje: 'x', creada_en: AHORA }])), false)
    expect(r.nivel).toBe('atencion')
    expect(r.titulo).not.toBe('Todo en orden')
  })

  it('una alerta crítica activa basta para pedir atención', () => {
    const r = resumenGeneral(vista((v) => (v.alertas = [{ id: 1, tipo: 'FALLA_SENSOR', severidad: 'CRITICA', estado: 'ACTIVA', mensaje: 'x', creada_en: AHORA }])), false)
    expect(r.nivel).toBe('problema')
  })
})

describe('piezas', () => {
  it('equipo nunca conectado pide revisar instalación, no dice "sin conexión"', () => {
    const p = piezaEquipo(vista((v) => { v.dispositivo.nunca_conectado = true; v.dispositivo.ultima_conexion_en = null }), false)
    expect(p.estado).toBe('Aún no se conecta')
  })
  it('sensor con lectura vieja (> 120 s) es un problema', () => {
    expect(piezaSensor(vista((v) => (v.sensor.medido_en = AHORA - 600_000))).nivel).toBe('problema')
  })
})

describe('interpretación de la humedad', () => {
  it.each([
    [null, 'Sin dato'],
    [20, 'Suelo seco'],
    [40, 'Humedad adecuada'],
    [55, 'Humedad adecuada'],
    [70, 'Suelo muy húmedo'],
  ])('%s %% → %s', (pct, etiqueta) => expect(interpretarHumedad(pct, 30, 55).etiqueta).toBe(etiqueta))
})

describe('condiciones de riego', () => {
  it('explica el encendido deshabilitado en el servidor', () => {
    const c = condicionesRiego(vista((v) => (v.actuador.acciones = { encender: false, apagar: true, rearmar: false, motivo_encender_no_permitido: 'ENCENDIDO_DESHABILITADO' })), false)
    expect(c.find((x) => x.clave === 'habilitado')?.cumple).toBe(false)
  })
  it('en DEMO no lista la conexión con el servidor', () => {
    expect(condicionesRiego(vista(), true).some((x) => x.clave === 'servidor')).toBe(false)
  })
})

describe('permisos', () => {
  it('según el rol en el terreno; DEMO sin restricciones', () => {
    expect(permisos(vista(), false)).toMatchObject({ rol: 'OPERADOR', operar: true, administrar: false })
    expect(permisos(vista((v) => (v.finca!.terrenos[0].rol = 'LECTOR')), false).operar).toBe(false)
    expect(permisos(vista((v) => (v.finca = undefined)), false).operar).toBe(false)
    expect(permisos(vista(), true).administrar).toBe(true)
  })
})

describe('alertas', () => {
  const a = (over: Partial<Alerta>): Alerta => ({ id: 1, tipo: 'X', severidad: 'INFO', mensaje: 'm', estado: 'ACTIVA', creada_en: AHORA, ...over })
  it('explica tipos conocidos y conserva el mensaje en los desconocidos', () => {
    expect(guiaAlerta(a({ tipo: 'BLOQUEO_ACTIVADO' })).pasos.length).toBeGreaterThan(1)
    expect(guiaAlerta(a({ tipo: 'NUEVO_TIPO', mensaje: 'Texto del backend' })).titulo).toBe('Texto del backend')
  })
  it('ordena abiertas → gravedad → recientes', () => {
    const r = ordenarAlertas([a({ id: 1, estado: 'RESUELTA', severidad: 'CRITICA' }), a({ id: 2, severidad: 'INFO' }), a({ id: 3, severidad: 'CRITICA', creada_en: AHORA - 1 }), a({ id: 4, severidad: 'CRITICA' })])
    expect(r.map((x) => x.id)).toEqual([4, 3, 2, 1])
  })
})

describe('período personalizado del historial', () => {
  it('respeta los límites de agrupación del backend', () => {
    const h = 3600_000
    expect(periodoPersonalizado(0, 2 * h).agrupacion).toBe('crudo')
    expect(periodoPersonalizado(0, 48 * h).agrupacion).toBe('5m')
    expect(periodoPersonalizado(0, 30 * 24 * h).agrupacion).toBe('1h')
  })
})
