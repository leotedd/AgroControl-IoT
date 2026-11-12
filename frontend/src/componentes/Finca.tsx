// Finca (sólo REAL): terrenos visibles y sus equipos, desde GET /terrenos y /terrenos/{id}/dispositivos.
// Cultivos y zonas no tienen todavía endpoints de listado en el backend: se explica en lugar de simularlos.
import { useEffect } from 'react'
import { ArrowRight, Cpu, Layers, MapPin, Sprout, Wheat } from 'lucide-react'
import { api } from '../datos/fuente'
import type { Conexion, VistaPanel } from '../tipos/contrato'
import { NOMBRE_ROL } from '../utilidades/finca'
import { formatoFechaHora } from '../utilidades/formato'
import type { Nivel } from '../utilidades/finca'
import { IconoNivel } from './ui'

const CONEXION: Record<Conexion, { texto: string; nivel: Nivel }> = {
  EN_LINEA: { texto: 'Conectado', nivel: 'ok' },
  INESTABLE: { texto: 'Intermitente', nivel: 'atencion' },
  FUERA_DE_LINEA: { texto: 'Sin conexión', nivel: 'problema' },
}

export function PaginaFinca({ vista }: { vista: VistaPanel }) {
  const f = vista.finca
  useEffect(() => {
    void api?.actualizarFinca()
  }, [])
  const terrenos = f?.terrenos ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta-2">Elija qué equipo quiere ver en Inicio. Sólo aparecen los terrenos a los que tiene acceso.</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {terrenos.map((t) => (
          <section key={t.id} className="sombra rounded-2xl border border-borde bg-superficie p-4 sm:p-5">
            <header className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-marca-suave text-marca">
                <Sprout className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold leading-tight">{t.nombre}</h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-tenue">
                  {t.ubicacion && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" aria-hidden /> {t.ubicacion}
                    </span>
                  )}
                  <span>Su rol: {NOMBRE_ROL[t.rol]}</span>
                </p>
              </div>
            </header>
            {t.dispositivos.length === 0 ? (
              <p className="mt-4 rounded-xl bg-hundido px-3 py-3 text-sm text-tinta-2">Este terreno aún no tiene equipos registrados.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {t.dispositivos.map((d) => {
                  const actual = d.id === f?.dispositivo_id
                  const c = CONEXION[d.conexion] ?? { texto: d.conexion, nivel: 'neutro' as Nivel }
                  return (
                    <li key={d.id} className={`flex items-center gap-3 rounded-xl border p-3 ${actual ? 'border-marca bg-marca-suave' : 'border-borde'}`}>
                      <Cpu className="size-5 shrink-0 text-tinta-2" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{d.nombre}</p>
                        <p className="flex items-center gap-1.5 text-xs text-tenue">
                          <IconoNivel nivel={c.nivel} tamano="sm" />
                          <span>
                            {c.texto}
                            {d.ultima_conexion_en ? ` · ${formatoFechaHora(d.ultima_conexion_en)}` : ' · nunca conectado'}
                          </span>
                        </p>
                      </div>
                      {actual ? (
                        <span className="shrink-0 text-xs font-semibold text-marca">En Inicio</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            void api?.seleccionarDispositivo(d.id)
                            window.location.hash = '/panel'
                          }}
                          className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg border border-borde px-3 text-xs font-semibold hover:bg-hundido"
                        >
                          Ver <ArrowRight className="size-4" aria-hidden />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {f?.zona && t.id === f.terreno_id && (
              <p className="mt-3 flex items-center gap-2 text-xs text-tinta-2">
                <Layers className="size-4 shrink-0 text-tenue" aria-hidden />
                <span>
                  El sensor del equipo actual está en la zona <strong className="font-semibold">{f.zona.nombre}</strong>.
                </span>
              </p>
            )}
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-dashed border-eje bg-superficie p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-hundido text-tenue">
            <Wheat className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Cultivos y zonas: próximamente</h2>
            <p className="mt-1 text-sm text-tinta-2">
              Registrar cultivos, dividir el terreno en zonas y asignar sensores a cada zona necesita funciones del servidor que todavía no están disponibles. Por eso no se muestran
              datos aquí: no se inventa información.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
