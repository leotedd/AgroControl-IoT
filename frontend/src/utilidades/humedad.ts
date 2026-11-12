// Interpretación del medidor de humedad: zonas, geometría de la escala, fiabilidad de la lectura y tendencia.
// Funciones puras (probadas en humedad.test.ts). No deciden el riego: sólo explican lo que reporta el equipo.
// Los rangos salen de los umbrales configurados (actuador.control); hoy 30 % y 55 %, no valores universales.
import type { VistaPanel } from '../tipos/contrato'
import { DATOS_AL_DIA_S } from './comunicacion'

export type ZonaHumedad = 'seco' | 'adecuado' | 'humedo'

/**
 * Zona de una lectura:
 *   seco      → 0 ≤ pct < inicio
 *   adecuado  → inicio ≤ pct ≤ parada (ambos inclusive)
 *   humedo    → parada < pct ≤ 100
 */
export function zonaHumedad(pct: number, inicio: number, parada: number): ZonaHumedad {
  if (pct < inicio) return 'seco'
  if (pct <= parada) return 'adecuado'
  return 'humedo'
}

export interface DescripcionZona {
  zona: ZonaHumedad
  /** Nombre corto para la leyenda. */
  nombre: string
  /** Estado en lenguaje sencillo ("Suelo seco"). */
  etiqueta: string
  rango: string
  frase: string
  /** Explicación ampliada para el tooltip. */
  detalle: string
  desde: number
  hasta: number
}

/** Número sin decimales innecesarios: 30 → "30", 29.5 → "29.5". */
export const numero = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function describirZonas(inicio: number, parada: number): DescripcionZona[] {
  const i = numero(inicio)
  const p = numero(parada)
  return [
    {
      zona: 'seco', nombre: 'Seco', etiqueta: 'Suelo seco', rango: `0 a menos de ${i} %`, frase: 'El suelo necesita agua',
      detalle: `Por debajo del ${i} % la tierra tiene poca agua. En modo Automático el equipo empieza a regar en esta zona, siempre que no haya un bloqueo de seguridad.`,
      desde: 0, hasta: inicio,
    },
    {
      zona: 'adecuado', nombre: 'Adecuado', etiqueta: 'Humedad adecuada', rango: `${i} a ${p} %`, frase: 'Humedad dentro del rango deseado',
      detalle: `Entre ${i} % y ${p} % (ambos incluidos) es el rango configurado para este cultivo. Si estaba regando, el riego automático se detiene al llegar al ${p} %.`,
      desde: inicio, hasta: parada,
    },
    {
      zona: 'humedo', nombre: 'Muy húmedo', etiqueta: 'Suelo muy húmedo', rango: `Más de ${p} a 100 %`, frase: 'No requiere riego por humedad',
      detalle: `Por encima del ${p} % la tierra tiene más agua de la deseada. No hace falta regar; si persiste, revise drenaje o lluvias recientes.`,
      desde: parada, hasta: 100,
    },
  ]
}

// ── Geometría del medidor semicircular (0 % a la izquierda, 100 % a la derecha, 180° en total) ──

export const limitarPct = (pct: number) => Math.min(100, Math.max(0, pct))

/** Rotación de la aguja en grados: 0 % → 0°, 50 % → 90°, 100 % → 180° (proporcional). */
export const anguloAguja = (pct: number) => (limitarPct(pct) * 180) / 100

/** Punto sobre el arco para un porcentaje (coordenadas SVG, y hacia abajo). */
export function puntoArco(pct: number, cx: number, cy: number, r: number) {
  const a = (Math.PI * limitarPct(pct)) / 100
  return { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a) }
}

/** Trazo SVG del arco entre dos porcentajes (siempre ≤ 180°, sentido horario). */
export function trazoArco(desde: number, hasta: number, cx: number, cy: number, r: number) {
  const p0 = puntoArco(desde, cx, cy, r)
  const p1 = puntoArco(hasta, cx, cy, r)
  const f = (n: number) => n.toFixed(2)
  return `M ${f(p0.x)} ${f(p0.y)} A ${r} ${r} 0 0 1 ${f(p1.x)} ${f(p1.y)}`
}

// ── Fiabilidad de la lectura ──

export type EstadoMedicion = 'valida' | 'sin_dato' | 'invalida' | 'desconectado' | 'desactualizada' | 'sin_calibrar'

export interface Medicion {
  estado: EstadoMedicion
  /** Valor que puede mostrarse (null si no hay lectura o es inválida: nunca se inventa). */
  pct: number | null
  /** Segundos desde la última lectura (null si nunca hubo). */
  edad_s: number | null
  medido_en: number | null
  titulo: string
  explicacion: string
}

export function evaluarMedicion(v: VistaPanel): Medicion {
  const s = v.sensor
  const edad = s.medido_en === null ? null : Math.max(0, Math.round((v.ahora - s.medido_en) / 1000))
  const base = { edad_s: edad, medido_en: s.medido_en }
  const pct = s.valor_pct

  if (edad === null)
    return { ...base, estado: 'sin_dato', pct: null, titulo: 'Sin lecturas', explicacion: 'Todavía no se ha recibido ninguna medición del sensor.' }
  if (s.estado === 'ERROR_SENSOR' || s.estado === 'FUERA_DE_RANGO' || pct === null || !Number.isFinite(pct) || pct < 0 || pct > 100)
    return {
      ...base, estado: 'invalida', pct: null, titulo: 'Lectura inválida',
      explicacion: 'El sensor envía valores imposibles: puede estar desconectado, dañado o fuera de la tierra. No se muestra un porcentaje y el riego automático se detiene por seguridad.',
    }
  if (edad > DATOS_AL_DIA_S && (v.dispositivo.conexion === 'FUERA_DE_LINEA' || !v.actuador.reportado.fiable))
    return {
      ...base, estado: 'desconectado', pct, titulo: 'Sensor desconectado',
      explicacion: 'El equipo de campo dejó de enviar lecturas. El valor gris es la última medición conocida y puede no reflejar el suelo ahora.',
    }
  if (edad > DATOS_AL_DIA_S)
    return {
      ...base, estado: 'desactualizada', pct, titulo: 'Información desactualizada',
      explicacion: 'La última lectura no es reciente; normalmente llega cada pocos segundos. El valor gris puede no reflejar el suelo ahora.',
    }
  if (!s.calibracion_confirmada || s.estado === 'SIN_CALIBRAR')
    return {
      ...base, estado: 'sin_calibrar', pct, titulo: 'Sensor sin calibrar',
      explicacion: 'Sin calibración confirmada el porcentaje no es confiable, por eso se muestra en gris y el riego queda bloqueado.',
    }
  return { ...base, estado: 'valida', pct, titulo: 'Sensor funcionando', explicacion: 'Lectura reciente y válida del sensor.' }
}

// ── Tendencia ──

export type Sentido = 'aumentando' | 'disminuyendo' | 'estable'

/** Banda (en puntos porcentuales) dentro de la cual la humedad se considera estable; absorbe el ruido del sensor. */
export const BANDA_ESTABLE_PCT = 0.5

export function sentidoTendencia(delta: number | null, banda = BANDA_ESTABLE_PCT): Sentido | null {
  if (delta === null) return null
  if (delta > banda) return 'aumentando'
  if (delta < -banda) return 'disminuyendo'
  return 'estable'
}
