import { bd, ejecutar, sqlPorMotor } from './db.js'

const cache = new Map<number, { t: number; ip: string | null; arranque: string }>()
const pendientes = new Map<number, Promise<void>>()
export function reiniciarPresencia() { cache.clear() }
export async function actualizarPresencia(id: number, ip: string | null, arranque: string, cambioArranque: boolean) {
  if (pendientes.has(id)) await pendientes.get(id)
  const anterior = cache.get(id)
  const ahora = Date.now()
  if (!cambioArranque && anterior && anterior.ip === ip && anterior.arranque === arranque && ahora - anterior.t < 10000) return
  const tarea = (async () => {
    const r = await ejecutar(bd(), sqlPorMotor({
      mysql: "UPDATE dispositivos SET ultima_conexion_en = NOW(3), ultima_ip = ? WHERE id = ? AND (? OR ultima_conexion_en IS NULL OR ultima_conexion_en <= NOW(3) - INTERVAL 10 SECOND OR NOT (ultima_ip <=> ?))",
      postgres: "UPDATE dispositivos SET ultima_conexion_en = now(), ultima_ip = ? WHERE id = ? AND (?::boolean OR ultima_conexion_en IS NULL OR ultima_conexion_en <= now() - interval '10 seconds' OR ultima_ip IS DISTINCT FROM ?)",
    }), [ip, id, cambioArranque, ip])
    if (cache.size >= 10000) cache.delete(cache.keys().next().value!)
    if (r.affectedRows) cache.set(id, { t: Date.now(), ip, arranque })
    else cache.delete(id)
  })()
  pendientes.set(id, tarea)
  try { await tarea } finally { if (pendientes.get(id) === tarea) pendientes.delete(id) }
}
