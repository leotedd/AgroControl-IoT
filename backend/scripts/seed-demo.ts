import { config } from '../src/config.js'
import { cerrarBd } from '../src/db.js'
import { sembrarDemo } from '../src/demo.js'

try {
  const c = config()
  if (c.DB_MOTOR !== 'postgres') throw new Error('Seleccione PostgreSQL para la demo.')
  const host = new URL(c.DATABASE_URL!).hostname
  if (!process.argv.includes('--aplicar') || !process.argv.includes(`--confirmar-host=${host}`)) throw new Error('Se requieren --aplicar y --confirmar-host exacto. No se escribió nada.')
  const r = await sembrarDemo(process.env.DEMO_ADMIN_CONTRASENA ?? '')
  console.log(r.creada ? 'Demo sintética creada; sin secretos en salida.' : 'Demo ya existente; no se modificó.')
} catch { console.error('Seed demo rechazado o fallido; revise configuración y autorización del destino.'); process.exitCode = 1 }
finally { await cerrarBd() }
