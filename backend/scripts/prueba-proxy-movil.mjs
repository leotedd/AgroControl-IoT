import 'dotenv/config'
import assert from 'node:assert/strict'
import https from 'node:https'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { config } from '../dist/src/config.js'
import { bd, fila, cerrarBd } from '../dist/src/db.js'

const origen = process.argv[2] ?? 'https://172.20.10.7:5175'
let total = 0
function http(ruta, estado, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    // Sólo este cliente de pruebas acepta el certificado autofirmado del Vite local.
    // No cambia TLS del servidor, navegador, firmware ni del proceso global.
    const req = https.request(new URL(`/api/v1${ruta}`, origen), { rejectUnauthorized: false, method, headers: { Origin: origen, ...headers } }, (r) => {
      let texto = ''
      r.on('data', (d) => texto += d)
      r.on('end', () => {
        try {
          assert.equal(r.statusCode, estado, `${method} ${ruta}`)
          if (estado !== 403 && method !== 'OPTIONS') {
            assert.equal(r.headers['access-control-allow-origin'], origen)
            assert.equal(r.headers['access-control-allow-credentials'], 'true')
          }
          const data = texto ? JSON.parse(texto) : null
          console.log(`[OK] proxy HTTPS ${method} ${ruta}: ${estado}`)
          total++
          resolve({ data, headers: r.headers })
        } catch (e) { reject(e) }
      })
    })
    req.setTimeout(10000, () => req.destroy(new Error('Timeout del proxy')))
    req.on('error', reject)
    req.end(body)
  })
}
try {
  await http('/salud', 200)
  await http('/auth/login', 204, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })
  const preflight = await fetch('http://127.0.0.1:3000/api/v1/auth/login', { method: 'OPTIONS', headers: { Origin: origen, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origen)
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true')
  console.log('[OK] preflight directo del backend: origen exacto y credentials=true. Vite intercepta OPTIONS; las peticiones web /api son del mismo origen.')
  await http('/auth/refresh', 401, { method: 'POST' })
  await http('/auth/me', 401)
  await http('/auth/login', 400, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
  await http('/auth/login', 422, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  await http('/salud', 403, { headers: { Origin: 'https://no-autorizado.invalid' } })
  const u = await fila(bd(), "SELECT id, rol, nombre FROM usuarios WHERE activo=1 AND rol='ADMIN' LIMIT 1")
  assert.ok(u, 'Falta administrador activo para consultas de sólo lectura')
  let token = jwt.sign({ sub: u.id, rol: u.rol, nombre: u.nombre }, config().JWT_SECRETO, { algorithm: 'HS256', expiresIn: 120 })
  const email = process.env.SEED_ADMIN_EMAIL
  const password = process.env.SEED_ADMIN_CONTRASENA
  const cuenta = email && password && !password.startsWith('<') ? await fila(bd(), 'SELECT password_hash, activo, bloqueado_hasta FROM usuarios WHERE email=?', [email.toLowerCase()]) : null
  if (cuenta?.activo && await bcrypt.compare(password, cuenta.password_hash) && (!cuenta.bloqueado_hasta || new Date(cuenta.bloqueado_hasta) <= new Date())) {
    const login = await http('/auth/login', 200, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    const cookie = login.headers['set-cookie']?.find((s) => s.startsWith('agc_refresh='))
    assert.ok(cookie && /; Secure/i.test(cookie) && /; HttpOnly/i.test(cookie) && /; SameSite=Strict/i.test(cookie))
    assert.match(cookie, /; Path=\/api\/v1\/auth/i)
    token = login.data.data.token_acceso
    const refresh = await http('/auth/refresh', 200, { method: 'POST', headers: { Cookie: cookie.split(';')[0] } })
    const rotada = refresh.headers['set-cookie'].find((s) => s.startsWith('agc_refresh=')).split(';')[0]
    await http('/auth/logout', 200, { method: 'POST', headers: { Cookie: rotada } })
    console.log('Login/refresh/logout reales y atributos de cookie verificados.')
  } else console.log('[PENDIENTE] Sin credenciales válidas de prueba: login real, cookie emitida y refresh autenticado no comprobados. Consultas con JWT temporal local.')
  const headers = { Authorization: `Bearer ${token}` }
  for (const ruta of ['/auth/me', '/terrenos', '/alertas']) await http(ruta, 200, { headers })
  const d = await fila(bd(), 'SELECT id,terreno_id FROM dispositivos LIMIT 1')
  assert.ok(d)
  await http(`/terrenos/${d.terreno_id}/dispositivos`, 200, { headers })
  const estado = await http(`/dispositivos/${d.id}/estado`, 200, { headers })
  console.log('Conexión real reportada:', estado.data.data.dispositivo.conexion)
  assert.equal(estado.data.data.servidor.permitir_encendido, false)
  for (const sufijo of ['ordenes', 'eventos']) await http(`/dispositivos/${d.id}/${sufijo}`, 200, { headers })
  const s = await fila(bd(), 'SELECT id,zona_id FROM sensores WHERE dispositivo_id=? LIMIT 1', [d.id])
  assert.ok(s)
  await http(`/sensores/${s.id}/mediciones`, 200, { headers })
  await http(`/sensores/${s.id}/mediciones?agrupacion=5m`, 200, { headers })
  if (s.zona_id) await http(`/zonas/${s.zona_id}/riegos`, 200, { headers })
  const o = await fila(bd(), 'SELECT id FROM ordenes_riego WHERE dispositivo_id=? LIMIT 1', [d.id])
  if (o) await http(`/ordenes/${o.id}`, 200, { headers })
  console.log(`${total} solicitudes verificadas a través de Vite HTTPS; sin órdenes ni cambios físicos.`)
} finally { await cerrarBd() }
