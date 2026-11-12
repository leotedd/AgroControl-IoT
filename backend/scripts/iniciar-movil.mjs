// Alternativa cuando el entorno impide escribir backend/.env. No altera secretos.
import 'dotenv/config'
import { networkInterfaces } from 'node:os'

const origen = process.argv[2]
const u = new URL(origen ?? '')
const ips = Object.values(networkInterfaces()).flat().filter(Boolean).filter((a) => !a.internal).map((a) => a.address)
if (u.protocol !== 'https:' || u.origin !== origen || !ips.includes(u.hostname))
  throw new Error('Indique un origen HTTPS exacto cuya IP pertenezca a una interfaz local activa.')
const actuales = (process.env.CORS_ORIGENES ?? 'http://localhost:5174,http://127.0.0.1:5174').split(',').map((s) => s.trim()).filter(Boolean)
process.env.CORS_ORIGENES = [...new Set([...actuales, origen])].join(',')
process.env.PERMITIR_ENCENDIDO = 'false'
process.env.HOST = '127.0.0.1'
console.log(`Origen móvil autorizado para este proceso: ${origen}`)
await import('../dist/src/server.js')
