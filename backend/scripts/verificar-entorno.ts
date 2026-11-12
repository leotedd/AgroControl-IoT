// Verificación de SÓLO LECTURA del entorno del backend: `npm run verificar`
//   - backend/.env: variables presentes y válidas (nunca muestra contraseñas ni secretos).
//   - MySQL: conexión, versión, 17 tablas, 2 triggers, 7 CHECKs.
//   - Datos: si la base está vacía (seed pendiente) o ya inicializada.
//   - Seguridad: PERMITIR_ENCENDIDO e IOT_PERMITIR_HTTP_LOCAL.
if (process.env.NODE_ENV !== 'test') await import('dotenv/config')
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from '../src/config.js'
import { bd, cerrarBd } from '../src/db.js'
import { auditarConsistencia, contarDatos, verificarEsquema, tamanoBase, CHECKS_ESPERADOS, TABLAS_ESPERADAS } from '../src/verificacion.js'

const ok = (m: string) => console.log(`  [OK]    ${m}`)
const aviso = (m: string) => console.log(`  [AVISO] ${m}`)
const fallo = (m: string) => console.log(`  [FALLA] ${m}`)
let fallos = 0

async function principal() {
  console.log('1) Archivo backend/.env')
  if (existsSync(resolve(process.cwd(), '.env'))) ok('backend/.env encontrado (su contenido no se muestra)')
  else if ((process.env.DB_USUARIO || process.env.DATABASE_URL) && process.env.JWT_SECRETO) aviso('No existe backend/.env; se usan variables del entorno del proceso')
  else {
    fallo('No existe backend/.env. Cópielo desde .env.example y complételo.')
    process.exitCode = 1
    return
  }

  let c
  try {
    c = config()
    ok(`Variables válidas · motor ${c.DB_MOTOR} · credenciales verificadas sin mostrarlas`)
  } catch (e) {
    fallo((e as Error).message)
    process.exitCode = 1
    return
  }

  console.log('2) Seguridad de la bomba')
  if (c.PERMITIR_ENCENDIDO) {
    fallo('Encendido habilitado: el servidor aceptaría encender la bomba. Para esta fase debe ser false.')
    fallos++
  } else ok('PERMITIR_ENCENDIDO=false: el servidor rechaza encender y el modo AUTOMATICO; APAGAR siempre funciona')
  if (c.IOT_PERMITIR_HTTP_LOCAL) aviso('IOT_PERMITIR_HTTP_LOCAL=true: /iot acepta HTTP sólo desde 127.0.0.1 (para el simulador). El ESP32 real usa HTTPS por el túnel.')
  else ok('IOT_PERMITIR_HTTP_LOCAL=false: /iot sólo por HTTPS (túnel)')

  console.log('3) Conexión y esquema MySQL')
  let esquema
  try {
    esquema = await verificarEsquema(bd())
  } catch (e) {
    const codigo = (e as { code?: string }).code
    fallo(`No se pudo conectar a MySQL (${codigo ?? 'ERROR_CONEXION'}). Revise DB_HOST, DB_PUERTO, DB_USUARIO y DB_CONTRASENA.`)
    process.exitCode = 1
    return
  }
  ok(`${c.DB_MOTOR} ${esquema.version} · base '${esquema.base}'`)
  if (esquema.faltanTablas.length) {
    fallo(`Faltan tablas: ${esquema.faltanTablas.join(', ')}`)
    fallos++
  } else ok(`${TABLAS_ESPERADAS.length}/${TABLAS_ESPERADAS.length} tablas`)
  if (esquema.faltanTriggers.length) {
    fallo(`Faltan triggers: ${esquema.faltanTriggers.join(', ')}`)
    fallos++
  } else ok(`${esquema.triggers.length}/${esquema.triggers.length} triggers`)
  if (esquema.faltanChecks.length) aviso(`CHECKs: ${esquema.checks.length} (se esperaban ${CHECKS_ESPERADOS.length})`)
  else ok(`${CHECKS_ESPERADOS.length} CHECKs`)

  console.log('4) Datos')
  const tamano = await tamanoBase(bd(), c.LIMITE_BD_MB)
  if (tamano) console.log(`         Tamaño BD: ${tamano.mb.toFixed(1)} MiB; ${tamano.porcentaje.toFixed(1)} % del presupuesto; ${tamano.nivel}`)
  const d = await contarDatos(bd())
  console.log(`         usuarios ${d.usuarios} · terrenos ${d.terrenos} · dispositivos ${d.dispositivos} · sensores ${d.sensores} · actuadores ${d.actuadores} · mediciones ${d.mediciones} · órdenes ${d.ordenes}`)
  if (d.vacia) aviso('La base está vacía: falta el seed (npm run db:seed -- --simular para ver qué crearía).')
  else ok(`La base ya tiene datos${d.uidSeedExiste ? ' (incluye AGC-ESP32-0001)' : ''}: el seed se negará a ejecutarse (evita duplicados).`)

  console.log('5) Consistencia de datos (sólo lectura; no corrige nada)')
  const hallazgos = await auditarConsistencia(bd(), c.PERMITIR_ENCENDIDO)
  if (!hallazgos.length) ok('Sin incoherencias detectadas')
  for (const h of hallazgos) {
    const linea = `${h.cantidad} ${h.mensaje} [${h.codigo}]`
    if (h.nivel === 'FALLA') {
      fallo(linea)
      fallos++
    } else if (h.nivel === 'AVISO') aviso(linea)
    else console.log(`  [INFO]  ${linea}`)
  }

  console.log('')
  if (fallos || process.exitCode) console.log(`Resultado: ${fallos} problema(s) a corregir antes de arrancar.`)
  else console.log('Resultado: entorno listo para `npm run dev`.')
  if (fallos) process.exitCode = 1
}

principal()
  .catch((e) => {
    fallo((e as Error).message)
    process.exitCode = 1
  })
  .finally(() => cerrarBd())
