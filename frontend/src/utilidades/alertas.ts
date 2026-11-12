// Explicación en lenguaje sencillo de cada tipo de alerta que genera el backend
// (backend/src/modulos/iot.ts, servicio.ts y tareas.ts). El mensaje técnico original se conserva aparte.
import type { Alerta } from '../tipos/contrato'

export interface GuiaAlerta {
  titulo: string
  /** Qué significa para la finca. */
  significado: string
  /** Qué hacer, en orden. */
  pasos: string[]
}

const GUIAS: Record<string, GuiaAlerta> = {
  DISPOSITIVO_FUERA_DE_LINEA: {
    titulo: 'El equipo de campo dejó de comunicarse',
    significado: 'La plataforma no recibe datos del ESP32. Las mediciones no se actualizan, pero el equipo sigue aplicando sus reglas de seguridad por su cuenta.',
    pasos: ['Compruebe que el equipo tenga energía (luz encendida).', 'Verifique que el Wi-Fi o hotspot esté encendido y cerca.', 'Si persiste, reinicie el equipo desconectándolo unos segundos.'],
  },
  FALLA_SENSOR: {
    titulo: 'El sensor de humedad envía lecturas no válidas',
    significado: 'Los valores del sensor no son creíbles, así que el riego automático se detiene para no regar a ciegas.',
    pasos: ['Revise que el cable del sensor esté conectado y sin cortes.', 'Asegúrese de que el sensor esté enterrado en la zona de raíces.', 'Si cambió el sensor, vuelva a calibrarlo en Equipo › Calibración.'],
  },
  BLOQUEO_ACTIVADO: {
    titulo: 'La bomba se bloqueó por seguridad',
    significado: 'El equipo detuvo la bomba y no la volverá a encender hasta que alguien revise la causa (por ejemplo, regó el tiempo máximo sin que subiera la humedad).',
    pasos: ['Revise si el tanque tiene agua y la manguera no está doblada o suelta.', 'Compruebe que el sensor esté en contacto con la tierra regada.', 'Cuando todo esté bien, rearme la bomba desde Inicio › Riego o en el propio equipo.'],
  },
  ORDEN_FALLIDA: {
    titulo: 'Una orden a la bomba no se pudo cumplir',
    significado: 'El equipo recibió la orden pero no pudo ejecutarla. La bomba quedó en el estado que muestra el panel.',
    pasos: ['Lea el motivo en el detalle técnico.', 'Revise que el modo y las condiciones de riego se cumplan.', 'Si se repite, consulte al técnico.'],
  },
  ORDEN_SIN_CONFIRMAR: {
    titulo: 'Una orden no recibió confirmación',
    significado: 'Se envió una orden pero el equipo nunca confirmó si la cumplió. No se debe suponer que la bomba se encendió o apagó.',
    pasos: ['Mire el estado real de la bomba en Inicio.', 'Revise la conexión del equipo de campo.', 'Si necesita apagar, envíe de nuevo "Apagar".'],
  },
  CONFIG_RECHAZADA: {
    titulo: 'El equipo rechazó la configuración',
    significado: 'El ESP32 no aceptó los últimos ajustes (umbrales, tiempos o calibración) y sigue con los anteriores.',
    pasos: ['Revise los valores de calibración y umbrales.', 'Corrija y guarde de nuevo; el equipo los descargará en su próxima conexión.'],
  },
  REINICIO_INESPERADO: {
    titulo: 'El equipo se reinició',
    significado: 'El ESP32 se apagó y volvió a encender sin que se lo pidieran (corte de energía o fallo). Un riego en curso se habrá detenido.',
    pasos: ['Revise la alimentación eléctrica del equipo.', 'Si se repite a menudo, revise la fuente de energía y el cableado.'],
  },
  RELOJ_NO_CONFIABLE: {
    titulo: 'La hora del equipo no es confiable',
    significado: 'El ESP32 no pudo sincronizar su reloj; las horas de sus registros pueden ser inexactas.',
    pasos: ['Verifique que el equipo tenga acceso a Internet por Wi-Fi.', 'Suele corregirse solo al recuperar la conexión.'],
  },
  PERSISTENCIA_DISPOSITIVO: {
    titulo: 'El equipo tiene problemas con su memoria',
    significado: 'El ESP32 no logra guardar su estado; tras un reinicio podría perder configuración o registros.',
    pasos: ['Informe al técnico responsable del equipo.'],
  },
  DATOS_PERDIDOS: {
    titulo: 'Se perdieron algunos datos del equipo',
    significado: 'Mientras estuvo sin conexión, el equipo no pudo guardar todas las mediciones; el historial tendrá huecos.',
    pasos: ['No requiere acción inmediata.', 'Si se repite, mejore la cobertura Wi-Fi del equipo.'],
  },
  ACK_INCOHERENTE: {
    titulo: 'Respuesta inesperada del equipo',
    significado: 'El equipo confirmó una orden de forma que no coincide con lo enviado. Es un aviso técnico de consistencia.',
    pasos: ['Revise el estado real de la bomba.', 'Informe al técnico si se repite.'],
  },
}

export function guiaAlerta(a: Pick<Alerta, 'tipo' | 'mensaje'>): GuiaAlerta {
  return GUIAS[a.tipo] ?? { titulo: a.mensaje, significado: 'Aviso del sistema sin explicación detallada disponible.', pasos: ['Revise el mensaje técnico y, si tiene dudas, consulte al técnico.'] }
}

export const SEVERIDAD: Record<Alerta['severidad'], { etiqueta: string; orden: number }> = {
  CRITICA: { etiqueta: 'Urgente', orden: 0 },
  ADVERTENCIA: { etiqueta: 'Revisar', orden: 1 },
  INFO: { etiqueta: 'Informativa', orden: 2 },
}

export const ESTADO_ALERTA: Record<Alerta['estado'], string> = {
  ACTIVA: 'Sin atender',
  RECONOCIDA: 'Vista, en seguimiento',
  RESUELTA: 'Resuelta',
}

/** Abiertas primero, luego por gravedad y por fecha (más reciente primero). */
export function ordenarAlertas(as: Alerta[]): Alerta[] {
  const abierta = (a: Alerta) => (a.estado === 'RESUELTA' ? 1 : 0)
  return [...as].sort((x, y) => abierta(x) - abierta(y) || SEVERIDAD[x.severidad].orden - SEVERIDAD[y.severidad].orden || y.creada_en - x.creada_en)
}
