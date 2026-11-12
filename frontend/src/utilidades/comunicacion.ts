// Estado de la comunicación en cuatro tramos independientes: navegador⇄backend, ESP32⇄backend,
// frescura de las lecturas y sincronización de la configuración. Función pura (probada).
import type { VistaPanel } from '../tipos/contrato'

export type TonoEstado = 'ok' | 'aviso' | 'critico' | 'neutro'

export interface Indicador {
  clave: 'backend' | 'esp32' | 'datos' | 'config'
  titulo: string
  tono: TonoEstado
  texto: string
  detalle: string
}

/** Antigüedad máxima de una lectura para considerarla actual (3 envíos de telemetría de 10 s). */
export const DATOS_AL_DIA_S = 30
export const DATOS_VIEJOS_S = 120

export function evaluarComunicacion(v: VistaPanel, esDemo: boolean): Indicador[] {
  const r: Indicador[] = []
  const enlace = v.enlace
  if (!esDemo)
    r.push(
      !enlace || enlace.ok
        ? { clave: 'backend', titulo: 'Servidor', tono: 'ok', texto: 'Conectado', detalle: 'Backend y MySQL responden' }
        : { clave: 'backend', titulo: 'Servidor', tono: 'critico', texto: 'Sin conexión', detalle: enlace.error ?? 'El backend no responde' },
    )

  const d = v.dispositivo
  if (d.nunca_conectado)
    r.push({ clave: 'esp32', titulo: 'ESP32', tono: 'neutro', texto: 'Nunca conectado', detalle: 'Esperando el primer contacto del dispositivo' })
  else if (d.conexion === 'EN_LINEA')
    r.push({ clave: 'esp32', titulo: 'ESP32', tono: 'ok', texto: 'Conectado', detalle: `Último contacto hace ${d.segundos_desde_conexion} s` })
  else if (d.conexion === 'INESTABLE')
    r.push({ clave: 'esp32', titulo: 'ESP32', tono: 'aviso', texto: 'Inestable', detalle: `Sin contacto desde hace ${d.segundos_desde_conexion} s` })
  else r.push({ clave: 'esp32', titulo: 'ESP32', tono: 'critico', texto: 'Desconectado', detalle: `Sin contacto desde hace ${Math.round(d.segundos_desde_conexion / 60)} min` })

  const s = v.sensor
  const edad = s.medido_en ? Math.max(0, Math.round((v.ahora - s.medido_en) / 1000)) : null
  if (edad === null) r.push({ clave: 'datos', titulo: 'Lecturas', tono: 'neutro', texto: 'Sin lecturas', detalle: 'Todavía no hay mediciones del sensor' })
  else if (s.estado !== 'OK' && s.estado !== 'SIN_CALIBRAR')
    r.push({ clave: 'datos', titulo: 'Lecturas', tono: 'critico', texto: 'Lectura no válida', detalle: `El sensor reporta ${s.estado}` })
  else if (edad <= DATOS_AL_DIA_S)
    r.push({ clave: 'datos', titulo: 'Lecturas', tono: s.estado === 'SIN_CALIBRAR' ? 'aviso' : 'ok', texto: s.estado === 'SIN_CALIBRAR' ? 'Sin calibrar' : 'Al día', detalle: `Última lectura hace ${edad} s` })
  else
    r.push({
      clave: 'datos',
      titulo: 'Lecturas',
      tono: edad <= DATOS_VIEJOS_S ? 'aviso' : 'critico',
      texto: 'Desactualizadas',
      detalle: `Última lectura hace ${edad < 120 ? `${edad} s` : `${Math.round(edad / 60)} min`}`,
    })

  const rechazada = d.diagnostico?.config_rechazada_version
  if (rechazada && rechazada === d.config_version_deseada)
    r.push({ clave: 'config', titulo: 'Configuración', tono: 'critico', texto: 'Rechazada', detalle: `El ESP32 rechazó la v${rechazada}` })
  else if (d.config_version_aplicada === d.config_version_deseada)
    r.push({ clave: 'config', titulo: 'Configuración', tono: 'ok', texto: 'Sincronizada', detalle: `v${d.config_version_aplicada} aplicada` })
  else if (d.nunca_conectado)
    // Estado inicial esperado: el ESP32 descargará la configuración en su primera conexión.
    r.push({ clave: 'config', titulo: 'Configuración', tono: 'neutro', texto: 'Sin entregar', detalle: `v${d.config_version_deseada} lista; el ESP32 aún no se ha conectado` })
  else
    r.push({ clave: 'config', titulo: 'Configuración', tono: 'aviso', texto: 'Pendiente', detalle: `Aplicada v${d.config_version_aplicada}, deseada v${d.config_version_deseada}` })
  return r
}
