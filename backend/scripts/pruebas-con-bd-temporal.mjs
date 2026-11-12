import { humoTemporal } from './humo-temporal.mjs'
// Ejecuta las pruebas del backend contra una instancia MySQL TEMPORAL y AISLADA:
// datos en una carpeta temporal, puerto libre, sin servicio. Nunca usa el servidor
// MySQL del usuario ni su base `agrocontrol`. Al terminar la apaga y la borra.
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { entornoPruebas } from './entorno-pruebas.mjs'

const raiz = resolve(import.meta.dirname, '..')
const esquema = resolve(raiz, '..', 'database', 'schema.sql')

function binarios() {
  if (process.env.MYSQL_BIN) return process.env.MYSQL_BIN
  const base = 'C:\\Program Files\\MySQL'
  const dir = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('MySQL Server')).sort().reverse()[0] : null
  if (!dir) throw new Error('No se encontró MySQL Server. Defina MYSQL_BIN con la carpeta bin.')
  return join(base, dir, 'bin')
}

const puertoLibre = () =>
  new Promise((res) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const bin = binarios()
const ext = process.platform === 'win32' ? '.exe' : ''
const mysqld = join(bin, `mysqld${ext}`)
const mysql = join(bin, `mysql${ext}`)
const basedir = resolve(bin, '..')
const datos = mkdtempSync(join(tmpdir(), 'agro-prueba-'))
const puerto = await puertoLibre()
const cli = ['--no-defaults', '-h', '127.0.0.1', '-P', String(puerto), '-u', 'root']
let servidor = null
let codigo = 1
let pruebas = null
let limpieza = null
async function limpiar() {
  if (limpieza) return limpieza
  limpieza = (async () => {
    if (pruebas && pruebas.exitCode === null) { pruebas.kill(); await new Promise(r=>pruebas.once('exit',r)) }
    if (servidor && servidor.exitCode === null) {
      spawnSync(join(bin, `mysqladmin${ext}`), [...cli, 'shutdown'])
      await new Promise(r => servidor.exitCode !== null ? r() : servidor.once('exit',r))
    }
    const absoluto = resolve(datos)
    if (!absoluto.startsWith(resolve(tmpdir()) + sep) || !absoluto.split(sep).at(-1).startsWith('agro-prueba-')) throw new Error('Directorio temporal fuera de alcance')
    rmSync(absoluto, { recursive: true, force: true })
  })()
  return limpieza
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await limpiar();process.exit(130)})

try {
  console.log(`[pruebas] MySQL temporal en ${datos} (puerto ${puerto})`)
  const ini = spawnSync(mysqld, ['--no-defaults', '--initialize-insecure', `--basedir=${basedir}`, `--datadir=${join(datos, 'd')}`], { encoding: 'utf8' })
  if (ini.status !== 0) throw new Error(`initialize falló:\n${ini.error?.message ?? ini.stderr ?? 'sin diagnóstico'}`)
  servidor = spawn(mysqld, ['--no-defaults', `--basedir=${basedir}`, `--datadir=${join(datos, 'd')}`, `--port=${puerto}`, '--bind-address=127.0.0.1', '--mysqlx=OFF', ...(process.platform === 'win32' ? ['--enable-named-pipe=OFF', '--shared-memory=OFF'] : [`--socket=${join(datos, 's.sock')}`])], { stdio: 'ignore' })
  let listo = false
  for (let i = 0; i < 120 && !listo; i++) {
    await esperar(500)
    listo = spawnSync(mysql, [...cli, '-e', 'SELECT 1']).status === 0
  }
  if (!listo) throw new Error('El servidor temporal no arrancó')

  if (spawnSync(mysql, [...cli, '-e', 'CREATE DATABASE agrocontrol']).status !== 0) throw new Error('No se pudo crear la base temporal')
  const imp = await new Promise((res) => {
    const p = spawn(mysql, [...cli, '--commands', '--database=agrocontrol', '--default-character-set=utf8mb4'], { stdio: ['pipe', 'inherit', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    createReadStream(esquema).pipe(p.stdin)
    p.on('close', (c) => res({ c, err }))
  })
  if (imp.c !== 0) throw new Error(`Importación del esquema falló:\n${imp.err}`)
  console.log('[pruebas] esquema importado; ejecutando Vitest…')

  const env = entornoPruebas({ DB_PUERTO: String(puerto) })
  await humoTemporal(env)
  pruebas = spawn(process.execPath, [join(raiz, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...process.argv.slice(2)], { cwd: raiz, env, stdio: 'inherit' })
  codigo = await new Promise(r=>{pruebas.once('error',()=>r(1));pruebas.once('exit',c=>r(c??1))})
} catch (e) {
  console.error('[pruebas]', e.message)
} finally {
  await limpiar()
  console.log('[pruebas] MySQL temporal apagado y eliminado.')
  process.exitCode = codigo
}
