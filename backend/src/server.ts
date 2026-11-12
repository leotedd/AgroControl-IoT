if (process.env.NODE_ENV !== 'test') await import('dotenv/config')
import { crearApp } from './app.js'
import { config } from './config.js'
import { bd, cerrarBd } from './db.js'
import { iniciarTareas } from './tareas.js'
import { contarDatos, verificarEsquema } from './verificacion.js'

async function principal() {
  const c = config()
  let esquema
  try {
    esquema = await verificarEsquema(bd())
  } catch (e) {
    const codigo = (e as { code?: string }).code
    throw new Error(`No se pudo conectar al motor ${c.DB_MOTOR} (${codigo ?? 'ERROR_CONEXION'}). Ejecute npm run verificar.`)
  }
  if (!esquema.correcto)
    throw new Error(`Esquema incompleto: faltan ${[...esquema.faltanTablas, ...esquema.faltanTriggers, ...esquema.faltanChecks].join(', ')}. Revise el esquema del motor seleccionado.`)
  const datos = await contarDatos(bd())
  console.log(`${c.DB_MOTOR} ${esquema.version} · base '${esquema.base}' · ${esquema.tablas.length} tablas · ${esquema.triggers.length} triggers · ${esquema.checks.length} CHECKs`)
  if (datos.vacia) console.warn('Aviso: la base no tiene datos. Revise y ejecute el seed (npm run db:seed -- --simular).')

  const detener = iniciarTareas()
  const servidor = crearApp().listen(c.PUERTO, c.HOST, () => {
    console.log(`AgroControl backend en http://${c.HOST}:${c.PUERTO}/api/v1  (${c.NODE_ENV})`)
    console.log(`  Encendido remoto de la bomba: ${c.PERMITIR_ENCENDIDO ? 'PERMITIDO ⚠' : 'DESHABILITADO (PERMITIR_ENCENDIDO=false)'}`)
    console.log(`  /iot: ${c.IOT_PERMITIR_HTTP_LOCAL ? 'HTTPS (túnel) y HTTP SÓLO desde 127.0.0.1 (simulador)' : 'sólo HTTPS (túnel)'}`)
  })
  servidor.on('error', (e) => {
    console.error(`No se pudo escuchar en ${c.HOST}:${c.PUERTO}: ${(e as Error).message}`)
    process.exit(1)
  })
  let saliendo = false
  const salir = async () => {
    if (saliendo) return
    saliendo = true
    const cerrado = new Promise<void>((r) => servidor.close(() => r()))
    await detener()
    await cerrado
    await cerrarBd()
    process.exit(0)
  }
  process.on('SIGINT', salir)
  process.on('SIGTERM', salir)
}

principal().catch((e) => {
  console.error('No se pudo iniciar el backend:', (e as Error).message)
  process.exit(1)
})
