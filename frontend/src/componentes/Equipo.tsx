// Equipo de campo: resumen comprensible arriba, diagnóstico técnico en secciones plegables.
import { ClipboardList, Cpu, Radio, Signal, Wrench } from 'lucide-react'
import { MODO } from '../datos/fuente'
import type { VistaPanel } from '../tipos/contrato'
import { piezaEquipo } from '../utilidades/finca'
import { formatoHora, haceTiempo } from '../utilidades/formato'
import { EtiquetaDemo, Tarjeta } from './base'
import { TarjetaCalibracion, TarjetaDiagnostico } from './Integracion'
import { ListaOrdenes } from './Listas'
import { BarraComunicacion } from './Navegacion'
import { PruebaComunicacion } from './PruebaComunicacion'
import { TarjetaDispositivo } from './TarjetasEstado'
import { Desplegable, ESTILO_NIVEL, IconoNivel } from './ui'

/** Calidad de la señal Wi-Fi en palabras (RSSI en dBm). */
export function calidadSenal(rssi: number | null): { texto: string; barras: number } {
  if (rssi === null) return { texto: 'Sin dato', barras: 0 }
  if (rssi >= -60) return { texto: 'Excelente', barras: 4 }
  if (rssi >= -70) return { texto: 'Buena', barras: 3 }
  if (rssi >= -80) return { texto: 'Débil', barras: 2 }
  return { texto: 'Muy débil', barras: 1 }
}

function ResumenEquipo({ vista }: { vista: VistaPanel }) {
  const d = vista.dispositivo
  const p = piezaEquipo(vista, MODO === 'demo')
  const senal = calidadSenal(d.rssi_dbm)
  const datos = [
    { k: 'Último contacto', v: d.ultima_conexion_en ? haceTiempo(d.segundos_desde_conexion) : 'Nunca', n: d.ultima_conexion_en ? formatoHora(d.ultima_conexion_en) : undefined },
    { k: 'Señal Wi-Fi', v: senal.texto, n: d.rssi_dbm !== null ? `${d.rssi_dbm} dBm` : undefined },
    { k: 'Ajustes', v: d.config_version_aplicada === d.config_version_deseada ? 'Al día' : 'Pendientes', n: `versión ${d.config_version_aplicada} de ${d.config_version_deseada}` },
    { k: 'Programa', v: d.version_firmware, n: 'firmware del ESP32' },
  ]
  return (
    <Tarjeta titulo={vista.dispositivo.nombre} icono={Cpu} accion={<EtiquetaDemo />}>
      <div className={`flex items-start gap-3 rounded-xl border p-3 ${ESTILO_NIVEL[p.nivel].borde} ${ESTILO_NIVEL[p.nivel].fondo}`}>
        <IconoNivel nivel={p.nivel} />
        <div className="min-w-0">
          <p className="font-semibold">{p.estado}</p>
          <p className="mt-0.5 text-sm text-tinta-2">{p.explicacion}</p>
          {p.queHacer && (
            <p className="mt-1 text-sm">
              <strong className="font-semibold">Qué hacer: </strong>
              <span className="text-tinta-2">{p.queHacer}</span>
            </p>
          )}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {datos.map(({ k, v, n }) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-tenue">{k}</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
              {k === 'Señal Wi-Fi' && <Signal className={`size-4 shrink-0 ${senal.barras >= 3 ? 'text-ok' : senal.barras === 2 ? 'text-aviso' : 'text-tenue'}`} aria-hidden />}
              <span className="truncate">{v}</span>
            </dd>
            {n && <dd className="tabular truncate text-xs text-tenue">{n}</dd>}
          </div>
        ))}
      </dl>
      <p className="tabular mt-3 text-xs text-tenue">Identificador: {d.uid}</p>
    </Tarjeta>
  )
}

export function PaginaEquipo({ vista }: { vista: VistaPanel }) {
  const real = MODO === 'real'
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <ResumenEquipo vista={vista} />
        {real && <PruebaComunicacion vista={vista} />}
        <Desplegable titulo="Comunicación paso a paso" resumen="Servidor, equipo, lecturas y ajustes" icono={Radio}>
          <BarraComunicacion vista={vista} />
        </Desplegable>
        <Desplegable titulo="Órdenes recientes" resumen={vista.ordenes.length ? `${vista.ordenes.length} registradas` : 'Ninguna todavía'} icono={ClipboardList}>
          <div className="-mx-4 -mb-4 sm:-mx-5 sm:-mb-5 [&>section]:rounded-none [&>section]:border-0 [&>section]:shadow-none">
            <ListaOrdenes vista={vista} />
          </div>
        </Desplegable>
        <Desplegable titulo="Detalles técnicos" resumen="Para el técnico: firmware, TLS, memoria, diagnóstico" icono={Wrench}>
          <div className="-mx-4 -mb-4 space-y-0 sm:-mx-5 sm:-mb-5 [&>section]:rounded-none [&>section]:border-0 [&>section]:shadow-none">
            {real && <TarjetaDiagnostico vista={vista} />}
            <TarjetaDispositivo vista={vista} />
          </div>
        </Desplegable>
      </div>
      <div className="min-w-0 space-y-4">
        {real ? (
          <TarjetaCalibracion vista={vista} />
        ) : (
          <Tarjeta titulo="Calibración del sensor" icono={Wrench} accion={<EtiquetaDemo />}>
            <p className="text-sm text-tinta-2">
              La calibración enseña al sistema qué lectura corresponde a suelo seco y a suelo húmedo. En la demostración el sensor simulado ya viene calibrado; con un equipo real se hace
              aquí, en el modo REAL.
            </p>
          </Tarjeta>
        )}
      </div>
    </div>
  )
}
