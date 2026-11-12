// Selector del tema: claro, oscuro o automático. Dos presentaciones con la misma lógica (utilidades/tema.ts).
import { useEffect, useId, useRef, useState } from 'react'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { cambiarTema, useTema, type Tema } from '../utilidades/tema'

const OPCIONES: { valor: Tema; etiqueta: string; icono: LucideIcon; ayuda: string }[] = [
  { valor: 'claro', etiqueta: 'Claro', icono: Sun, ayuda: 'Fondo claro siempre' },
  { valor: 'oscuro', etiqueta: 'Oscuro', icono: Moon, ayuda: 'Fondo oscuro siempre' },
  { valor: 'auto', etiqueta: 'Auto', icono: Monitor, ayuda: 'Igual que su celular o computador' },
]

/** Control segmentado con las tres opciones (barra lateral y pantalla de inicio de sesión). */
export function SelectorTema({ className = '' }: { className?: string }) {
  const { tema } = useTema()
  return (
    <div role="radiogroup" aria-label="Tema de la pantalla" className={`grid grid-cols-3 rounded-xl border border-borde bg-hundido p-0.5 ${className}`}>
      {OPCIONES.map(({ valor, etiqueta, icono: Icono, ayuda }) => (
        <button
          key={valor}
          type="button"
          role="radio"
          aria-checked={tema === valor}
          title={ayuda}
          onClick={() => cambiarTema(valor)}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs ${tema === valor ? 'bg-superficie font-semibold text-tinta shadow-sm' : 'text-tinta-2 hover:text-tinta'}`}
        >
          <Icono className="size-4 shrink-0" aria-hidden />
          {etiqueta}
        </button>
      ))}
    </div>
  )
}

/** Botón de la barra superior (móvil y tableta) que abre un menú con las tres opciones. */
export function BotonTema() {
  const { tema, efectivo } = useTema()
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)
  const id = useId()
  const Icono = tema === 'auto' ? Monitor : efectivo === 'oscuro' ? Moon : Sun

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => !contenedor.current?.contains(e.target as Node) && setAbierto(false)
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}
        aria-controls={id}
        aria-label={`Tema: ${OPCIONES.find((o) => o.valor === tema)!.etiqueta}. Cambiar tema`}
        className="grid size-10 place-items-center rounded-lg border border-borde text-tinta-2 hover:bg-hundido"
      >
        <Icono className="size-4" aria-hidden />
      </button>
      {abierto && (
        <div id={id} className="absolute right-0 top-12 z-40 w-56 rounded-xl border border-borde bg-superficie p-1.5 shadow-xl">
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-tenue">Tema de la pantalla</p>
          <div role="radiogroup" aria-label="Tema de la pantalla">
            {OPCIONES.map(({ valor, etiqueta, icono: Op, ayuda }) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={tema === valor}
                onClick={() => {
                  cambiarTema(valor)
                  setAbierto(false)
                }}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm ${tema === valor ? 'bg-marca-suave font-semibold' : 'hover:bg-hundido'}`}
              >
                <Op className={`size-4 shrink-0 ${tema === valor ? 'text-marca' : 'text-tenue'}`} aria-hidden />
                <span className="min-w-0">
                  <span className="block leading-tight">{etiqueta === 'Auto' ? 'Automático' : etiqueta}</span>
                  <span className="block text-xs font-normal text-tenue">{ayuda}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
