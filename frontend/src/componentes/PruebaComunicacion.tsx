import { useState } from 'react'
import { Activity } from 'lucide-react'
import { fuente } from '../datos/fuente'
import type { Orden, VistaPanel } from '../tipos/contrato'
import { evaluarDiagnostico, motivoSinDiagnostico, PREFIJO_DIAGNOSTICO, TTL_DIAGNOSTICO_S } from '../utilidades/diagnostico'
import { texto } from '../utilidades/formato'
import { Insignia, Tarjeta } from './base'

const FINALES: Orden['estado'][] = ['EJECUTADA', 'RECHAZADA', 'FALLIDA', 'EXPIRADA', 'CANCELADA', 'SIN_CONFIRMAR']

/**
 * Sólo MODO REAL. Envía un BOMBA_APAGAR con la bomba ya apagada (inocuo) y sigue esa orden
 * hasta la confirmación real del ESP32. No hay confirmación simulada: el resultado sale del backend.
 */
export function PruebaComunicacion({ vista }: { vista: VistaPanel }) {
  const [orden, setOrden] = useState<Orden | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // La versión más reciente de la orden llega con cada refresco del panel (cada 3 s).
  const actual = orden ? (vista.ordenes.find((o) => o.id === orden.id) ?? orden) : null
  const enCurso = !!actual && !FINALES.includes(actual.estado)
  const motivo = motivoSinDiagnostico(vista)
  const r = actual ? evaluarDiagnostico(actual) : null

  const probar = async () => {
    if (enviando || enCurso || motivo) return
    setEnviando(true)
    setError(null)
    try {
      const res = await fuente.enviarOrden('BOMBA_APAGAR', {}, { ttl_s: TTL_DIAGNOSTICO_S, prefijo_clave: PREFIJO_DIAGNOSTICO })
      if (res.ok && res.orden) setOrden(res.orden)
      else if (!res.ok) setError(`${texto(res.codigo)}: ${res.mensaje}`)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Tarjeta titulo="Probar comunicación con ESP32" icono={Activity}>
      <p className="mb-3 text-xs text-tinta-2">
        Envía una orden de <strong>apagado</strong> con la bomba ya apagada y espera la confirmación real del ESP32. No enciende la bomba
        ni modifica los bloqueos.
      </p>
      <button
        onClick={probar}
        disabled={!!motivo || enviando || enCurso}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-borde px-4 text-sm font-semibold hover:bg-hundido disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Activity className="size-4" aria-hidden /> {enCurso ? 'Esperando confirmación…' : 'Probar comunicación con ESP32'}
      </button>
      {motivo && !enCurso && <p className="mt-2 text-xs text-tenue">No disponible: {motivo}</p>}
      {error && (
        <p className="mt-2 text-xs text-critico" role="alert">
          {error}
        </p>
      )}
      {r && (
        <div className="mt-3 space-y-1 rounded-xl border border-borde p-3" role="status" aria-live="polite">
          <Insignia tono={r.tono}>{r.titulo}</Insignia>
          <p className="text-xs text-tenue">{r.detalle}</p>
          {(r.entrega_ms !== null || r.confirmacion_ms !== null) && (
            <p className="tabular text-xs text-tenue">
              {r.entrega_ms !== null && <>Recogida: {(r.entrega_ms / 1000).toFixed(1)} s</>}
              {r.entrega_ms !== null && r.confirmacion_ms !== null && ' · '}
              {r.confirmacion_ms !== null && <>Confirmación: {(r.confirmacion_ms / 1000).toFixed(1)} s</>}
              {' '}(marcas del servidor)
            </p>
          )}
        </div>
      )}
    </Tarjeta>
  )
}
