import { useMemo, useState } from 'react'
import { Activity, BarChart3, Table2 } from 'lucide-react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import type { Ciclo, VistaPanel } from '../tipos/contrato'
import { formatoHora, formatoHoraCorta, texto } from '../utilidades/formato'
import { EtiquetaDemo, Tarjeta } from './base'

const VENTANAS = [
  { etiqueta: '15 min', ms: 15 * 60 * 1000 },
  { etiqueta: '1 h', ms: 60 * 60 * 1000 },
  { etiqueta: '2 h', ms: 2 * 60 * 60 * 1000 },
]

const ejeTexto = { fontSize: 11, fill: 'var(--tenue)' }

function Segmentado<T extends string | number>({
  opciones,
  valor,
  onCambio,
  etiqueta,
}: {
  opciones: { etiqueta: string; valor: T }[]
  valor: T
  onCambio: (v: T) => void
  etiqueta: string
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="inline-flex rounded-lg border border-borde bg-hundido p-0.5">
      {opciones.map((o) => (
        <button
          key={String(o.valor)}
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={`h-9 rounded-md px-3 text-xs ${valor === o.valor ? 'bg-superficie font-medium shadow-sm' : 'text-tinta-2'}`}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

function BotonTabla({ activo, onCambio }: { activo: boolean; onCambio: () => void }) {
  return (
    <button
      onClick={onCambio}
      aria-pressed={activo}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs ${
        activo ? 'border-serie bg-serie-suave' : 'border-borde text-tinta-2 hover:bg-hundido'
      }`}
    >
      <Table2 className="size-3.5" aria-hidden /> Tabla
    </button>
  )
}

function TooltipHumedad({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { t: number; pct: number | null; bomba: boolean }
  return (
    <div className="rounded-lg border border-borde bg-superficie px-3 py-2 text-xs shadow-lg">
      <p className="tabular text-tenue">{formatoHora(p.t)}</p>
      <p className="tabular mt-1 text-sm font-semibold text-tinta">{p.pct === null ? 'Sin lectura' : `${p.pct.toFixed(1)} %`}</p>
      <p className="text-tinta-2">Bomba {p.bomba ? 'encendida' : 'apagada'}</p>
    </div>
  )
}

export function GraficaHumedad({ vista }: { vista: VistaPanel }) {
  const [ventana, setVentana] = useState(VENTANAS[0].ms)
  const [tabla, setTabla] = useState(false)
  const desde = vista.ahora - ventana
  const { umbral_inicio_pct: ini, umbral_parada_pct: fin } = vista.actuador.control

  const datos = useMemo(() => vista.historial.filter((m) => m.t >= desde), [vista.historial, desde])
  const riegos = useMemo(
    () =>
      vista.ciclos
        .filter((c) => (c.fin ?? vista.ahora) >= desde)
        .map((c) => ({ x1: Math.max(c.inicio, desde), x2: c.fin ?? vista.ahora, origen: c.origen })),
    [vista.ciclos, desde, vista.ahora],
  )

  return (
    <Tarjeta
      titulo="Humedad reciente"
      icono={Activity}
      accion={
        <div className="flex items-center gap-2">
          <EtiquetaDemo />
          <BotonTabla activo={tabla} onCambio={() => setTabla(!tabla)} />
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmentado
          etiqueta="Ventana de tiempo"
          opciones={VENTANAS.map((v) => ({ etiqueta: v.etiqueta, valor: v.ms }))}
          valor={ventana}
          onCambio={setVentana}
        />
        <p className="flex flex-wrap items-center gap-3 text-xs text-tinta-2">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-serie" aria-hidden /> Humedad %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-sm bg-hundido ring-1 ring-eje" aria-hidden /> Bomba encendida
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-sm bg-marca-suave ring-1 ring-marca/30" aria-hidden /> Rango deseado
          </span>
        </p>
      </div>

      {datos.length === 0 && !tabla ? (
        <div className="rounded-xl border border-dashed border-eje px-6 py-12 text-center">
          <p className="text-sm font-medium">Sin mediciones en esta ventana</p>
          <p className="mt-1 text-xs text-tenue">La gráfica se llenará cuando el sensor envíe lecturas. No se dibujan datos inventados.</p>
        </div>
      ) : tabla ? (
        <TablaHumedad datos={datos.slice(-24).reverse()} />
      ) : (
        <div className="h-64 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <defs>
                <linearGradient id="relleno-humedad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--serie-1)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--serie-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--rejilla)" strokeWidth={1} vertical={false} />
              <ReferenceArea y1={ini} y2={fin} fill="var(--marca)" fillOpacity={0.07} ifOverflow="hidden" />
              {riegos.map((r) => (
                <ReferenceArea key={r.x1} x1={r.x1} x2={r.x2} fill="var(--hundido)" stroke="var(--eje)" strokeOpacity={0.6} ifOverflow="hidden" />
              ))}
              <XAxis
                dataKey="t"
                type="number"
                domain={[desde, vista.ahora]}
                tickFormatter={formatoHoraCorta}
                tick={ejeTexto}
                stroke="var(--eje)"
                tickLine={false}
                minTickGap={40}
              />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={ejeTexto} stroke="var(--eje)" tickLine={false} unit="%" width={44} />
              <ReferenceLine
                y={fin}
                stroke="var(--tenue)"
                strokeDasharray="4 4"
                label={{ value: `Parada ${fin} %`, position: 'insideTopRight', fontSize: 11, fill: 'var(--tinta-2)' }}
              />
              <ReferenceLine
                y={ini}
                stroke="var(--tenue)"
                strokeDasharray="4 4"
                label={{ value: `Inicio ${ini} %`, position: 'insideBottomRight', fontSize: 11, fill: 'var(--tinta-2)' }}
              />
              <Tooltip
                content={<TooltipHumedad />}
                cursor={{ stroke: 'var(--tinta-2)', strokeWidth: 1, strokeDasharray: '3 3' }}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="pct"
                stroke="var(--serie-1)"
                strokeWidth={2}
                fill="url(#relleno-humedad)"
                connectNulls={false}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--superficie)', strokeWidth: 2, fill: 'var(--serie-1)' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tarjeta>
  )
}

function TablaHumedad({ datos }: { datos: { t: number; pct: number | null; bomba: boolean }[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-borde">
      <table className="w-full whitespace-nowrap text-sm">
        <thead className="sticky top-0 bg-hundido text-left text-xs text-tenue">
          <tr>
            <th className="px-3 py-2 font-medium">Hora</th>
            <th className="px-3 py-2 text-right font-medium">Humedad</th>
            <th className="px-3 py-2 font-medium">Bomba</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {datos.map((m) => (
            <tr key={m.t} className="border-t border-rejilla">
              <td className="px-3 py-1.5">{formatoHora(m.t)}</td>
              <td className="px-3 py-1.5 text-right">{m.pct === null ? '—' : `${m.pct.toFixed(1)} %`}</td>
              <td className="px-3 py-1.5">{m.bomba ? 'Encendida' : 'Apagada'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TooltipCiclo({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const c = payload[0].payload as Ciclo & { etiqueta: string }
  return (
    <div className="rounded-lg border border-borde bg-superficie px-3 py-2 text-xs shadow-lg">
      <p className="tabular text-tenue">{formatoHora(c.inicio)}</p>
      <p className="tabular mt-1 text-sm font-semibold text-tinta">{c.duracion_s} s</p>
      <p className="text-tinta-2">Riego {c.origen === 'MANUAL' ? 'manual' : 'automático'}</p>
      <p className="text-tinta-2">{texto(c.motivo_fin)}</p>
      {c.humedad_inicio !== null && (
        <p className="tabular text-tinta-2">
          {c.humedad_inicio.toFixed(1)} % → {c.humedad_fin === null ? '—' : `${c.humedad_fin.toFixed(1)} %`}
        </p>
      )}
    </div>
  )
}

export function GraficaRiegos({ vista }: { vista: VistaPanel }) {
  const [tabla, setTabla] = useState(false)
  const datos = useMemo(
    () =>
      vista.ciclos
        .filter((c) => c.fin !== null)
        .slice(-12)
        .map((c) => ({ ...c, etiqueta: formatoHoraCorta(c.inicio) })),
    [vista.ciclos],
  )
  const maximo = vista.actuador.control.riego_max_s

  return (
    <Tarjeta
      titulo="Duración de los últimos riegos"
      icono={BarChart3}
      accion={
        <div className="flex items-center gap-2">
          <EtiquetaDemo />
          <BotonTabla activo={tabla} onCambio={() => setTabla(!tabla)} />
        </div>
      }
    >
      {datos.length === 0 ? (
        <p className="py-10 text-center text-sm text-tenue">Aún no hay riegos completados.</p>
      ) : tabla ? (
        <div className="max-h-56 overflow-auto rounded-lg border border-borde">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 bg-hundido text-left text-xs text-tenue">
              <tr>
                <th className="px-3 py-2 font-medium">Inicio</th>
                <th className="px-3 py-2 text-right font-medium">Duración</th>
                <th className="px-3 py-2 font-medium">Origen</th>
                <th className="px-3 py-2 font-medium">Fin</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[...datos].reverse().map((c) => (
                <tr key={c.inicio} className="border-t border-rejilla">
                  <td className="px-3 py-1.5">{formatoHora(c.inicio)}</td>
                  <td className="px-3 py-1.5 text-right">{c.duracion_s} s</td>
                  <td className="px-3 py-1.5">{c.origen === 'MANUAL' ? 'Manual' : 'Automático'}</td>
                  <td className="px-3 py-1.5">{texto(c.motivo_fin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos} margin={{ top: 16, right: 8, bottom: 0, left: -4 }} barCategoryGap={6}>
              <CartesianGrid stroke="var(--rejilla)" vertical={false} />
              <XAxis dataKey="etiqueta" tick={ejeTexto} stroke="var(--eje)" tickLine={false} minTickGap={8} />
              <YAxis
                domain={[0, Math.max(maximo + 5, 20)]}
                tick={ejeTexto}
                stroke="var(--eje)"
                tickLine={false}
                unit=" s"
                width={44}
                allowDecimals={false}
              />
              <ReferenceLine
                y={maximo}
                stroke="var(--tenue)"
                strokeDasharray="4 4"
                label={{ value: `Máx. ${maximo} s`, position: 'insideTopRight', fontSize: 11, fill: 'var(--tinta-2)' }}
              />
              <Tooltip content={<TooltipCiclo />} cursor={{ fill: 'var(--hundido)' }} isAnimationActive={false} />
              <Bar dataKey="duracion_s" fill="var(--serie-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tarjeta>
  )
}
