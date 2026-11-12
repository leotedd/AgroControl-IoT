import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { entornoPruebas } from './entorno-pruebas.mjs'

const backend = fileURLToPath(new URL('../', import.meta.url))
const comprobar = process.argv.includes('--comprobar')
const opcionPuerto = process.argv.find(v => v.startsWith('--puerto='))?.slice(9)
const solicitado = opcionPuerto === undefined ? (comprobar ? 0 : 3100) : Number(opcionPuerto)
if (!Number.isInteger(solicitado) || solicitado < 0 || solicitado > 65535) throw new Error('Puerto inválido.')
for (const archivo of ['dist/src/server.js', 'dist/src/demo.js', 'dist/src/util/trust-proxy.mjs', '../frontend/dist-real/index.html']) {
  if (!existsSync(resolve(backend, archivo))) throw new Error('Falta la build: ejecute npm --prefix backend run build:cloud.')
}

function puertoLibre(port = 0) {
  return new Promise((ok, no) => {
    const s = createServer()
    s.once('error', () => no(new Error('Puerto ocupado; elija --puerto=<otro>. No se detuvo ningún servicio.')))
    s.listen(port, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
  })
}
function pedirClave() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Inicie demo:local en una terminal interactiva; --comprobar sólo verifica y termina.')
  process.stdout.write('Contraseña NUEVA para esta demo (mínimo 16 caracteres; no se muestra): ')
  return new Promise((ok, no) => {
    let texto = ''
    process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume()
    const terminar = () => { process.stdin.off('data', recibir); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n') }
    const recibir = (parte) => {
      for (const c of parte) {
        if (c === '\u0003') { terminar(); no(new Error('Presentación cancelada.')); return }
        if (c === '\r' || c === '\n') { terminar(); ok(texto); return }
        if (c === '\u007f' || c === '\b') texto = texto.slice(0, -1)
        else if (c >= ' ') texto += c
      }
    }
    process.stdin.on('data', recibir)
  })
}

const puertoWeb = await puertoLibre(solicitado)
const claveDemo = comprobar ? randomBytes(24).toString('base64url') : await pedirClave()
if (claveDemo.length < 16) throw new Error('Contraseña demasiado corta; no se inició ninguna base.')
const puertoPg = await puertoLibre()
const carpeta = mkdtempSync(join(tmpdir(), 'agro-presentacion-'))
const password = randomBytes(32).toString('hex')
const url = new URL(`postgresql://127.0.0.1:${puertoPg}/agro_presentacion`)
url.username = 'postgres'; url.password = password
const env = entornoPruebas({ DB_MOTOR: 'postgres', DATABASE_URL: url.toString(), HOST: '127.0.0.1', PORT: String(puertoWeb),
  SERVIR_FRONTEND: fileURLToPath(new URL('../../frontend/dist-real/', import.meta.url)), LIMITES_DESACTIVADOS: 'false',
  CORS_ORIGENES: `http://localhost:${puertoWeb},http://127.0.0.1:${puertoWeb}` })
const cluster = new EmbeddedPostgres({ databaseDir: join(carpeta, 'data'), user: 'postgres', password, port: puertoPg,
  persistent: true, authMethod: 'scram-sha-256', initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {} })
let cliente, servidor, sembrador, salidaServidor, limpieza
let etapa = 'inicialización PostgreSQL'
function cerrarHijo(hijo) {
  if (!hijo || hijo.exitCode !== null || hijo.signalCode !== null) return Promise.resolve()
  return new Promise(r => { hijo.once('exit', r); hijo.kill('SIGTERM') })
}
async function limpiar() {
  if (limpieza) return limpieza
  limpieza = (async () => {
    await cerrarHijo(sembrador); await cerrarHijo(servidor)
    await cliente?.end().catch(() => {})
    await cluster.stop().catch(() => {})
    const absoluta = resolve(carpeta)
    if (!absoluta.startsWith(resolve(tmpdir()) + sep) || !absoluta.split(sep).at(-1).startsWith('agro-presentacion-')) throw new Error('Directorio temporal fuera de alcance.')
    rmSync(absoluta, { recursive: true, force: true })
  })()
  return limpieza
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await limpiar(); console.log('Demo detenida; datos temporales eliminados.'); process.exit(0) })

try {
  console.log('Preparando demo aislada en loopback. MySQL real y hardware no se utilizan.')
  await cluster.initialise(); await cluster.start()
  const opciones = { host: '127.0.0.1', port: puertoPg, user: 'postgres', password }
  cliente = new pg.Client({ ...opciones, database: 'postgres' }); await cliente.connect()
  const version = await cliente.query('SHOW server_version_num')
  assert.ok(String(version.rows[0].server_version_num).startsWith('17'))
  await cliente.query('CREATE DATABASE agro_presentacion'); await cliente.end()
  etapa = 'importación del esquema temporal'
  cliente = new pg.Client({ ...opciones, database: 'agro_presentacion' }); await cliente.connect()
  await cliente.query('BEGIN')
  await cliente.query(readFileSync(new URL('../../database/postgres/schema.sql', import.meta.url), 'utf8'))
  await cliente.query('COMMIT')
  etapa = 'seed ficticio'
  sembrador = spawn(process.execPath, [join(backend, 'dist/scripts/seed-demo.js'), '--aplicar', '--confirmar-host=127.0.0.1'], {
    cwd: backend, env: { ...env, DEMO_ADMIN_CONTRASENA: claveDemo }, stdio: 'ignore',
  })
  assert.equal(await new Promise(r => { sembrador.once('error', () => r(1)); sembrador.once('exit', r) }), 0, 'No se pudo crear la demo.')
  etapa = 'arranque compilado y salud'
  servidor = spawn(process.execPath, [join(backend, 'dist/src/server.js')], { cwd: backend, env, stdio: 'ignore' })
  salidaServidor = new Promise(r => { servidor.once('error', () => r(1)); servidor.once('exit', r) })
  const base = `http://127.0.0.1:${puertoWeb}`
  let listo = false
  for (let i = 0; i < 100; i++) {
    if (servidor.exitCode !== null) throw new Error('El backend compilado no arrancó.')
    try { if ((await fetch(base + '/api/v1/salud')).status === 200) { listo = true; break } } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  assert.ok(listo, 'El backend no respondió a salud.')
  assert.equal((await fetch(base + '/', { headers: { Accept: 'text/html' } })).status, 200)
  etapa = 'login ficticio'
  const login = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.invalid', password: claveDemo }) })
  assert.equal(login.status, 200, 'Login de la demo falló.')
  const cookie = login.headers.get('set-cookie')
  for (const atributo of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/v1/auth']) assert.ok(cookie.includes(atributo))
  const sesion = (await login.json()).data.token_acceso
  etapa = 'autorización del panel y rechazo de encendido'
  const terrenos = await fetch(base + '/api/v1/terrenos', { headers: { Authorization: `Bearer ${sesion}` } })
  assert.equal(terrenos.status, 200)
  const terreno = (await terrenos.json()).data[0].id
  const equipos = await fetch(base + `/api/v1/terrenos/${terreno}/dispositivos`, { headers: { Authorization: `Bearer ${sesion}` } })
  const equipo = (await equipos.json()).data[0].id
  const orden = await fetch(base + `/api/v1/dispositivos/${equipo}/ordenes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesion}` }, body: JSON.stringify({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } }) })
  assert.equal(orden.status, 409); assert.equal((await orden.json()).error.codigo, 'ENCENDIDO_DESHABILITADO')
  etapa = 'refresh y logout'
  const refresco = await fetch(base + '/api/v1/auth/refresh', { method: 'POST', headers: { Cookie: cookie.split(';')[0] } })
  assert.equal(refresco.status, 200)
  const cierre = await fetch(base + '/api/v1/auth/logout', { method: 'POST', headers: { Cookie: refresco.headers.get('set-cookie').split(';')[0] } })
  assert.equal(cierre.status, 200)
  assert.equal(Number((await cliente.query('SELECT COUNT(*) AS n FROM ordenes_riego')).rows[0].n), 0)
  if (comprobar && process.argv.includes('--navegador')) {
    etapa = 'navegador local con cookies'
    const { comprobarNavegador } = await import('./verificar-demo-navegador.mjs')
    await comprobarNavegador({ base: `http://localhost:${puertoWeb}`, password: claveDemo })
  }
  console.log('PASS: H-06, arranque compilado, SPA, login, permisos, refresh/logout y rechazo de encendido; cero órdenes creadas.')
  if (!comprobar) {
    console.log(`Presentación integrada: http://localhost:${puertoWeb}`)
    console.log('Usuario ficticio: admin@demo.invalid. Use la contraseña que acaba de elegir.')
    console.log('API con datos sintéticos y equipo ficticio desconectado. Mantenga esta terminal abierta; Ctrl+C termina y elimina la demo.')
    const salida = await salidaServidor
    if (salida) throw new Error('El backend de presentación terminó con error.')
  }
} catch (e) {
  console.error(`No se completó la demo local: ${etapa} (${e.code ?? 'ERROR_LOCAL'}). No se tocaron bases reales ni se muestran secretos.`)
  process.exitCode = 1
} finally { await limpiar() }
