import { humoTemporal } from './humo-temporal.mjs'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { createServer } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { entornoPruebas } from './entorno-pruebas.mjs'

const raiz = fileURLToPath(new URL('../', import.meta.url))
const carpeta = mkdtempSync(join(tmpdir(), 'agro-pg-prueba-'))
const puerto = await new Promise((ok, no) => { const s = createServer(); s.once('error', no); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const password = randomBytes(32).toString('hex')
function urlTemporal(base) { const u = new URL(`postgresql://127.0.0.1:${puerto}/${base}`); u.username = 'postgres'; u.password = password; return u.toString() }
const cluster = new EmbeddedPostgres({ databaseDir: join(carpeta, 'data'), user: 'postgres', password, port: puerto, persistent: true, authMethod: 'scram-sha-256', initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {} })
let cliente, hijo, finalizando
async function limpiar() {
  if (finalizando) return finalizando
  finalizando = (async () => {
    if (hijo && hijo.exitCode === null) { hijo.kill(); await new Promise((r) => hijo.once('exit', r)) }
    await cliente?.end().catch(() => {})
    await cluster.stop().catch(() => {})
    const absoluta = resolve(carpeta)
    if (absoluta.startsWith(resolve(tmpdir()) + sep) && absoluta.split(sep).at(-1).startsWith('agro-pg-prueba-')) rmSync(absoluta, { recursive: true, force: true })
  })()
  return finalizando
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await limpiar(); process.exit(130) })
let codigo = 1
try {
  await cluster.initialise(); await cluster.start()
  cliente = new pg.Client({ host: '127.0.0.1', port: puerto, user: 'postgres', password, database: 'postgres' })
  await cliente.connect()
  const v = await cliente.query('SHOW server_version_num')
  if (!String(v.rows[0].server_version_num).startsWith('17')) throw new Error('Versión PostgreSQL distinta de 17')
  await cliente.query('CREATE DATABASE agro_pruebas')
  await cliente.end()
  cliente = new pg.Client({ host: '127.0.0.1', port: puerto, user: 'postgres', password, database: 'agro_pruebas' })
  await cliente.connect()
  await cliente.query('BEGIN')
  await cliente.query(readFileSync(new URL('../../database/postgres/schema.sql', import.meta.url), 'utf8'))
  await cliente.query('COMMIT')
  // Una segunda base temporal permite verificar el seed sin contaminar fixtures.
  await cliente.query('CREATE DATABASE agro_demo_pruebas')
  const demoClient = new pg.Client({ host: '127.0.0.1', port: puerto, user: 'postgres', password, database: 'agro_demo_pruebas' })
  await demoClient.connect()
  try { await demoClient.query('BEGIN'); await demoClient.query(readFileSync(new URL('../../database/postgres/schema.sql', import.meta.url), 'utf8')); await demoClient.query('COMMIT') } finally { await demoClient.end() }
  const demoEnv = entornoPruebas({ DB_MOTOR: 'postgres', DATABASE_URL: urlTemporal('agro_demo_pruebas') })
  hijo = spawn(process.execPath, [join(raiz, 'node_modules/tsx/dist/cli.mjs'), 'scripts/comprobar-demo.ts'], { cwd: raiz, env: demoEnv, stdio: 'inherit' })
  const demoCodigo = await new Promise((r) => { hijo.once('error', () => r(1)); hijo.once('exit', (c) => r(c ?? 1)) })
  if (demoCodigo !== 0) throw new Error('Falló el ensayo de seed idempotente')
  const env = entornoPruebas({ DB_MOTOR: 'postgres', DATABASE_URL: urlTemporal('agro_pruebas') })
  await humoTemporal(env)
  console.log('[pruebas] PostgreSQL 17 temporal: esquema importado; sólo loopback.')
  hijo = spawn(process.execPath, [join(raiz, 'node_modules/vitest/vitest.mjs'), 'run', ...process.argv.slice(2)], { cwd: raiz, env, stdio: 'inherit' })
  codigo = await new Promise((r) => { hijo.once('error', () => r(1)); hijo.once('exit', (c) => r(c ?? 1)) })
} catch (e) { console.error('[pruebas pg]', e.code ?? 'FALLO', e.message?.replace(/postgres(?:ql)?:\/\/\S+/g, '[URL omitida]')); }
finally { await limpiar() }
process.exitCode = codigo
