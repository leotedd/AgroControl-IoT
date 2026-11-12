// Inicio: lo que necesita saber quien maneja la finca, en orden de importancia.
import { useState } from 'react'
import { ArrowRight, Bell, ChevronDown, Cpu, Droplets, MapPin, Power, Server, Sprout } from 'lucide-react'
import { MODO } from '../datos/fuente'
import type { VistaPanel } from '../tipos/contrato'
import { guiaAlerta, ordenarAlertas, SEVERIDAD } from '../utilidades/alertas'
import { NOMBRE_ROL, permisos, piezas, resumenGeneral, type ClavePieza, type Pieza } from '../utilidades/finca'
import { formatoHora, haceTiempo } from '../utilidades/formato'
import { EtiquetaDemo } from './base'
import { ESTILO_NIVEL, IconoNivel } from './ui'

const ICONO_PIEZA: Record<ClavePieza, typeof Server> = { servidor: Server, equipo: Cpu, sensor: Droplets, bomba: Power }
/** Sección donde se resuelve cada pieza. */
const DESTINO: Record<ClavePieza, { href: string; texto: string } | null> = {
  servidor: null,
  equipo: { href: '#/dispositivo', texto: 'Ver equipo' },
  sensor: { href: '#/dispositivo', texto: 'Ir a calibración' },
  bomba: { href: '#riego', texto: 'Ir al riego' },
}

const esDemo = MODO === 'demo'

/** Nombre del terreno, ubicación, zona y equipo que se está viendo. */
export function EncabezadoFinca({ vista }: { vista: VistaPanel }) {
  const f = vista.finca
  const terreno = f?.terrenos.find((t) => t.id === f.terreno_id)
  const rol = permisos(vista, esDemo).rol
  const detalles = [terreno?.ubicacion, f?.zona ? `Zona ${f.zona.nombre}` : null, vista.dispositivo.nombre].filter(Boolean)
  return (
    <section className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-marca">
          <Sprout className="size-4" aria-hidden /> {esDemo ? 'Finca de demostración' : 'Su finca'}
        </p>
        <h2 className="mt-1 text-2xl font-semibold leading-tight tracking-tight sm:text-[1.75rem]">{terreno?.nombre ?? (esDemo ? 'Parcela de ejemplo' : 'Terreno')}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-tinta-2">
          {detalles.length > 0 && <MapPin className="size-4 shrink-0 text-tenue" aria-hidden />}
          {detalles.join(' · ')}
        </p>
      </div>
      <p className="tabular text-xs text-tenue">
        {!esDemo && <>Su rol: {NOMBRE_ROL[rol]} · </>}Actualizado {formatoHora(vista.ahora)}
      </p>
    </section>
  )
}

/** Veredicto general y, si hace falta, los puntos a revisar con qué hacer. */
export function EstadoGeneral({ vista }: { vista: VistaPanel }) {
  const r = resumenGeneral(vista, esDemo)
  const estilo = ESTILO_NIVEL[r.nivel]
  const abiertas = (vista.alertas ?? []).filter((a) => a.estado !== 'RESUELTA').length
  return (
    <section aria-labelledby="estado-general" className={`sombra overflow-hidden rounded-2xl border bg-superficie ${estilo.borde}`}>
      <div className={`flex items-start gap-3 p-4 sm:gap-4 sm:p-5 ${estilo.fondo}`}>
        <IconoNivel nivel={r.nivel} tamano="lg" />
        <div className="min-w-0 flex-1">
          <h2 id="estado-general" className="text-lg font-semibold leading-snug sm:text-xl">
            {r.titulo}
          </h2>
          <p className="mt-0.5 text-sm text-tinta-2">{r.frase}</p>
        </div>
        <EtiquetaDemo />
      </div>
      {(r.prioridades.length > 0 || abiertas > 0) && (
        <ul className="divide-y divide-rejilla">
          {r.prioridades.map((p) => (
            <li key={p.clave} className="flex gap-3 px-4 py-3 sm:px-5">
              <IconoNivel nivel={p.nivel} tamano="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {p.titulo}: {p.estado}
                </p>
                <p className="mt-0.5 text-sm text-tinta-2">{p.queHacer ?? p.explicacion}</p>
              </div>
              {DESTINO[p.clave] && (
                <a
                  href={DESTINO[p.clave]!.href}
                  onClick={(e) => {
                    // Anclas dentro de la página: desplazar sin cambiar la ruta (#/seccion).
                    if (!DESTINO[p.clave]!.href.startsWith('#/')) {
                      e.preventDefault()
                      document.getElementById(DESTINO[p.clave]!.href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  }}
                  className="inline-flex h-9 shrink-0 items-center gap-1 self-center rounded-lg px-2 text-xs font-semibold text-marca hover:bg-marca-suave">
                  <span className="hidden min-[430px]:inline">{DESTINO[p.clave]!.texto}</span>
                  <ArrowRight className="size-4" aria-label={DESTINO[p.clave]!.texto} />
                </a>
              )}
            </li>
          ))}
          {abiertas > 0 && (
            <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-critico/10" aria-hidden>
                <Bell className="size-4 text-critico" />
              </span>
              <p className="min-w-0 flex-1 text-sm font-semibold">
                {abiertas === 1 ? '1 alerta abierta' : `${abiertas} alertas abiertas`}
              </p>
              <a href="#/alertas" className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-marca hover:bg-marca-suave">
                Ver alertas <ArrowRight className="size-4" aria-hidden />
              </a>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function TarjetaPieza({ p, ahora }: { p: Pieza; ahora: number }) {
  const [abierta, setAbierta] = useState(false)
  const Icono = ICONO_PIEZA[p.clave]
  const estilo = ESTILO_NIVEL[p.nivel]
  const EstadoIcono = estilo.icono
  const edad = p.actualizado ? Math.max(0, Math.round((ahora - p.actualizado) / 1000)) : null
  return (
    <div className="sombra flex min-w-0 flex-col rounded-2xl border border-borde bg-superficie">
      <button
        type="button"
        onClick={() => setAbierta(!abierta)}
        aria-expanded={abierta}
        className="flex min-h-[5.5rem] w-full flex-1 flex-col items-start gap-2 rounded-2xl p-3 text-left sm:p-4"
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-hundido text-tinta-2">
            <Icono className="size-4" aria-hidden />
          </span>
          <ChevronDown className={`size-4 text-tenue transition-transform ${abierta ? 'rotate-180' : ''}`} aria-hidden />
        </span>
        <span className="text-xs text-tenue">{p.titulo}</span>
        <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight">
          <EstadoIcono className={`size-4 shrink-0 ${estilo.color}`} aria-hidden />
          {p.estado}
        </span>
        <span className="tabular text-[11px] text-tenue">{edad === null ? 'Sin datos aún' : `Dato ${haceTiempo(edad)}`}</span>
      </button>
      {abierta && (
        <div className="space-y-2 border-t border-rejilla px-3 pb-3 pt-2.5 text-sm leading-relaxed sm:px-4">
          <p className="text-tinta-2">{p.explicacion}</p>
          {p.queHacer && (
            <p>
              <strong className="font-semibold">Qué hacer: </strong>
              <span className="text-tinta-2">{p.queHacer}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Servidor, equipo, sensor y bomba: cuatro estados distintos, nunca mezclados. */
export function PiezasClave({ vista }: { vista: VistaPanel }) {
  return (
    <section aria-label="Estado de cada parte del sistema" className="grid grid-cols-2 items-start gap-3 lg:grid-cols-4">
      {piezas(vista, esDemo).map((p) => (
        <TarjetaPieza key={p.clave} p={p} ahora={vista.ahora} />
      ))}
    </section>
  )
}

/** Hasta tres alertas abiertas, con su explicación corta y enlace a la guía completa. */
export function AlertasPrioritarias({ vista }: { vista: VistaPanel }) {
  const abiertas = ordenarAlertas((vista.alertas ?? []).filter((a) => a.estado !== 'RESUELTA')).slice(0, 3)
  if (!abiertas.length) return null
  return (
    <section aria-labelledby="alertas-prioritarias" className="sombra rounded-2xl border border-borde bg-superficie p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="alertas-prioritarias" className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-critico/10 text-critico">
            <Bell className="size-4" aria-hidden />
          </span>
          Alertas que requieren atención
        </h2>
        <a href="#/alertas" className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-marca hover:bg-marca-suave">
          Todas <ArrowRight className="size-4" aria-hidden />
        </a>
      </div>
      <ul className="space-y-2">
        {abiertas.map((a) => {
          const g = guiaAlerta(a)
          const nivel = a.severidad === 'CRITICA' ? 'problema' : a.severidad === 'ADVERTENCIA' ? 'atencion' : 'neutro'
          return (
            <li key={a.id}>
              <a href={`#/alertas`} className="flex items-start gap-3 rounded-xl border border-borde p-3 hover:bg-hundido">
                <IconoNivel nivel={nivel} tamano="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug">{g.titulo}</span>
                  <span className="mt-0.5 block text-xs text-tenue">
                    {SEVERIDAD[a.severidad].etiqueta} · {formatoHora(a.creada_en)}
                  </span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
