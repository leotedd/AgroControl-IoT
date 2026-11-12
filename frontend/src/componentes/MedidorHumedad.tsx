// Presentación del medidor de humedad: arco semicircular de tres zonas con aguja, y leyenda interactiva.
// Sin lógica de negocio: las zonas, la geometría y la fiabilidad vienen de utilidades/humedad.ts.
import { useEffect, useState } from 'react'
import { Droplets, Sprout, Sun, type LucideIcon } from 'lucide-react'
import { anguloAguja, numero, puntoArco, trazoArco, type DescripcionZona, type ZonaHumedad } from '../utilidades/humedad'
import { InfoEmergente } from './ui'

/** Estilo por zona. Las clases son literales para que Tailwind las genere. */
export const ESTILO_ZONA: Record<ZonaHumedad, { icono: LucideIcon; trazo: string; texto: string; fondo: string; borde: string }> = {
  seco: { icono: Sun, trazo: 'var(--zona-seco)', texto: 'text-zona-seco', fondo: 'bg-zona-seco/10', borde: 'border-zona-seco/45' },
  adecuado: { icono: Sprout, trazo: 'var(--zona-adecuado)', texto: 'text-zona-adecuado', fondo: 'bg-zona-adecuado/10', borde: 'border-zona-adecuado/45' },
  humedo: { icono: Droplets, trazo: 'var(--zona-humedo)', texto: 'text-zona-humedo', fondo: 'bg-zona-humedo/10', borde: 'border-zona-humedo/45' },
}

// Geometría del lienzo SVG (unidades del viewBox).
const CX = 140
const CY = 138
const R = 104
const GROSOR = 20
const SUAVE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * Medidor semicircular. `apagado` lo pinta en gris (lectura no confiable): el color nunca debe ocultar un problema.
 * Con `pct === null` no hay aguja: no se inventa una lectura.
 */
export function Medidor({ pct, zonas, zona, apagado, descripcion }: { pct: number | null; zonas: DescripcionZona[]; zona: ZonaHumedad | null; apagado: boolean; descripcion: string }) {
  // La aguja parte de 0 y barre hasta el valor en el primer pintado; después sólo transiciona entre lecturas.
  const [listo, setListo] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setListo(true))
    return () => cancelAnimationFrame(r)
  }, [])
  const angulo = listo && pct !== null ? anguloAguja(pct) : 0
  const marcas = [0, ...zonas.slice(1).map((z) => z.desde), 100]
  const largo = R - GROSOR / 2 - 10

  return (
    <svg viewBox="0 0 280 164" className="block w-full max-w-[340px] overflow-visible" role="img" aria-label={descripcion}>
      {/* Escala menor cada 10 % */}
      {Array.from({ length: 11 }, (_, i) => {
        const p = puntoArco(i * 10, CX, CY, R - GROSOR / 2 - 6)
        return <circle key={i} cx={p.x} cy={p.y} r={1.3} fill="var(--eje)" />
      })}

      {/* Zonas: extremos redondeados con un círculo en el mismo grupo para que la opacidad no se acumule. */}
      {zonas.map((z, i) => {
        const activa = !apagado && zona === z.zona
        const color = apagado ? 'var(--eje)' : ESTILO_ZONA[z.zona].trazo
        const extremo = i === 0 ? puntoArco(0, CX, CY, R) : i === zonas.length - 1 ? puntoArco(100, CX, CY, R) : null
        return (
          <g key={z.zona} style={{ opacity: apagado ? 0.7 : activa || zona === null ? 1 : 0.32, transition: `opacity 500ms ${SUAVE}` }}>
            <path d={trazoArco(z.desde, z.hasta, CX, CY, R)} fill="none" stroke={color} strokeWidth={GROSOR} style={{ transition: `stroke 500ms ${SUAVE}` }} />
            {extremo && <circle cx={extremo.x} cy={extremo.y} r={GROSOR / 2} fill={color} style={{ transition: `fill 500ms ${SUAVE}` }} />}
          </g>
        )
      })}

      {/* Separadores entre zonas y etiquetas de referencia 0 / inicio / parada / 100 */}
      {marcas.map((m) => {
        const extremo = m === 0 || m === 100
        const a = puntoArco(m, CX, CY, R - GROSOR / 2 - 1)
        const b = puntoArco(m, CX, CY, R + GROSOR / 2 + 1)
        const t = extremo ? { x: puntoArco(m, CX, CY, R).x, y: CY + 22 } : puntoArco(m, CX, CY, R + GROSOR / 2 + 13)
        const ancla = extremo ? 'middle' : t.x < CX - 4 ? 'end' : t.x > CX + 4 ? 'start' : 'middle'
        return (
          <g key={m}>
            {!extremo && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--superficie)" strokeWidth={3} />}
            <text x={t.x} y={t.y} textAnchor={ancla} dominantBaseline="middle" fontSize={11} fontWeight={600} fill="var(--tenue)" className="tabular">
              {numero(m)} %
            </text>
          </g>
        )
      })}

      {/* Aguja: gira alrededor del pivote; transición CSS sobre transform (sin re-montar ni parpadeos). */}
      <g
        aria-hidden
        style={{
          transform: `rotate(${angulo}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transformBox: 'view-box',
          transition: `transform 650ms ${SUAVE}, opacity 300ms`,
          opacity: pct === null ? 0 : 1,
        }}
      >
        <path d={`M ${CX - largo} ${CY} L ${CX} ${CY - 5} L ${CX + 14} ${CY} L ${CX} ${CY + 5} Z`} fill={apagado ? 'var(--tenue)' : 'var(--tinta)'} />
        <circle cx={CX - R} cy={CY} r={7} fill={apagado || !zona ? 'var(--tenue)' : ESTILO_ZONA[zona].trazo} stroke="var(--superficie)" strokeWidth={3} style={{ transition: `fill 500ms ${SUAVE}` }} />
      </g>
      <circle cx={CX} cy={CY} r={10} fill="var(--superficie)" stroke={apagado ? 'var(--tenue)' : 'var(--tinta)'} strokeWidth={3} />
      <circle cx={CX} cy={CY} r={3} fill={apagado ? 'var(--tenue)' : 'var(--tinta)'} />
    </svg>
  )
}

/** Leyenda de las tres zonas. La actual se destaca con borde, fondo y la palabra "Actual" (no sólo color). */
export function LeyendaHumedad({ zonas, actual, referencia }: { zonas: DescripcionZona[]; actual: ZonaHumedad | null; referencia: boolean }) {
  return (
    <ul className="space-y-2" aria-label="Interpretación de la humedad">
      {zonas.map((z) => {
        const e = ESTILO_ZONA[z.zona]
        const activa = actual === z.zona
        const Icono = e.icono
        return (
          <li
            key={z.zona}
            aria-current={activa ? 'true' : undefined}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-500 ${activa ? `${e.borde} ${e.fondo}` : 'border-borde bg-superficie'}`}
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${e.fondo}`} aria-hidden>
              <Icono className={`size-[18px] ${e.texto}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-xs font-bold uppercase tracking-wider text-tinta">{z.nombre}</span>
                <span className="tabular text-xs text-tenue">{z.rango}</span>
                {activa && (
                  <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold ${e.borde} text-tinta`}>{referencia ? 'Última lectura' : 'Actual'}</span>
                )}
              </span>
              <span className="mt-0.5 block text-sm text-tinta-2">{z.frase}.</span>
            </span>
            <InfoEmergente etiqueta={`Más información: ${z.etiqueta}`}>
              <strong className="mb-1 block text-tinta">
                {z.etiqueta} · {z.rango}
              </strong>
              {z.detalle}
            </InfoEmergente>
          </li>
        )
      })}
    </ul>
  )
}
