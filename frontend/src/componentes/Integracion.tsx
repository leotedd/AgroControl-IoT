// Tarjetas exclusivas del MODO REAL para la integración física del ESP32.
import { useState } from 'react'
import { Gauge, Radio } from 'lucide-react'
import { api } from '../datos/fuente'
import type { VistaPanel } from '../tipos/contrato'
import { NOMBRE_ROL, permisos } from '../utilidades/finca'
import { duracion, formatoHora, haceTiempo, texto } from '../utilidades/formato'
import { Dato, Insignia, Tarjeta } from './base'
import { AvisoPermiso, useConfirmacion } from './ui'

const pct = (raw: number, seco: number, humedo: number) => Math.max(0, Math.min(100, (100 * (raw - seco)) / (humedo - seco)))

/** Calibración asistida del sensor capacitivo (contrato §7.4): seco = 0 %, húmedo = 100 %. */
export function TarjetaCalibracion({ vista }: { vista: VistaPanel }) {
  const s = vista.sensor
  const [seco, setSeco] = useState<number>(s.raw_seco ?? 3000)
  const [humedo, setHumedo] = useState<number>(s.raw_humedo ?? 1300)
  const [confirmar, setConfirmar] = useState(false)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const raw = s.valor_raw
  const separacion = Math.abs(seco - humedo)
  const valido = Number.isInteger(seco) && Number.isInteger(humedo) && seco >= 21 && seco <= 4074 && humedo >= 21 && humedo <= 4074 && separacion >= 200
  const actualizado = vista.actuador.reportado.fiable && raw !== null

  const [dialogo, pedirConfirmacion] = useConfirmacion()
  const p = permisos(vista, false)

  const guardar = async (confirmada: boolean) => {
    const seguir = await pedirConfirmacion(
      confirmada
        ? {
            titulo: '¿Guardar la calibración?',
            mensaje: <p>Seco = {seco} y húmedo = {humedo}. Se enviará al equipo como configuración nueva y detendrá cualquier riego en curso.</p>,
            confirmar: 'Guardar y confirmar',
          }
        : { titulo: '¿Quitar la confirmación?', mensaje: <p>Sin calibración confirmada no se podrá usar el modo Manual ni el Automático.</p>, confirmar: 'Quitar confirmación', peligro: true },
    )
    if (!seguir) return
    const r = await api!.calibrar({ raw_seco: seco, raw_humedo: humedo, calibracion_confirmada: confirmada })
    setMensaje(r.ok ? { ok: true, texto: confirmada ? 'Calibración guardada y confirmada. Se enviará al ESP32 como nueva configuración.' : 'Calibración guardada sin confirmar.' } : { ok: false, texto: `${texto(r.codigo)}: ${r.mensaje}` })
    if (r.ok) setConfirmar(false)
  }

  return (
    <Tarjeta titulo={`Calibración del sensor ${s.codigo}`} icono={Gauge} id="calibracion">
      {dialogo}
      {!p.administrar && <div className="mb-3"><AvisoPermiso>Sólo el propietario del terreno puede calibrar. Su rol: {NOMBRE_ROL[p.rol]}.</AvisoPermiso></div>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {s.calibracion_confirmada ? <Insignia tono="ok">Confirmada {s.calibrado_en ? `· ${formatoHora(s.calibrado_en)}` : ''}</Insignia> : <Insignia tono="aviso">Sin confirmar: no se puede habilitar MANUAL ni AUTOMÁTICO</Insignia>}
        <span className="tabular text-xs text-tenue">Guardado: seco {s.raw_seco ?? '—'} · húmedo {s.raw_humedo ?? '—'}</span>
      </div>
      <div className="mb-3 rounded-xl bg-hundido p-3 text-center">
        <p className="text-xs text-tenue">Lectura ADC actual del ESP32</p>
        <p className="tabular text-3xl font-semibold">{raw ?? '—'}</p>
        <p className="text-xs text-tenue">{actualizado ? (valido ? `≈ ${pct(raw!, seco, humedo).toFixed(1)} % con los valores de abajo` : 'Ajuste los valores de abajo') : 'Sin lectura reciente del ESP32'}</p>
      </div>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-xs text-tinta-2">
        <li>Sensor al aire o en suelo seco → "Usar como SECO".</li>
        <li>Sensor en agua o suelo saturado (sin mojar la electrónica) → "Usar como HÚMEDO".</li>
        <li>Revise que la separación sea ≥ 200 y confirme.</li>
      </ol>
      <div className="grid grid-cols-2 gap-3">
        {([['Seco (0 %)', seco, setSeco], ['Húmedo (100 %)', humedo, setHumedo]] as const).map(([etq, valor, fijar]) => (
          <label key={etq} className="text-xs text-tenue">
            {etq}
            <input
              type="number"
              min={21}
              max={4074}
              value={valor}
              onChange={(e) => fijar(Number(e.target.value))}
              className="tabular mt-1 h-11 w-full rounded-lg border border-borde bg-plano px-3 text-base text-tinta sm:text-sm"
            />
            <button
              type="button"
              disabled={!actualizado}
              onClick={() => fijar(raw!)}
              className="mt-1.5 h-10 w-full rounded-lg border border-borde px-2 text-xs text-tinta hover:bg-hundido disabled:opacity-50"
            >
              Usar como {etq.startsWith('Seco') ? 'SECO' : 'HÚMEDO'}
            </button>
          </label>
        ))}
      </div>
      <p className={`mt-2 text-xs ${separacion >= 200 ? 'text-tenue' : 'text-critico'}`}>Separación: {separacion} cuentas (mínimo 200)</p>
      <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs text-tinta-2">
        <input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--marca)]" />
        Confirmo que medí seco y húmedo con este sensor en condiciones reales.
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={!valido || !confirmar || !p.administrar} onClick={() => void guardar(true)} className="h-11 rounded-lg bg-marca px-4 text-sm font-semibold text-sobre disabled:opacity-50">
          Guardar y confirmar
        </button>
        {s.calibracion_confirmada && p.administrar && (
          <button onClick={() => void guardar(false)} className="h-11 rounded-lg border border-borde px-4 text-sm hover:bg-hundido">
            Quitar confirmación
          </button>
        )}
      </div>
      {mensaje && <p className={`mt-2 text-sm ${mensaje.ok ? 'text-tinta-2' : 'text-critico'}`}>{mensaje.texto}</p>}
      <p className="mt-2 text-xs text-tenue">Requiere rol PROPIETARIO. Cambiar la calibración crea una nueva versión de configuración y detiene cualquier riego en curso (contrato §9.4).</p>
    </Tarjeta>
  )
}

/** Diagnóstico de la conexión del ESP32 (para el montaje físico). */
export function TarjetaDiagnostico({ vista }: { vista: VistaPanel }) {
  const d = vista.dispositivo
  const g = d.diagnostico
  if (d.nunca_conectado)
    return (
      <Tarjeta titulo="Conexión del ESP32" icono={Radio}>
        <Insignia tono="neutro">Esperando el primer contacto de {d.uid}</Insignia>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-tinta-2">
          <li>Abra el túnel HTTPS hacia http://127.0.0.1:3000.</li>
          <li>Aprovisione por USB en el ESP32 la URL del túnel (…/api/v1), el token del dispositivo y los certificados raíz (GUIA_ARRANQUE §7).</li>
          <li>El primer contacto aparece en la consola del backend como <code className="rounded bg-hundido px-1">[iot] … {d.uid} … → 200</code>.</li>
        </ol>
        <p className="mt-3 text-xs text-tenue">Hasta entonces no se muestra ninguna medición: el panel sólo presenta datos recibidos del ESP32.</p>
      </Tarjeta>
    )
  const contadores = g?.contadores && typeof g.contadores === 'object' ? Object.entries(g.contadores) : []
  return (
    <Tarjeta titulo="Diagnóstico de conexión" icono={Radio}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Dato etiqueta="Último contacto" valor={d.ultima_conexion_en ? formatoHora(d.ultima_conexion_en) : '—'} nota={haceTiempo(d.segundos_desde_conexion)} />
        <Dato etiqueta="Arranque actual" valor={g?.id_arranque ?? '—'} nota={g?.uptime_ms != null ? `encendido hace ${duracion(Math.round(g.uptime_ms / 1000))}` : undefined} />
        <Dato etiqueta="IP local (Wi-Fi)" valor={g?.ip_local ?? '—'} nota={`Señal ${d.rssi_dbm ?? '—'} dBm`} />
        <Dato etiqueta="Token en uso" valor={g?.token_prefijo ? `${g.token_prefijo}…` : '—'} nota="Sólo prefijo" />
        <Dato etiqueta="Firmware / contrato" valor={`${d.version_firmware} / ${d.version_contrato}`} nota={d.version_contrato !== '1.0.2' ? 'Distinto de 1.0.2' : 'Contrato vigente'} />
        <Dato etiqueta="Seguridad" valor={`TLS ${d.tls_vigencia}`} nota={`Reloj ${d.reloj_confiable ? 'confiable' : 'NO confiable'} · memoria ${d.persistencia_ok ? 'OK' : 'con error'}`} />
        <Dato
          etiqueta="Configuración"
          valor={`v${d.config_version_aplicada} / v${d.config_version_deseada}`}
          nota={g?.config_rechazada_version ? `Rechazó la v${g.config_rechazada_version}` : d.config_version_aplicada === d.config_version_deseada ? 'Sincronizada' : 'Pendiente de aplicar'}
        />
        <Dato etiqueta="Última orden procesada" valor={g?.max_id_orden_procesada ? `#${g.max_id_orden_procesada}` : '—'} nota={d.hardware_confirmado ? 'Hardware confirmado' : 'Hardware SIN confirmar'} />
      </dl>
      {contadores.length > 0 && (
        <p className="tabular mt-3 border-t border-rejilla pt-2 text-xs text-tenue">
          {contadores.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ')}
        </p>
      )}
    </Tarjeta>
  )
}
