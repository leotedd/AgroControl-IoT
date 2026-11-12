import { useEffect, useState } from 'react'
import { Bell, Cpu, Droplets, FlaskConical, History, House, LogOut, PlugZap, Sprout, type LucideIcon } from 'lucide-react'
import type { VistaPanel } from '../tipos/contrato'
import { evaluarComunicacion, type TonoEstado } from '../utilidades/comunicacion'
import { api, MODO } from '../datos/fuente'
import { SelectorTema } from './SelectorTema'

export type Seccion = 'panel' | 'historial' | 'alertas' | 'dispositivo' | 'finca'

const SECCIONES: { id: Seccion; titulo: string; descripcion: string; icono: LucideIcon; soloReal?: boolean }[] = [
  // Los id se conservan (rutas #/panel, #/dispositivo) para no romper enlaces guardados.
  { id: 'panel', titulo: 'Inicio', descripcion: 'Estado de la finca y riego', icono: House },
  { id: 'historial', titulo: 'Historial', descripcion: 'Humedad, riegos y actividad', icono: History },
  { id: 'alertas', titulo: 'Alertas', descripcion: 'Qué pasó y cómo actuar', icono: Bell },
  { id: 'dispositivo', titulo: 'Equipo', descripcion: 'Equipo de campo, calibración y diagnóstico', icono: Cpu },
  { id: 'finca', titulo: 'Finca', descripcion: 'Terrenos y equipos', icono: Sprout, soloReal: true },
]

export const seccionesVisibles = () => SECCIONES.filter((s) => !s.soloReal || MODO === 'real')
export const infoSeccion = (id: Seccion) => SECCIONES.find((s) => s.id === id)!

const leer = (): Seccion => {
  const h = window.location.hash.replace(/^#\/?/, '') as Seccion
  return seccionesVisibles().some((s) => s.id === h) ? h : 'panel'
}

/** Navegación por hash (#/historial…): sin dependencias, funciona con atrás/adelante del navegador. */
export function useSeccion(): [Seccion, (s: Seccion) => void] {
  const [s, setS] = useState<Seccion>(leer)
  useEffect(() => {
    const f = () => {
      setS(leer())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return [s, (n) => (window.location.hash = `/${n}`)]
}

function Contador({ n, className = '' }: { n: number; className?: string }) {
  if (n <= 0) return null
  return (
    <span className={`tabular grid h-5 min-w-5 place-items-center rounded-full bg-critico px-1.5 text-[11px] font-bold leading-none text-white ${className}`} aria-label={`${n} alertas activas`}>
      {n > 99 ? '99+' : n}
    </span>
  )
}

export function Logo({ className = 'size-9' }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl bg-marca text-sobre shadow-sm ${className}`}>
      <Droplets className="size-5" aria-hidden />
    </span>
  )
}

export function InsigniaModo({ compacta = false }: { compacta?: boolean }) {
  const demo = MODO === 'demo'
  const Icono = demo ? FlaskConical : PlugZap
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold tracking-wide text-sobre ${demo ? 'bg-demo' : 'bg-marca'}`}
      title={demo ? 'Datos simulados en el navegador' : 'Datos obtenidos del servidor'}
    >
      <Icono className="size-3.5" aria-hidden />
      {compacta ? (demo ? 'DEMO' : 'REAL') : demo ? 'MODO DEMO' : 'MODO REAL'}
    </span>
  )
}

const PUNTO_CONEXION: Record<TonoEstado, string> = { ok: 'bg-ok', aviso: 'bg-aviso', critico: 'bg-critico', neutro: 'bg-eje' }

/** Navegación lateral fija (escritorio, ≥ 1024 px). */
export function BarraLateral({ actual, alertas, vista, usuario }: { actual: Seccion; alertas: number; vista?: VistaPanel; usuario?: string }) {
  const esp = vista ? evaluarComunicacion(vista, MODO === 'demo').find((i) => i.clave === 'esp32') : undefined
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-borde bg-superficie lg:flex" aria-label="Navegación principal">
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <Logo />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight">AgroControl IoT</p>
          <p className="truncate text-xs text-tenue">Monitoreo y control de riego</p>
        </div>
      </div>
      <div className="px-5 pb-4">
        <InsigniaModo />
      </div>
      <nav aria-label="Secciones" className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-1">
          {seccionesVisibles().map(({ id, titulo, icono: Icono }) => {
            const activo = actual === id
            return (
              <li key={id}>
                <a
                  href={`#/${id}`}
                  aria-current={activo ? 'page' : undefined}
                  className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-serie ${
                    activo ? 'bg-marca-suave font-semibold text-tinta' : 'text-tinta-2 hover:bg-hundido'
                  }`}
                >
                  <Icono className={`size-5 shrink-0 ${activo ? 'text-marca' : 'text-tenue'}`} aria-hidden />
                  <span className="flex-1">{titulo}</span>
                  {id === 'alertas' && <Contador n={alertas} />}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="space-y-3 border-t border-borde p-4">
        {vista && (
          <div className="rounded-xl bg-hundido p-3">
            <p className="truncate text-sm font-medium">{vista.dispositivo.nombre}</p>
            <p className="tabular truncate text-xs text-tenue">{vista.dispositivo.uid}</p>
            {esp && (
              <p className="mt-2 flex items-center gap-2 text-xs text-tinta-2">
                <span className={`size-2 shrink-0 rounded-full ${PUNTO_CONEXION[esp.tono]}`} aria-hidden />
                ESP32: {esp.texto}
              </p>
            )}
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs font-medium text-tenue">Tema</p>
          <SelectorTema />
        </div>
        {usuario && (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm text-tinta-2" title={usuario}>
              {usuario}
            </p>
            <BotonSalir usuario={usuario} />
          </div>
        )}
      </div>
    </aside>
  )
}

export function BotonSalir({ usuario, soloIcono = false }: { usuario: string; soloIcono?: boolean }) {
  return (
    <button
      onClick={() => void api?.cerrarSesion()}
      className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-borde px-3 text-sm text-tinta-2 hover:bg-hundido focus-visible:outline-2 focus-visible:outline-serie"
      title={`Cerrar sesión de ${usuario}`}
      aria-label={`Cerrar sesión de ${usuario}`}
    >
      <LogOut className="size-4" aria-hidden />
      {!soloIcono && <span>Salir</span>}
    </button>
  )
}

/** Pestañas horizontales (tableta, 768–1023 px). */
export function Pestanas({ actual, alertas }: { actual: Seccion; alertas: number }) {
  return (
    <nav aria-label="Secciones" className="hidden border-b border-borde bg-superficie md:block lg:hidden">
      <ul className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-6 py-2">
        {seccionesVisibles().map(({ id, titulo, icono: Icono }) => {
          const activo = actual === id
          return (
            <li key={id}>
              <a
                href={`#/${id}`}
                aria-current={activo ? 'page' : undefined}
                className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm ${activo ? 'bg-marca-suave font-semibold text-tinta' : 'text-tinta-2 hover:bg-hundido'}`}
              >
                <Icono className={`size-4 ${activo ? 'text-marca' : 'text-tenue'}`} aria-hidden />
                {titulo}
                {id === 'alertas' && <Contador n={alertas} />}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Barra inferior fija (móvil, < 768 px), con margen para el área segura del sistema. */
export function BarraInferior({ actual, alertas }: { actual: Seccion; alertas: number }) {
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-borde bg-superficie/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {seccionesVisibles().map(({ id, titulo, icono: Icono }) => {
          const activo = actual === id
          return (
            <li key={id} className="flex-1">
              <a
                href={`#/${id}`}
                aria-current={activo ? 'page' : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] min-[390px]:text-xs ${activo ? 'font-semibold text-marca' : 'text-tenue'}`}
              >
                {activo && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-marca" aria-hidden />}
                <span className="relative">
                  <Icono className="size-6" aria-hidden />
                  {id === 'alertas' && <Contador n={alertas} className="absolute -right-3 -top-1.5" />}
                </span>
                {titulo}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const PUNTO: Record<TonoEstado, string> = { ok: 'bg-ok', aviso: 'bg-aviso', critico: 'bg-critico', neutro: 'bg-eje' }
const SIMBOLO: Record<TonoEstado, string> = { ok: '✓', aviso: '!', critico: '✕', neutro: '…' }

/** Cuatro tramos de la comunicación, cada uno con símbolo + texto (nunca sólo color). */
export function BarraComunicacion({ vista }: { vista: VistaPanel }) {
  const ind = evaluarComunicacion(vista, MODO === 'demo')
  return (
    <section aria-label="Estado de la comunicación" className={`grid gap-2 ${ind.length === 4 ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-1 min-[420px]:grid-cols-3'}`}>
      {ind.map((i) => (
        <div key={i.clave} className="flex min-w-0 items-start gap-2 rounded-xl border border-borde bg-superficie px-3 py-2.5" title={i.detalle}>
          <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${PUNTO[i.tono]}`} aria-hidden>
            {SIMBOLO[i.tono]}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-tenue">{i.titulo}</p>
            <p className="text-sm font-medium leading-tight">{i.texto}</p>
            <p className="line-clamp-2 text-xs text-tenue">{i.detalle}</p>
          </div>
        </div>
      ))}
    </section>
  )
}
