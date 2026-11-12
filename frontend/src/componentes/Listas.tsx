import { ClipboardList, FlaskConical, RotateCcw } from 'lucide-react'
import { simulador } from '../datos/fuente'

import type { EscenariosDemo, VistaPanel } from '../tipos/contrato'
import { etiquetaTipo, formatoHora, texto } from '../utilidades/formato'
import { EtiquetaDemo, Tarjeta } from './base'
import { InsigniaOrden } from './PanelControl'

export function ListaOrdenes({ vista }: { vista: VistaPanel }) {
  return (
    <Tarjeta titulo="Órdenes recientes" icono={ClipboardList} accion={<EtiquetaDemo />}>
      {vista.ordenes.length === 0 ? (
        <p className="py-6 text-center text-sm text-tenue">
          Todavía no se han enviado órdenes a la bomba.
        </p>
      ) : (
        <ul className="divide-y divide-rejilla">
          {vista.ordenes.slice(0, 8).map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="tabular text-tenue">#{o.id}</span> {etiquetaTipo(o.tipo)}
                  {o.tipo === 'BOMBA_ENCENDER' && (
                    <span className="tabular text-tinta-2">
                      {' '}
                      {String(o.parametros.duracion_s)} s
                      {o.duracion_aplicada_s && o.duracion_aplicada_s !== o.parametros.duracion_s
                        ? ` → ${o.duracion_aplicada_s} s`
                        : ''}
                    </span>
                  )}
                </p>
                <p className="tabular truncate text-xs text-tenue">
                  {formatoHora(o.creada_en)}
                  {(o.codigo_motivo || o.motivo_cierre) && ` · ${texto(o.codigo_motivo ?? o.motivo_cierre)}`}
                </p>
              </div>
              <InsigniaOrden orden={o} />
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}

const ESCENARIOS: { clave: keyof EscenariosDemo; titulo: string; descripcion: string; invertido?: boolean }[] = [
  { clave: 'conectado', titulo: 'Desconectar ESP32', descripcion: 'Deja de comunicarse; el riego automático local sigue.', invertido: true },
  { clave: 'falla_sensor', titulo: 'Fallo del sensor', descripcion: 'Lectura inválida: apaga y bloquea (crítico).' },
  { clave: 'tanque_vacio', titulo: 'Tanque vacío', descripcion: 'La bomba no sube la humedad: tiempo máximo y bloqueo preventivo.' },
]

export function PanelEscenarios({ vista }: { vista: VistaPanel }) {
  return (
    <Tarjeta titulo="Escenarios de prueba (sólo DEMO)" icono={FlaskConical} className="franja-demo">
      <p className="mb-3 text-xs text-tinta-2">
        Provoque situaciones para ver cómo responden la web y las reglas de seguridad del contrato.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {ESCENARIOS.map(({ clave, titulo, descripcion, invertido }) => {
          const activo = invertido ? !vista.escenarios[clave] : vista.escenarios[clave]
          return (
            <label
              key={clave}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${activo ? 'border-demo bg-demo-suave' : 'border-borde bg-superficie'}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-[var(--demo)]"
                checked={activo}
                onChange={() => simulador?.cambiarEscenario({ [clave]: !vista.escenarios[clave] })}
              />
              <span>
                <span className="block text-sm font-medium">{titulo}</span>
                <span className="block text-xs text-tenue">{descripcion}</span>
              </span>
            </label>
          )
        })}
      </div>
      <button
        onClick={() => simulador?.reiniciar()}
        className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg border border-borde bg-superficie px-3 text-xs font-medium hover:bg-hundido"
      >
        <RotateCcw className="size-3.5" aria-hidden /> Reiniciar simulación
      </button>
    </Tarjeta>
  )
}
