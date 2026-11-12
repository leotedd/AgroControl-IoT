import { Clock, FlaskConical, WifiOff } from 'lucide-react'
import { BotonSalir, InsigniaModo, Logo, infoSeccion, type Seccion } from './Navegacion'
import { BotonTema } from './SelectorTema'
import type { VistaPanel } from '../tipos/contrato'
import { formatoHora } from '../utilidades/formato'

export function Encabezado({ vista, usuario, seccion }: { vista?: VistaPanel; usuario?: string; seccion?: Seccion }) {
  const info = seccion ? infoSeccion(seccion) : null
  return (
    <header className="sticky top-0 z-20 border-b border-borde bg-superficie/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className={seccion ? 'lg:hidden' : ''}>
            <Logo />
          </span>
          <div className="min-w-0">
            {/* Móvil y tableta: marca + sección; escritorio (barra lateral visible): título de la sección. */}
            <p className={`truncate text-base font-semibold leading-tight ${seccion ? 'lg:hidden' : ''}`}>AgroControl IoT</p>
            {info && <h1 className="hidden truncate text-lg font-semibold leading-tight lg:block">{info.titulo}</h1>}
            <p className="truncate text-xs text-tenue">
              {info && <span className="lg:hidden">{info.titulo} · </span>}
              {vista ? `${vista.dispositivo.nombre} · ${vista.dispositivo.uid}` : info ? info.descripcion : 'Monitoreo y control de riego'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {vista && (
            <span className="tabular hidden items-center gap-1.5 text-xs text-tenue sm:inline-flex" title="Hora de la última actualización">
              <Clock className="size-3.5" aria-hidden />
              {formatoHora(vista.ahora)}
            </span>
          )}
          <span className={seccion ? 'lg:hidden' : ''}>
            <span className="sm:hidden">
              <InsigniaModo compacta />
            </span>
            <span className="hidden sm:inline">
              <InsigniaModo />
            </span>
          </span>
          {/* Selector de tema en móvil y tableta; en escritorio está en la barra lateral. */}
          <span className={seccion ? 'lg:hidden' : ''}>
            <BotonTema />
          </span>
          {usuario && (
            <span className={seccion ? 'lg:hidden' : ''}>
              <BotonSalir usuario={usuario} soloIcono />
            </span>
          )}
        </div>
      </div>
    </header>
  )
}

/** Franja compacta, en todas las pantallas DEMO: nada de lo que se ve proviene de un equipo real. */
export function BannerDemo() {
  return (
    <div role="note" className="franja-demo flex items-start gap-2 rounded-xl border border-demo/40 bg-demo-suave px-3 py-2 text-sm">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-demo" aria-hidden />
      <p>
        <strong className="font-semibold">Demostración con datos simulados.</strong>{' '}
        <span className="text-tinta-2">Ningún valor viene de un equipo real y los botones no controlan ninguna bomba.</span>
      </p>
    </div>
  )
}

/** REAL: sólo se muestra cuando hay un problema de conexión con el servidor (el resto lo explica Inicio). */
export function BannerReal({ vista }: { vista: VistaPanel; error?: string | null }) {
  const enlace = vista.enlace
  if (!enlace || enlace.ok) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-critico/50 bg-critico/10 px-3 py-2.5 text-sm">
      <WifiOff className="mt-0.5 size-4 shrink-0 text-critico" aria-hidden />
      <div>
        <p>
          <strong className="font-semibold">Sin conexión con el servidor.</strong>{' '}
          <span className="text-tinta-2">
            Datos de {enlace.ultima_actualizacion ? formatoHora(enlace.ultima_actualizacion) : 'antes de la desconexión'}; las acciones están en pausa. Reintentando (intento {enlace.fallos_consecutivos}).
          </span>
        </p>
        <p className="mt-0.5 text-xs text-tinta-2">El equipo de campo sigue aplicando sus reglas de seguridad por su cuenta.</p>
      </div>
    </div>
  )
}
