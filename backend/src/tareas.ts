import { sqlPorMotor } from './db.js'
import { bd, ejecutar, filas } from './db.js'
import { crearAlerta, resolverAlerta } from './util/registro.js'
import { SEGUNDOS_INESTABLE } from './modulos/servicio.js'

/** Caducidad de órdenes (contrato §8.6). Exportada para pruebas. */
export async function caducarOrdenes() {
  await ejecutar(bd(), sqlPorMotor({ mysql: "UPDATE ordenes_riego SET estado = 'EXPIRADA', motivo_cierre = 'VENCIDA_SIN_ENTREGA' WHERE estado = 'PENDIENTE' AND expira_en <= NOW(3) AND motivo_cierre IS NULL", postgres: `UPDATE ordenes_riego SET estado = 'EXPIRADA', motivo_cierre = 'VENCIDA_SIN_ENTREGA' WHERE estado = 'PENDIENTE' AND expira_en <= now() AND motivo_cierre IS NULL` }))
  const sinAck = await filas(bd(), sqlPorMotor({ mysql: "SELECT id, dispositivo_id FROM ordenes_riego WHERE estado = 'ENTREGADA' AND expira_en + INTERVAL 30 SECOND <= NOW(3)", postgres: `SELECT id, dispositivo_id FROM ordenes_riego WHERE estado = 'ENTREGADA' AND expira_en + (30 * interval '1 second') <= now()` }))
  for (const o of sinAck) {
    const r = await ejecutar(bd(), "UPDATE ordenes_riego SET estado = 'SIN_CONFIRMAR', motivo_cierre = 'SIN_ACK' WHERE id = ? AND estado = 'ENTREGADA' AND motivo_cierre IS NULL", [o.id])
    if (r.affectedRows)
      await crearAlerta(bd(), { dispositivoId: o.dispositivo_id, tipo: 'ORDEN_SIN_CONFIRMAR', severidad: 'ADVERTENCIA', mensaje: `La orden #${o.id} no fue confirmada por el ESP32.`, clave: `SIN_ACK:${o.id}`, ordenId: o.id })
  }
}

/** Presencia: alerta si el ESP32 lleva > 120 s sin contacto; se resuelve al volver. */
export async function revisarPresencia() {
  const ds = await filas(bd(), "SELECT id, ultima_conexion_en FROM dispositivos WHERE estado = 'ACTIVO' AND ultima_conexion_en IS NOT NULL")
  for (const d of ds) {
    const s = (Date.now() - new Date(d.ultima_conexion_en).getTime()) / 1000
    if (s > SEGUNDOS_INESTABLE)
      await crearAlerta(bd(), { dispositivoId: d.id, tipo: 'DISPOSITIVO_FUERA_DE_LINEA', severidad: 'ADVERTENCIA', mensaje: 'El ESP32 lleva más de 2 minutos sin comunicarse.' })
    else await resolverAlerta(bd(), `DISPOSITIVO_FUERA_DE_LINEA:${d.id}`)
  }
}

export function iniciarTareas() {
  const pendientes = new Set<Promise<void>>()
  const envolver = (nombre: string, fn: () => Promise<void>) => () => {
    const p = fn().catch(() => console.error(`[tarea ${nombre}] operación fallida`))
    pendientes.add(p)
    void p.finally(() => pendientes.delete(p))
  }
  const a = setInterval(envolver('caducidad', caducarOrdenes), 15_000)
  const b = setInterval(envolver('presencia', revisarPresencia), 30_000)
  return async () => {
    clearInterval(a)
    clearInterval(b)
    await Promise.allSettled(pendientes)
  }
}
