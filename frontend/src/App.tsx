import type { ReactNode } from 'react'
import { CircuitBoard, FlaskConical, RefreshCw, ServerCrash } from 'lucide-react'
import { MODO, api, useEstadoApi, useVistaPanel } from './datos/fuente'
import { PaginaAlertas } from './componentes/Alertas'
import { BannerDemo, BannerReal, Encabezado } from './componentes/Encabezado'
import { PaginaEquipo } from './componentes/Equipo'
import { PaginaFinca } from './componentes/Finca'
import { GraficaHumedad } from './componentes/Graficas'
import { ActividadEquipo, PaginaHistorial } from './componentes/Historial'
import { AlertasPrioritarias, EncabezadoFinca, EstadoGeneral, PiezasClave } from './componentes/Inicio'
import { PanelEscenarios } from './componentes/Listas'
import { Login } from './componentes/Login'
import { BarraInferior, BarraLateral, infoSeccion, Pestanas, useSeccion, type Seccion } from './componentes/Navegacion'
import { TarjetaRiego } from './componentes/PanelControl'
import { TarjetaHumedad } from './componentes/TarjetaHumedad'
import type { VistaPanel } from './tipos/contrato'

/** Celda del panel: `order` fija la secuencia en móvil y tableta; en escritorio manda la columna. */
function Celda({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`min-w-0 ${className}`}>{children}</div>
}

/**
 * Inicio, en orden de importancia: dónde estoy → ¿va todo bien? → cada parte → humedad → riego → alertas → evolución.
 * Escritorio: contenido + columna de riego. Móvil y tableta: una columna en ese mismo orden.
 */
function PaginaInicio({ vista }: { vista: VistaPanel }) {
  return (
    <div className="space-y-4">
      <EncabezadoFinca vista={vista} />
      <EstadoGeneral vista={vista} />
      <PiezasClave vista={vista} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="contents xl:block xl:min-w-0 xl:space-y-4">
          <Celda className="order-1">
            <TarjetaHumedad vista={vista} />
          </Celda>
          <Celda className="order-4">
            <GraficaHumedad vista={vista} />
          </Celda>
          {MODO === 'demo' && (
            <Celda className="order-5">
              <PanelEscenarios vista={vista} />
            </Celda>
          )}
        </div>
        <div className="contents xl:block xl:min-w-0 xl:space-y-4">
          <Celda className="order-2">
            <TarjetaRiego vista={vista} />
          </Celda>
          <Celda className="order-3 empty:hidden">
            <AlertasPrioritarias vista={vista} />
          </Celda>
        </div>
      </div>
    </div>
  )
}

function AlertasDemo({ vista }: { vista: VistaPanel }) {
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl bg-hundido px-3 py-2.5 text-sm text-tinta-2">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-demo" aria-hidden />
        En la demostración no hay servidor que genere alertas. Abajo se ven los avisos que produce el equipo simulado; en el modo REAL esta pantalla explica cada alerta y cómo resolverla.
      </p>
      <ActividadEquipo vista={vista} titulo="Avisos del equipo simulado" />
    </div>
  )
}

function Contenido({ seccion, vista }: { seccion: Seccion; vista: VistaPanel }) {
  switch (seccion) {
    case 'historial':
      return <PaginaHistorial vista={vista} />
    case 'alertas':
      return MODO === 'real' ? <PaginaAlertas vista={vista} /> : <AlertasDemo vista={vista} />
    case 'dispositivo':
      return <PaginaEquipo vista={vista} />
    case 'finca':
      return <PaginaFinca vista={vista} />
    default:
      return <PaginaInicio vista={vista} />
  }
}

/** Título de sección dentro de la página para móvil y tableta (en escritorio lo muestra el encabezado). */
function TituloSeccion({ seccion }: { seccion: Seccion }) {
  if (seccion === 'panel') return null
  const info = infoSeccion(seccion)
  return (
    <div className="lg:hidden">
      <h2 className="text-2xl font-semibold tracking-tight">{info.titulo}</h2>
      <p className="text-sm text-tinta-2">{info.descripcion}</p>
    </div>
  )
}

function Pie() {
  return (
    <footer className="pb-2 pt-4 text-center text-xs text-tenue">
      AgroControl IoT · Contrato API IoT 1.0.2 · {MODO === 'demo' ? 'Datos simulados (DEMO)' : 'Datos del servidor'}
    </footer>
  )
}

/** Armazón común: barra lateral (≥ 1024 px), pestañas (768–1023 px) o barra inferior (< 768 px). */
function Armazon({ seccion, vista, usuario, children }: { seccion: Seccion; vista?: VistaPanel; usuario?: string; children: ReactNode }) {
  const alertas = vista?.alertas?.filter((a) => a.estado === 'ACTIVA').length ?? 0
  return (
    <div className="min-h-dvh lg:pl-64">
      <button
        onClick={() => document.getElementById('contenido')?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-marca focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-sobre"
      >
        Saltar al contenido
      </button>
      <BarraLateral actual={seccion} alertas={alertas} vista={vista} usuario={usuario} />
      <Encabezado vista={vista} usuario={usuario} seccion={seccion} />
      <Pestanas actual={seccion} alertas={alertas} />
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-[1400px] space-y-4 px-4 pb-28 pt-4 outline-none sm:px-6 sm:pt-6 md:pb-8">
        {children}
        <Pie />
      </main>
      <BarraInferior actual={seccion} alertas={alertas} />
    </div>
  )
}

function Marco({ vista, aviso, seccion, usuario }: { vista: VistaPanel; aviso: ReactNode; seccion: Seccion; usuario?: string }) {
  return (
    <Armazon seccion={seccion} vista={vista} usuario={usuario}>
      {aviso}
      <TituloSeccion seccion={seccion} />
      <Contenido seccion={seccion} vista={vista} />
    </Armazon>
  )
}

/** Esqueleto mientras llegan los primeros datos: misma silueta que el panel, sin valores inventados. */
function Cargando() {
  const bloque = 'animate-pulse rounded-2xl border border-borde bg-superficie'
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <p className="sr-only">Cargando datos del backend…</p>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${bloque} h-16`} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className={`${bloque} h-80`} />
        <div className={`${bloque} h-80`} />
        <div className={`${bloque} h-72 md:col-span-2 xl:col-span-1`} />
      </div>
    </div>
  )
}

function EstadoVacio({ icono: Icono, titulo, children, accion }: { icono: typeof ServerCrash; titulo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-borde bg-superficie p-6 text-center sm:p-8">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-hundido text-tenue">
        <Icono className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{titulo}</h2>
      <div className="mt-2 space-y-2 text-sm text-tinta-2">{children}</div>
      {accion && <div className="mt-5">{accion}</div>}
    </section>
  )
}

function BotonReintentar() {
  return (
    <button
      onClick={() => void api?.recargar()}
      className="inline-flex h-11 items-center gap-2 rounded-xl bg-marca px-5 text-sm font-semibold text-sobre hover:bg-marca-fuerte"
    >
      <RefreshCw className="size-4" aria-hidden /> Reintentar ahora
    </button>
  )
}

function AppDemo() {
  const vista = useVistaPanel()
  const [seccion] = useSeccion()
  return <Marco vista={vista} aviso={<BannerDemo />} seccion={seccion} />
}

function AppReal() {
  const { sesion, vista, error, sinDispositivo } = useEstadoApi()
  const [seccion] = useSeccion()
  if (sesion.tipo !== 'autenticado') return <Login verificando={sesion.tipo === 'verificando'} error={sesion.tipo === 'anonimo' ? sesion.error : undefined} />
  if (!vista)
    return (
      <Armazon seccion={seccion} usuario={sesion.usuario.nombre}>
        {sinDispositivo ? (
          <EstadoVacio icono={CircuitBoard} titulo="Sin dispositivos registrados">
            <p>Ninguno de sus terrenos tiene un ESP32 registrado todavía.</p>
            <p className="text-xs text-tenue">Ejecute el seed del backend (npm run db:seed) o registre un dispositivo para su terreno.</p>
          </EstadoVacio>
        ) : error ? (
          <EstadoVacio icono={ServerCrash} titulo="No se pudieron cargar los datos" accion={<BotonReintentar />}>
            <p>{error}</p>
            <p className="text-xs text-tenue">Se reintenta automáticamente. No se muestra ningún dato hasta recibirlo del backend.</p>
          </EstadoVacio>
        ) : (
          <Cargando />
        )}
      </Armazon>
    )
  return <Marco vista={vista} aviso={<BannerReal vista={vista} error={error} />} seccion={seccion} usuario={sesion.usuario.nombre} />
}

export default function App() {
  return MODO === 'demo' ? <AppDemo /> : <AppReal />
}
