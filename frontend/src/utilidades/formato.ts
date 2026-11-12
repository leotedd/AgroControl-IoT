const hora = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const horaCorta = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' })

export const formatoHora = (t: number) => hora.format(t)
export const formatoHoraCorta = (t: number) => horaCorta.format(t)

export function haceTiempo(segundos: number): string {
  if (segundos < 5) return 'ahora'
  if (segundos < 60) return `hace ${segundos} s`
  const m = Math.floor(segundos / 60)
  if (m < 60) return `hace ${m} min`
  return `hace ${Math.floor(m / 60)} h`
}

export function duracion(segundos: number): string {
  if (segundos < 60) return `${segundos} s`
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return s ? `${m} min ${s} s` : `${m} min`
}

/** Texto legible para códigos del contrato. */
const TEXTOS: Record<string, string> = {
  DESHABILITADO: 'Apagado (no riega)',
  MANUAL: 'Manual',
  AUTOMATICO: 'Automático',
  APAGADA: 'Apagada',
  RIEGO_MANUAL: 'Riego manual',
  RIEGO_AUTOMATICO: 'Riego automático',
  EN_LINEA: 'En línea',
  INESTABLE: 'Inestable',
  FUERA_DE_LINEA: 'Fuera de línea',
  PENDIENTE: 'Enviada',
  ENTREGADA: 'Recibida por el ESP32',
  EJECUTADA: 'Ejecutada',
  RECHAZADA: 'Rechazada',
  FALLIDA: 'Fallida',
  EXPIRADA: 'Expirada',
  CANCELADA: 'Cancelada',
  SIN_CONFIRMAR: 'Sin confirmar',
  CRITICO: 'Crítico',
  PREVENTIVO: 'Preventivo',
  FALLA_SENSOR: 'Falla del sensor',
  SENSOR_CADUCADO: 'Sensor sin lecturas recientes',
  TIEMPO_MAXIMO: 'Tiempo máximo de riego alcanzado',
  PREVENTIVO_REPETIDO: 'Bloqueo preventivo repetido',
  FALLA_CRITICA: 'Falla crítica',
  PERSISTENCIA_NO_DISPONIBLE: 'Memoria no disponible',
  UMBRAL_ALCANZADO: 'Humedad objetivo alcanzada',
  DURACION_CUMPLIDA: 'Duración cumplida',
  ORDEN_APAGAR: 'Apagado por orden',
  CAMBIO_MODO: 'Cambio de modo',
  CONFIG_ACTUALIZADA: 'Configuración actualizada',
  DISPOSITIVO_FUERA_DE_LINEA: 'El ESP32 no está en línea',
  BLOQUEO_ACTIVO: 'Hay un bloqueo de seguridad',
  MODO_NO_MANUAL: 'Requiere modo Manual',
  CONFIG_NO_SINCRONIZADA: 'Configuración pendiente de aplicar',
  SENSOR_INVALIDO: 'Lectura del sensor no válida',
  ACTUADOR_OCUPADO: 'Ya hay un riego en curso',
  DESCANSO_ACTIVO: 'Periodo de descanso activo',
  HUMEDAD_SUFICIENTE: 'Humedad ya suficiente',
  APAGADO_PENDIENTE: 'Hay un apagado pendiente',
  MODO_INCORRECTO: 'Modo incorrecto',
  BLOQUEO_SEGURIDAD: 'Bloqueo de seguridad',
  DURACION_RECORTADA: 'Duración recortada',
  SIN_CAMBIO: 'Ya estaba apagada',
  ANULADA_POR_APAGAR: 'Anulada por un apagado',
  ORDEN_CADUCADA: 'Orden caducada',
  BLOQUEO_NO_COINCIDE: 'El bloqueo ya no coincide',
  BLOQUEO_NO_LIBERABLE: 'Condición de rearme no cumplida',
  INSPECCION_NO_CONFIRMADA: 'Falta confirmar inspección',
  REEMPLAZADA: 'Reemplazada',
  REEMPLAZADA_POR_APAGAR: 'Reemplazada por apagar',
  SIN_ACK: 'Sin respuesta del ESP32',
  VENCIDA_SIN_ENTREGA: 'No se entregó a tiempo',
  ENCENDIDO_DESHABILITADO: 'Encendido remoto deshabilitado en el servidor',
  BACKEND_NO_DISPONIBLE: 'Sin conexión con el backend',
  ACTIVA: 'Activa',
  RECONOCIDA: 'Reconocida',
  RESUELTA: 'Resuelta',
  SIN_DISPOSITIVO: 'Sin dispositivo',
  SIN_DATOS: 'Sin datos del dispositivo',
  REINICIO_DISPOSITIVO: 'El ESP32 se reinició',
  CANCELADA_POR_USUARIO: 'Cancelada por el usuario',
  CALIBRACION_NO_CONFIRMADA: 'Calibración del sensor sin confirmar',
  HARDWARE_NO_CONFIRMADO: 'Hardware sin confirmar en el ESP32',
  RESULTADO_INCIERTO_REINICIO: 'Resultado incierto tras reinicio',
}

export const texto = (codigo: string | null | undefined) => (codigo ? (TEXTOS[codigo] ?? codigo) : '')

/** Nombre corto de un tipo de orden (compartido por DEMO y REAL; no depende del simulador). */
export function etiquetaTipo(tipo: string): string {
  return tipo === 'BOMBA_ENCENDER' ? 'Encender' : tipo === 'BOMBA_APAGAR' ? 'Apagar' : tipo === 'RESTABLECER_BLOQUEO' ? 'Rearmar' : tipo
}

const fecha = new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const formatoFechaHora = (t: number) => fecha.format(t)
