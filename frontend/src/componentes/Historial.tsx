import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Activity, CalendarRange, Download, History, Table2 } from 'lucide-react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import { api, MODO } from '../datos/fuente'
import type { NivelEvento, VistaPanel } from '../tipos/contrato'
import { formatoFechaHora, formatoHora, formatoHoraCorta, texto } from '../utilidades/formato'
import { MAX_DIAS_PERSONALIZADO, RANGOS, aCsv, agrupar, periodoPersonalizado, type Rango, type Tramo } from '../utilidades/historial'
import { EtiquetaDemo, Tarjeta } from './base'
import { GraficaRiegos } from './Graficas'
import { IconoNivel, Segmentado } from './ui'

const eje = { fontSize: 11, fill: 'var(--tenue)' }
const NOMBRE_RANGO: Record<Rango, string> = { '1h': 'la última hora', '6h': 'las últimas 6 horas', '24h': 'las últimas 24 horas', '7d': 'los últimos 7 días' }

/** Período consultado: uno rápido o uno elegido por fecha. */
type Periodo = { tipo: 'rapido'; rango: Rango } | { tipo: 'personal'; desde: number; hasta: number }

function TooltipTramo({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const t = payload[0].payload as Tramo
  return (
    <div className="rounded-lg border border-borde bg-superficie px-3 py-2 text-xs shadow-lg">
      <p className="tabular text-tenue">{formatoFechaHora(t.t)}</p>
      <p className="tabular mt-1 text-sm font-semibold text-tinta">{t.promedio === null ? 'Sin lectura válida' : `${t.promedio.toFixed(1)} % de humedad`}</p>
      {t.lecturas > 1 && t.minimo !== null && (
        <p className="tabular text-tinta-2">
          entre {t.minimo.toFixed(1)} y {t.maximo!.toFixed(1)} % · {t.lecturas} lecturas
        </p>
      )}
    </div>
  )
}

const limites = (p: Periodo, ahora: number) => (p.tipo === 'rapido' ? { desde: ahora - RANGOS[p.rango].ms, hasta: ahora } : { desde: p.desde, hasta: p.hasta })
const agrupacionDe = (p: Periodo) => (p.tipo === 'rapido' ? RANGOS[p.rango] : periodoPersonalizado(p.desde, p.hasta))

/** Historial: REAL consulta MySQL agregado; DEMO agrega en el navegador lo que tenga el simulador. */
function useHistorial(vista: VistaPanel, periodo: Periodo) {
  const [real, setReal] = useState<{ datos: Tramo[]; error: string | null; cargando: boolean }>({ datos: [], error: null, cargando: MODO === 'real' })
  const clave = JSON.stringify(periodo)
  useEffect(() => {
    if (MODO !== 'real') return
    let vivo = true
    const cargar = () =>
      api!
        .historial(periodo.tipo === 'rapido' ? periodo.rango : { desde: periodo.desde, hasta: periodo.hasta })
        .then((datos) => vivo && setReal({ datos, error: null, cargando: false }))
        .catch((e) => vivo && setReal((p) => ({ ...p, error: (e as Error).message, cargando: false })))
    setReal((p) => ({ ...p, cargando: true }))
    void cargar()
    // Un período rápido termina "ahora": se refresca. Uno personalizado es fijo.
    const id = periodo.tipo === 'rapido' ? setInterval(cargar, 30_000) : undefined
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [clave])
  const demo = useMemo(() => {
    if (MODO !== 'demo') return []
    const { desde, hasta } = limites(periodo, vista.ahora)
    return agrupar(vista.historial.filter((m) => m.t <= hasta), agrupacionDe(periodo).intervalo_s || 0, desde)
  }, [vista.historial, vista.ahora, clave])
  return MODO === 'real' ? real : { datos: demo, error: null, cargando: false }
}

const aFechaLocal = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** Formulario de período personalizado (fecha y hora locales). */
function FormularioPeriodo({ inicial, onAplicar }: { inicial: { desde: number; hasta: number }; onAplicar: (desde: number, hasta: number) => void }) {
  const [desde, setDesde] = useState(aFechaLocal(inicial.desde))
  const [hasta, setHasta] = useState(aFechaLocal(inicial.hasta))
  const d = Date.parse(desde)
  const h = Date.parse(hasta)
  const error = !d || !h ? 'Elija ambas fechas.' : d >= h ? 'La fecha inicial debe ser anterior a la final.' : h - d > MAX_DIAS_PERSONALIZADO * 86400_000 ? `El período máximo es de ${MAX_DIAS_PERSONALIZADO} días.` : null
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (!error) onAplicar(d, h)
  }
  const campo = 'mt-1 h-11 w-full rounded-lg border border-borde bg-plano px-3 text-base text-tinta sm:text-sm'
  return (
    <form onSubmit={enviar} className="mb-3 grid grid-cols-1 gap-3 rounded-xl bg-hundido p-3 min-[430px]:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
      <label className="text-xs font-medium text-tinta-2">
        Desde
        <input type="datetime-local" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={campo} />
      </label>
      <label className="text-xs font-medium text-tinta-2">
        Hasta
        <input type="datetime-local" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={campo} />
      </label>
      <button disabled={!!error} className="h-11 rounded-lg bg-marca px-4 text-sm font-semibold text-sobre hover:bg-marca-fuerte disabled:opacity-50 min-[430px]:col-span-2 lg:col-span-1">
        Ver período
      </button>
      {error && <p className="text-xs text-critico min-[430px]:col-span-2 lg:col-span-3">{error}</p>}
    </form>
  )
}

export function PaginaHistorial({ vista }: { vista: VistaPanel }) {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'rapido', rango: '24h' })
  const [personalAbierto, setPersonalAbierto] = useState(false)
  const [tabla, setTabla] = useState(false)
  const { datos, error, cargando } = useHistorial(vista, periodo)
  const { desde, hasta } = limites(periodo, vista.ahora)
  const ag = agrupacionDe(periodo)
  const { umbral_inicio_pct: ini, umbral_parada_pct: fin } = vista.actuador.control
  const conValor = datos.filter((d) => d.promedio !== null)
  const resumen = conValor.length
    ? {
        media: Math.round((conValor.reduce((s, d) => s + d.promedio!, 0) / conValor.length) * 10) / 10,
        min: Math.min(...conValor.map((d) => d.minimo ?? d.promedio!)),
        max: Math.max(...conValor.map((d) => d.maximo ?? d.promedio!)),
        lecturas: datos.reduce((s, d) => s + d.lecturas, 0),
        bajoUmbral: Math.round((conValor.filter((d) => d.promedio! < ini).length / conValor.length) * 100),
      }
    : null
  const riegos = vista.ciclos.filter((c) => c.inicio >= desde && c.inicio <= hasta)
  const multiDia = hasta - desde > 24 * 3600_000
  const nombrePeriodo = periodo.tipo === 'rapido' ? NOMBRE_RANGO[periodo.rango] : 'el período elegido'

  const descargar = () => {
    const url = URL.createObjectURL(new Blob([aCsv(datos)], { type: 'text/csv;charset=utf-8' }))
    const sufijo = periodo.tipo === 'rapido' ? periodo.rango : `${aFechaLocal(desde).slice(0, 10)}_${aFechaLocal(hasta).slice(0, 10)}`
    const a = Object.assign(document.createElement('a'), { href: url, download: `humedad-${vista.sensor.codigo}-${sufijo}.csv` })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Humedad del suelo"
        icono={History}
        accion={
          <div className="flex items-center gap-2">
            <EtiquetaDemo />
            <button onClick={() => setTabla(!tabla)} aria-pressed={tabla} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs ${tabla ? 'border-serie bg-serie-suave' : 'border-borde text-tinta-2 hover:bg-hundido'}`}>
              <Table2 className="size-3.5" aria-hidden /> Tabla
            </button>
            <button onClick={descargar} disabled={!datos.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-borde px-3 text-xs text-tinta-2 hover:bg-hundido disabled:opacity-50">
              <Download className="size-3.5" aria-hidden /> CSV
            </button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmentado
            etiqueta="Período"
            valor={periodo.tipo === 'rapido' ? periodo.rango : 'personal'}
            onCambio={(v) => {
              if (v === 'personal') return setPersonalAbierto(true)
              setPersonalAbierto(false)
              setPeriodo({ tipo: 'rapido', rango: v as Rango })
            }}
            opciones={[...(Object.keys(RANGOS) as Rango[]).map((r) => ({ valor: r as string, etiqueta: RANGOS[r].etiqueta })), { valor: 'personal', etiqueta: 'Fechas…' }]}
          />
          {periodo.tipo === 'personal' && !personalAbierto && (
            <button type="button" onClick={() => setPersonalAbierto(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-marca hover:bg-marca-suave">
              <CalendarRange className="size-4" aria-hidden />
              {formatoFechaHora(desde)} – {formatoFechaHora(hasta)}
            </button>
          )}
        </div>
        {personalAbierto && (
          <FormularioPeriodo
            inicial={{ desde, hasta }}
            onAplicar={(d, h) => {
              setPeriodo({ tipo: 'personal', desde: d, hasta: h })
              setPersonalAbierto(false)
            }}
          />
        )}

        {resumen && (
          <p className="mb-3 rounded-xl bg-marca-suave px-3 py-2.5 text-sm leading-relaxed text-tinta">
            En {nombrePeriodo} la humedad promedio fue <strong>{resumen.media} %</strong> (entre {resumen.min} % y {resumen.max} %).{' '}
            {resumen.bajoUmbral === 0
              ? 'Nunca bajó del umbral de riego.'
              : `Estuvo por debajo del umbral de riego (${ini} %) el ${resumen.bajoUmbral} % del tiempo.`}{' '}
            {riegos.length ? `Se registraron ${riegos.length === 1 ? '1 riego' : `${riegos.length} riegos`}.` : 'No hubo riegos.'}
          </p>
        )}

        <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tinta-2">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-serie" aria-hidden /> Promedio</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-serie-suave ring-1 ring-serie/30" aria-hidden /> Mínimo–máximo</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-marca-suave ring-1 ring-marca/30" aria-hidden /> Rango deseado</span>
          <span className="text-tenue">{ag.agrupacion === 'crudo' ? 'Cada lectura' : `Agrupado cada ${ag.intervalo_s >= 3600 ? `${ag.intervalo_s / 3600} h` : `${ag.intervalo_s / 60} min`}`}</span>
        </p>

        {error && <p className="mb-2 rounded-lg bg-critico/10 px-3 py-2 text-sm">No se pudo cargar el historial: {error}</p>}
        {!datos.length ? (
          <div className="rounded-xl border border-dashed border-eje px-6 py-12 text-center">
            <p className="text-sm font-medium">{cargando ? 'Cargando mediciones…' : 'Sin mediciones en este período'}</p>
            {!cargando && <p className="mt-1 text-xs text-tenue">Pruebe con un período más amplio. Sólo se muestran lecturas reales recibidas del sensor.</p>}
          </div>
        ) : tabla ? (
          <div className="max-h-96 overflow-auto rounded-lg border border-borde">
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="sticky top-0 bg-hundido text-left text-xs text-tenue">
                <tr>
                  <th className="px-3 py-2 font-medium">Inicio</th>
                  <th className="px-3 py-2 text-right font-medium">Promedio</th>
                  <th className="px-3 py-2 text-right font-medium">Mín</th>
                  <th className="px-3 py-2 text-right font-medium">Máx</th>
                  <th className="px-3 py-2 text-right font-medium">Lecturas</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[...datos].reverse().map((d) => (
                  <tr key={d.t} className="border-t border-rejilla">
                    <td className="px-3 py-1.5">{formatoFechaHora(d.t)}</td>
                    <td className="px-3 py-1.5 text-right">{d.promedio ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">{d.minimo ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">{d.maximo ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">{d.lecturas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-64 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                <CartesianGrid stroke="var(--rejilla)" vertical={false} />
                <ReferenceArea y1={ini} y2={fin} fill="var(--marca)" fillOpacity={0.07} ifOverflow="hidden" />
                <XAxis dataKey="t" type="number" domain={[desde, hasta]} tickFormatter={multiDia ? formatoFechaHora : formatoHoraCorta} tick={eje} stroke="var(--eje)" tickLine={false} minTickGap={56} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={eje} stroke="var(--eje)" tickLine={false} unit="%" width={44} />
                <ReferenceLine y={fin} stroke="var(--tenue)" strokeDasharray="4 4" label={{ value: `Parada ${fin} %`, position: 'insideTopRight', fontSize: 11, fill: 'var(--tinta-2)' }} />
                <ReferenceLine y={ini} stroke="var(--tenue)" strokeDasharray="4 4" label={{ value: `Inicio ${ini} %`, position: 'insideBottomRight', fontSize: 11, fill: 'var(--tinta-2)' }} />
                <Tooltip content={<TooltipTramo />} cursor={{ stroke: 'var(--tinta-2)', strokeDasharray: '3 3' }} isAnimationActive={false} />
                <Area type="monotone" dataKey={(d: Tramo) => (d.minimo === null ? null : [d.minimo, d.maximo])} stroke="none" fill="var(--serie-1)" fillOpacity={0.15} isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="promedio" stroke="var(--serie-1)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} activeDot={{ r: 5, stroke: 'var(--superficie)', strokeWidth: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs text-tenue">Toque o pase el cursor sobre la gráfica para ver el valor de cada momento.</p>
      </Tarjeta>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GraficaRiegos vista={vista} />
        <Tarjeta titulo={`Riegos en el período (${riegos.length})`} icono={History} accion={<EtiquetaDemo />}>
          {riegos.length === 0 ? (
            <p className="py-8 text-center text-sm text-tenue">No hubo riegos en este período.</p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-lg border border-borde">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="sticky top-0 bg-hundido text-left text-xs text-tenue">
                  <tr>
                    <th className="px-3 py-2 font-medium">Inicio</th>
                    <th className="px-3 py-2 font-medium">Cómo</th>
                    <th className="px-3 py-2 text-right font-medium">Duración</th>
                    <th className="px-3 py-2 font-medium">Por qué terminó</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {[...riegos].reverse().map((c) => (
                    <tr key={c.inicio} className="border-t border-rejilla">
                      <td className="px-3 py-1.5">{formatoFechaHora(c.inicio)}</td>
                      <td className="px-3 py-1.5">{c.origen === 'MANUAL' ? 'Manual' : 'Automático'}</td>
                      <td className="px-3 py-1.5 text-right">{c.duracion_s === null ? 'en curso' : `${c.duracion_s} s`}</td>
                      <td className="px-3 py-1.5">{texto(c.motivo_fin) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tarjeta>
      </div>

      <ActividadEquipo vista={vista} />
    </div>
  )
}

const NIVEL_EVENTO: Record<NivelEvento, 'neutro' | 'atencion' | 'problema'> = { info: 'neutro', aviso: 'atencion', critico: 'problema' }

/** Registro de lo que hizo el equipo (eventos del ESP32), filtrable por importancia. */
export function ActividadEquipo({ vista, titulo = 'Actividad del equipo' }: { vista: VistaPanel; titulo?: string }) {
  const [filtro, setFiltro] = useState<'todos' | 'importantes'>('todos')
  const eventos = vista.eventos.filter((e) => filtro === 'todos' || e.nivel !== 'info')
  return (
    <Tarjeta
      titulo={titulo}
      icono={Activity}
      accion={
        <div className="flex items-center gap-2">
          <EtiquetaDemo />
          <Segmentado etiqueta="Filtrar actividad" valor={filtro} onCambio={setFiltro} opciones={[{ valor: 'todos', etiqueta: 'Todo' }, { valor: 'importantes', etiqueta: 'Avisos' }]} />
        </div>
      }
    >
      {eventos.length === 0 ? (
        <p className="py-6 text-center text-sm text-tenue">{filtro === 'todos' ? 'El equipo todavía no ha registrado actividad.' : 'Sin avisos: sólo hay actividad normal.'}</p>
      ) : (
        <ol className="max-h-96 space-y-1 overflow-auto pr-1">
          {eventos.map((e) => (
            <li key={e.id} className="flex gap-3 rounded-lg px-1 py-2">
              <IconoNivel nivel={NIVEL_EVENTO[e.nivel]} tamano="sm" />
              <div className="min-w-0">
                <p className="text-sm leading-snug">{e.detalle}</p>
                <p className="tabular text-xs text-tenue">{vista.ahora - e.t > 86400_000 ? formatoFechaHora(e.t) : formatoHora(e.t)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Tarjeta>
  )
}
