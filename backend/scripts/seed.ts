import { sqlPorMotor } from '../src/db.js'
// Datos iniciales del prototipo (MODELO_DATOS.md §4).
//   npm run db:seed -- --simular   → sólo muestra lo que crearía (no escribe nada)
//   npm run db:seed                → inserta, en UNA transacción, sólo si la base no tiene datos base
// Sólo INSERT: nunca actualiza ni borra. Se niega si ya hay usuarios, terrenos, dispositivos,
// sensores o actuadores, o si el UID AGC-ESP32-0001 ya existe (evita duplicados).
if (process.env.NODE_ENV !== 'test') await import('dotenv/config')
import bcrypt from 'bcryptjs'
import { bd, cerrarBd, ejecutar, transaccion } from '../src/db.js'
import { nuevoTokenDispositivo, sha256 } from '../src/util/comun.js'
import { contarDatos, UID_SEED, verificarEsquema } from '../src/verificacion.js'

const SIMULAR = process.argv.includes('--simular')

export const PLAN = [
  ['usuarios', 1, 'Administrador (rol ADMIN) con SEED_ADMIN_EMAIL; contraseña guardada sólo como hash bcrypt'],
  ['terrenos', 1, "'Terreno de pruebas'"],
  ['usuario_terreno', 1, 'El administrador como PROPIETARIO del terreno'],
  ['cultivos', 1, "'Cultivo de prueba' (ACTIVO)"],
  ['zonas', 1, "'Cama 1'"],
  ['dispositivos', 1, `${UID_SEED} 'ESP32 Banco'; sólo el SHA-256 del token (el token se muestra UNA vez)`],
  ['sensores', 1, 'HUM1 HUMEDAD_SUELO Capacitivo D43 · calibración 3000/1300 SIN confirmar'],
  ['actuadores', 1, "BOMBA1 (BOMBA) 'Mini bomba (relé)'"],
  ['configuraciones_control', 1, 'BOMBA1 ← HUM1 · modo DESHABILITADO · 30/55 % · 15 s · 60 s (valores de banco)'],
  ['auditoria', 1, 'Registro SEED'],
] as const

async function principal() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const nombre = (process.env.SEED_ADMIN_NOMBRE ?? 'Administrador').trim()
  const contrasena = process.env.SEED_ADMIN_CONTRASENA ?? ''

  const esquema = await verificarEsquema(bd())
  if (!esquema.correcto) throw new Error(`El esquema no está completo en '${esquema.base}' (faltan: ${[...esquema.faltanTablas, ...esquema.faltanTriggers].join(', ') || 'CHECKs'}).`)
  const datos = await contarDatos(bd())

  console.log(`Base '${esquema.base}' (MySQL ${esquema.version}): usuarios ${datos.usuarios}, terrenos ${datos.terrenos}, dispositivos ${datos.dispositivos}, sensores ${datos.sensores}, actuadores ${datos.actuadores}`)
  console.log('Registros que crea el seed:')
  for (const [tabla, n, detalle] of PLAN) console.log(`  + ${n} ${tabla.padEnd(24)} ${detalle}`)
  console.log(`  Administrador: ${email || '(SEED_ADMIN_EMAIL sin definir)'}`)

  const motivos: string[] = []
  if (!datos.vacia) motivos.push('la base ya tiene usuarios, terrenos, dispositivos, sensores o actuadores')
  if (datos.uidSeedExiste) motivos.push(`ya existe el dispositivo ${UID_SEED}`)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) motivos.push('SEED_ADMIN_EMAIL no es un correo válido')
  if (contrasena.length < 10) motivos.push('SEED_ADMIN_CONTRASENA debe tener al menos 10 caracteres')

  if (motivos.length) {
    console.log(`\nNO se insertará nada: ${motivos.join('; ')}.`)
    if (!SIMULAR) process.exitCode = 1
    return
  }
  if (SIMULAR) {
    console.log('\nSimulación: todo está listo y no se escribió nada. Ejecute `npm run db:seed` para insertar.')
    return
  }

  const token = nuevoTokenDispositivo()
  const hash = await bcrypt.hash(contrasena, 12)
  const ids = await transaccion(async (con) => {
    // Re-comprobación dentro de la transacción (evita duplicados si se lanzan dos seeds a la vez).
    const d = await contarDatos(con)
    if (!d.vacia || d.uidSeedExiste) throw new Error('La base dejó de estar vacía; no se insertó nada.')
    const u = await ejecutar(con, "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'ADMIN') RETURNING id", [nombre, email, hash])
    const t = await ejecutar(con, "INSERT INTO terrenos (nombre, descripcion, creado_por) VALUES ('Terreno de pruebas', 'Banco de pruebas del prototipo', ?) RETURNING id", [u.insertId])
    await ejecutar(con, "INSERT INTO usuario_terreno (usuario_id, terreno_id, rol) VALUES (?, ?, 'PROPIETARIO')", [u.insertId, t.insertId])
    const c = await ejecutar(con, "INSERT INTO cultivos (terreno_id, nombre, estado) VALUES (?, 'Cultivo de prueba', 'ACTIVO') RETURNING id", [t.insertId])
    const z = await ejecutar(con, "INSERT INTO zonas (terreno_id, cultivo_id, nombre) VALUES (?, ?, 'Cama 1') RETURNING id", [t.insertId, c.insertId])
    const dsp = await ejecutar(
      con,
      sqlPorMotor({ mysql: "INSERT INTO dispositivos (terreno_id, uid, nombre, token_hash, token_prefijo, token_creado_en) VALUES (?, ?, 'ESP32 Banco', ?, ?, NOW(3)) RETURNING id", postgres: `INSERT INTO dispositivos (terreno_id, uid, nombre, token_hash, token_prefijo, token_creado_en) VALUES (?, ?, 'ESP32 Banco', ?, ?, now()) RETURNING id` }),
      [t.insertId, UID_SEED, sha256(token), token.slice(0, 12)],
    )
    const s = await ejecutar(con, "INSERT INTO sensores (dispositivo_id, zona_id, codigo, tipo, modelo) VALUES (?, ?, 'HUM1', 'HUMEDAD_SUELO', 'Capacitivo D43') RETURNING id", [dsp.insertId, z.insertId])
    const a = await ejecutar(con, "INSERT INTO actuadores (dispositivo_id, zona_id, codigo, tipo, descripcion) VALUES (?, ?, 'BOMBA1', 'BOMBA', 'Mini bomba (relé)') RETURNING id", [dsp.insertId, z.insertId])
    await ejecutar(con, 'INSERT INTO configuraciones_control (actuador_id, sensor_id) VALUES (?, ?)', [a.insertId, s.insertId])
    await ejecutar(con, "INSERT INTO auditoria (usuario_id, actor, accion, entidad, entidad_id) VALUES (?, 'SISTEMA', 'SEED', 'base', ?) RETURNING id", [u.insertId, esquema.base])
    return { usuario: u.insertId, terreno: t.insertId, zona: z.insertId, dispositivo: dsp.insertId, sensor: s.insertId, actuador: a.insertId }
  })

  console.log('\nDatos iniciales creados:', ids)
  console.log('')
  console.log(`TOKEN DEL DISPOSITIVO ${UID_SEED} (se muestra UNA sola vez; cópielo ahora a un lugar seguro):`)
  console.log(`  ${token}`)
  console.log('Cárguelo en el ESP32 (NVS agro-api/token) o en $env:SIM_TOKEN para el simulador. No lo guarde en el repositorio.')
  console.log('Si lo pierde: rote el token del dispositivo (pendiente en la web) o vuelva a crear la base.')
}

principal()
  .catch((e) => {
    console.error('Error:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => cerrarBd())
