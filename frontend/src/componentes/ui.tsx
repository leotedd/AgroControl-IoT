// Piezas de interfaz compartidas: niveles de estado, ayuda contextual, desplegables y confirmaciones.
// Todo funciona con toque y teclado; nada importante depende del hover.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, HelpCircle, Info, OctagonAlert, X, type LucideIcon } from 'lucide-react'
import type { Nivel } from '../utilidades/finca'

export const ESTILO_NIVEL: Record<Nivel, { icono: LucideIcon; color: string; fondo: string; borde: string; etiqueta: string }> = {
  ok: { icono: CheckCircle2, color: 'text-ok', fondo: 'bg-ok/10', borde: 'border-ok/30', etiqueta: 'Correcto' },
  atencion: { icono: AlertTriangle, color: 'text-aviso', fondo: 'bg-aviso/10', borde: 'border-aviso/40', etiqueta: 'Revisar' },
  problema: { icono: OctagonAlert, color: 'text-critico', fondo: 'bg-critico/10', borde: 'border-critico/35', etiqueta: 'Problema' },
  neutro: { icono: CircleDashed, color: 'text-tenue', fondo: 'bg-hundido', borde: 'border-borde', etiqueta: 'Sin datos' },
}

/** Icono de nivel en un círculo; el significado se acompaña siempre de texto en quien lo usa. */
export function IconoNivel({ nivel, tamano = 'md' }: { nivel: Nivel; tamano?: 'sm' | 'md' | 'lg' }) {
  const { icono: Icono, color, fondo } = ESTILO_NIVEL[nivel]
  const t = { sm: ['size-7', 'size-4'], md: ['size-9', 'size-5'], lg: ['size-12', 'size-6'] }[tamano]
  return (
    <span className={`grid shrink-0 place-items-center rounded-full ${t[0]} ${fondo}`} aria-hidden>
      <Icono className={`${t[1]} ${color}`} />
    </span>
  )
}

/** "¿Qué significa?": explicación que se abre al tocar, anunciada a lectores de pantalla. */
export function Ayuda({ children, etiqueta = '¿Qué significa?' }: { children: ReactNode; etiqueta?: string }) {
  const [abierta, setAbierta] = useState(false)
  const id = useId()
  return (
    <div>
      <button
        type="button"
        onClick={() => setAbierta(!abierta)}
        aria-expanded={abierta}
        aria-controls={id}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-marca hover:underline"
      >
        <HelpCircle className="size-4" aria-hidden />
        {abierta ? 'Ocultar explicación' : etiqueta}
      </button>
      <div id={id} hidden={!abierta} className="mt-1 rounded-xl bg-hundido px-3 py-2.5 text-sm leading-relaxed text-tinta-2">
        {children}
      </div>
    </div>
  )
}

/**
 * Información emergente (tooltip) accesible: se abre con hover, foco de teclado o toque y se cierra con Esc,
 * al salir o al tocar fuera. El texto queda asociado al botón con aria-describedby.
 */
export function InfoEmergente({ etiqueta, children, lado = 'derecha' }: { etiqueta: string; children: ReactNode; lado?: 'derecha' | 'izquierda' }) {
  const [abierta, setAbierta] = useState(false)
  const id = useId()
  const raiz = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!abierta) return
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierta(false)
    const fuera = (e: PointerEvent) => !raiz.current?.contains(e.target as Node) && setAbierta(false)
    document.addEventListener('keydown', tecla)
    document.addEventListener('pointerdown', fuera)
    return () => {
      document.removeEventListener('keydown', tecla)
      document.removeEventListener('pointerdown', fuera)
    }
  }, [abierta])
  return (
    <span ref={raiz} className="relative inline-flex" onMouseEnter={() => setAbierta(true)} onMouseLeave={() => setAbierta(false)}>
      <button
        type="button"
        aria-label={etiqueta}
        aria-describedby={id}
        aria-expanded={abierta}
        onClick={() => setAbierta(true)}
        onFocus={() => setAbierta(true)}
        onBlur={() => setAbierta(false)}
        className="grid size-8 place-items-center rounded-full text-tenue transition-colors hover:bg-hundido hover:text-tinta"
      >
        <Info className="size-4" aria-hidden />
      </button>
      <span
        role="tooltip"
        id={id}
        hidden={!abierta}
        className={`absolute top-full z-30 mt-1 w-64 max-w-[calc(100vw-3rem)] rounded-xl border border-borde bg-superficie p-3 text-left text-xs font-normal leading-relaxed text-tinta-2 shadow-lg ${lado === 'derecha' ? 'right-0' : 'left-0'}`}
      >
        {children}
      </span>
    </span>
  )
}

/** Sección secundaria plegable (detalles técnicos, listas largas). */
export function Desplegable({ titulo, resumen, children, abierto = false, icono: Icono }: { titulo: string; resumen?: ReactNode; children: ReactNode; abierto?: boolean; icono?: LucideIcon }) {
  return (
    <details open={abierto} className="group sombra rounded-2xl border border-borde bg-superficie">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        {Icono && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-hundido text-tinta-2">
            <Icono className="size-4" aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-tight">{titulo}</span>
          {resumen && <span className="mt-0.5 block text-xs text-tenue">{resumen}</span>}
        </span>
        <ChevronDown className="size-5 shrink-0 text-tenue transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-rejilla px-4 pb-4 pt-3 sm:px-5 sm:pb-5">{children}</div>
    </details>
  )
}

export interface OpcionesConfirmacion {
  titulo: string
  mensaje: ReactNode
  confirmar: string
  peligro?: boolean
}

/**
 * Diálogo modal de confirmación para acciones que modifican datos.
 * `confirmar(opciones)` devuelve una promesa que resuelve true/false; Esc o "Cancelar" equivalen a false.
 */
export function useConfirmacion(): [ReactNode, (o: OpcionesConfirmacion) => Promise<boolean>] {
  const [opciones, setOpciones] = useState<OpcionesConfirmacion | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const dialogo = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = dialogo.current
    if (opciones && d && !d.open) d.showModal()
  }, [opciones])

  const cerrar = useCallback((valor: boolean) => {
    resolver.current?.(valor)
    resolver.current = null
    dialogo.current?.close()
    setOpciones(null)
  }, [])

  const confirmar = useCallback((o: OpcionesConfirmacion) => {
    resolver.current?.(false)
    setOpciones(o)
    return new Promise<boolean>((r) => (resolver.current = r))
  }, [])

  const elemento = opciones ? (
    <dialog
      ref={dialogo}
      onCancel={(e) => {
        e.preventDefault()
        cerrar(false)
      }}
      onClick={(e) => e.target === e.currentTarget && cerrar(false)}
      aria-labelledby="confirmacion-titulo"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-borde bg-superficie p-0 text-tinta shadow-2xl backdrop:bg-black/45"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="confirmacion-titulo" className="text-lg font-semibold leading-snug">
            {opciones.titulo}
          </h2>
          <button type="button" onClick={() => cerrar(false)} className="-mr-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-lg text-tenue hover:bg-hundido" aria-label="Cerrar">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="mt-2 text-sm leading-relaxed text-tinta-2">{opciones.mensaje}</div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => cerrar(false)} className="h-11 rounded-xl border border-borde px-4 text-sm font-medium hover:bg-hundido">
            Cancelar
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => cerrar(true)}
            className={`h-11 rounded-xl px-4 text-sm font-semibold ${opciones.peligro ? 'bg-critico text-white hover:brightness-110' : 'bg-marca text-sobre hover:bg-marca-fuerte'}`}
          >
            {opciones.confirmar}
          </button>
        </div>
      </div>
    </dialog>
  ) : null

  return [elemento, confirmar]
}

/** Control segmentado accesible (radiogroup) con objetivos táctiles de 36 px. */
export function Segmentado<T extends string | number>({ opciones, valor, onCambio, etiqueta }: { opciones: { etiqueta: string; valor: T }[]; valor: T; onCambio: (v: T) => void; etiqueta: string }) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="inline-flex max-w-full overflow-x-auto rounded-xl border border-borde bg-hundido p-0.5">
      {opciones.map((o) => (
        <button
          key={String(o.valor)}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={`h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs ${valor === o.valor ? 'bg-superficie font-semibold text-tinta shadow-sm' : 'text-tinta-2'}`}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

/** Aviso de permisos: explica por qué un control está deshabilitado para este usuario. */
export function AvisoPermiso({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-hundido px-3 py-2 text-xs text-tinta-2">{children}</p>
}
