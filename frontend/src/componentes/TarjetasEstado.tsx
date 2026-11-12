import { Cpu, Wifi, WifiOff } from 'lucide-react'
import type { VistaPanel } from '../tipos/contrato'
import { haceTiempo, texto } from '../utilidades/formato'
import { Dato, EtiquetaDemo, Insignia, Tarjeta } from './base'

export function TarjetaDispositivo({ vista }: { vista: VistaPanel }) {
  const d = vista.dispositivo
  const tono = d.conexion === 'EN_LINEA' ? 'ok' : d.conexion === 'INESTABLE' ? 'aviso' : 'critico'
  const sincronizada = d.config_version_aplicada === d.config_version_deseada
  return (
    <Tarjeta titulo="Datos del ESP32" icono={Cpu} accion={<EtiquetaDemo />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Insignia tono={tono} icono={d.conexion === 'FUERA_DE_LINEA' ? WifiOff : Wifi}>
          {texto(d.conexion)}
        </Insignia>
        <span className="text-xs text-tenue">
          Último contacto {d.ultima_conexion_en ? haceTiempo(d.segundos_desde_conexion) : 'nunca'}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Dato etiqueta="Dispositivo" valor={d.uid} />
        <Dato etiqueta="Señal Wi-Fi" valor={d.rssi_dbm !== null ? `${d.rssi_dbm} dBm` : '—'} />
        <Dato etiqueta="Firmware" valor={d.version_firmware} nota={`Contrato ${d.version_contrato}`} />
        <Dato
          etiqueta="Configuración"
          valor={`v${d.config_version_aplicada} / v${d.config_version_deseada}`}
          nota={sincronizada ? 'Sincronizada' : 'Pendiente de aplicar'}
        />
        <Dato etiqueta="Vigencia TLS" valor={d.tls_vigencia} nota={`Reloj ${d.reloj_confiable ? 'confiable' : 'no confiable'}`} />
        <Dato etiqueta="Tope de riego" valor={`${d.tope_riego_s} s`} nota={d.persistencia_ok ? 'Memoria OK' : 'Memoria con error'} />
      </dl>
    </Tarjeta>
  )
}
