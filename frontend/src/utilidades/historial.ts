// Historial agregado: misma forma que GET /sensores/{id}/mediciones?agrupacion= (backend), para que
// DEMO (agrega en el navegador) y REAL (agrega MySQL) alimenten la misma gráfica.
import type { Muestra } from '../tipos/contrato'

export interface Tramo {
  t: number // inicio del intervalo (epoch ms)
  promedio: number | null
  minimo: number | null
  maximo: number | null
  lecturas: number
}

export type Rango = '1h' | '6h' | '24h' | '7d'

export const RANGOS: Record<Rango, { etiqueta: string; ms: number; agrupacion: 'crudo' | '5m' | '1h'; intervalo_s: number }> = {
  '1h': { etiqueta: '1 h', ms: 3600_000, agrupacion: 'crudo', intervalo_s: 0 },
  '6h': { etiqueta: '6 h', ms: 6 * 3600_000, agrupacion: '5m', intervalo_s: 300 },
  '24h': { etiqueta: '24 h', ms: 24 * 3600_000, agrupacion: '5m', intervalo_s: 300 },
  '7d': { etiqueta: '7 días', ms: 7 * 86400_000, agrupacion: '1h', intervalo_s: 3600 },
}

/** Máximo de días para un período personalizado (la agrupación 1h del backend admite hasta 90). */
export const MAX_DIAS_PERSONALIZADO = 90

/**
 * Agrupación para un período elegido por el usuario, dentro de los límites del backend
 * (crudo ≤ 2 días, 5m ≤ 14, 1h ≤ 90): lo bastante fina para leerse sin superar 5000 puntos.
 */
export function periodoPersonalizado(desde: number, hasta: number): { agrupacion: 'crudo' | '5m' | '1h'; intervalo_s: number } {
  const horas = (hasta - desde) / 3600_000
  if (horas <= 3) return { agrupacion: 'crudo', intervalo_s: 0 }
  if (horas <= 3 * 24) return { agrupacion: '5m', intervalo_s: 300 }
  return { agrupacion: '1h', intervalo_s: 3600 }
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** Agrupa muestras en intervalos de `intervalo_s` (0 = sin agrupar). Ignora lecturas nulas en el promedio. */
export function agrupar(muestras: Muestra[], intervalo_s: number, desde: number): Tramo[] {
  const dentro = muestras.filter((m) => m.t >= desde)
  if (intervalo_s <= 0) return dentro.map((m) => ({ t: m.t, promedio: m.pct, minimo: m.pct, maximo: m.pct, lecturas: 1 }))
  const paso = intervalo_s * 1000
  const grupos = new Map<number, number[]>()
  const conteo = new Map<number, number>()
  for (const m of dentro) {
    const k = Math.floor(m.t / paso) * paso
    conteo.set(k, (conteo.get(k) ?? 0) + 1)
    if (m.pct !== null) grupos.set(k, [...(grupos.get(k) ?? []), m.pct])
  }
  return [...conteo.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const v = grupos.get(k) ?? []
      return {
        t: k,
        promedio: v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : null,
        minimo: v.length ? Math.min(...v) : null,
        maximo: v.length ? Math.max(...v) : null,
        lecturas: conteo.get(k)!,
      }
    })
}

/** Tendencia: diferencia entre la lectura actual y la media de hace ~15 min (null si no hay datos). */
export function tendencia(muestras: Muestra[], ahora: number, ventanaMin = 15): number | null {
  const validas = muestras.filter((m) => m.pct !== null)
  if (validas.length < 2) return null
  const actual = validas[validas.length - 1].pct!
  const objetivo = ahora - ventanaMin * 60_000
  const previas = validas.filter((m) => Math.abs(m.t - objetivo) <= 2.5 * 60_000)
  if (!previas.length) return null
  return r1(actual - previas.reduce((s, m) => s + m.pct!, 0) / previas.length)
}

/** Mínimo y máximo de la última hora. */
export function extremos(muestras: Muestra[], ahora: number): { min: number; max: number } | null {
  const v = muestras.filter((m) => m.pct !== null && m.t >= ahora - 3600_000).map((m) => m.pct!)
  return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null
}

/** CSV del historial (punto y coma, compatible con Excel en español). */
export function aCsv(tramos: Tramo[]): string {
  const filas = tramos.map((t) => [new Date(t.t).toISOString(), t.promedio ?? '', t.minimo ?? '', t.maximo ?? '', t.lecturas].join(';'))
  return ['inicio_utc;promedio_pct;minimo_pct;maximo_pct;lecturas', ...filas].join('\n')
}
