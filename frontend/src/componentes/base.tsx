import type { ReactNode } from 'react'
import { MODO } from '../datos/fuente'
import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, OctagonAlert, type LucideIcon } from 'lucide-react'

export function Tarjeta({
  titulo,
  icono: Icono,
  accion,
  children,
  className = '',
  id,
}: {
  id?: string
  titulo: string
  icono?: LucideIcon
  accion?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      id={id}
      className={`sombra rounded-2xl border border-borde bg-superficie p-4 sm:p-5 ${className}`}
      aria-label={titulo}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold leading-tight text-tinta">
          {Icono && (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-marca-suave text-marca">
              <Icono className="size-4" aria-hidden />
            </span>
          )}
          {titulo}
        </h2>
        {accion}
      </header>
      {children}
    </section>
  )
}

export type Tono = 'ok' | 'aviso' | 'serio' | 'critico' | 'neutro' | 'serie'

const ICONO_TONO: Record<Tono, LucideIcon> = {
  ok: CheckCircle2,
  aviso: AlertTriangle,
  serio: AlertTriangle,
  critico: OctagonAlert,
  neutro: CircleDashed,
  serie: CircleDashed,
}

const COLOR_TONO: Record<Tono, string> = {
  ok: 'text-ok',
  aviso: 'text-aviso',
  serio: 'text-serio',
  critico: 'text-critico',
  neutro: 'text-tenue',
  serie: 'text-serie',
}

/** Estado = icono de color + etiqueta en tinta (nunca color solo). */
export function Insignia({ tono, children, icono }: { tono: Tono; children: ReactNode; icono?: LucideIcon }) {
  const Icono = icono ?? ICONO_TONO[tono]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-borde bg-hundido px-2.5 py-1 text-xs font-medium text-tinta">
      <Icono className={`size-3.5 ${COLOR_TONO[tono]}`} aria-hidden />
      {children}
    </span>
  )
}

export function EtiquetaDemo({ texto = 'DEMO' }: { texto?: string }) {
  if (MODO !== 'demo') return null // en modo REAL no hay datos simulados
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-demo px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-sobre"
      title="Datos simulados: no provienen del ESP32 real"
    >
      <FlaskConical className="size-3" aria-hidden />
      {texto}
    </span>
  )
}

export function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: ReactNode; nota?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-tenue">{etiqueta}</dt>
      <dd className="tabular mt-0.5 truncate text-sm font-medium text-tinta">{valor}</dd>
      {nota && <dd className="text-xs text-tenue">{nota}</dd>}
    </div>
  )
}
