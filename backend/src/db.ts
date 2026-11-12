import mysql, { type Pool as MysqlPool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
import pg, { type Pool as PgPool, type PoolClient } from 'pg'
import { config } from './config.js'
import { enteroSeguro, marcadoresPostgres, quitarReturning } from './util/sql.js'

// Parsers por pool, sin alterar otros consumidores de pg.
const tipos = { getTypeParser(oid: number, formato?: string) {
  if (oid === 20) return enteroSeguro
  if (oid === 1700) return (s: string) => {
    const n = Number(s)
    if (!Number.isFinite(n)) throw new Error('Numeric de BD no finito')
    return n
  }
  return pg.types.getTypeParser(oid, formato as 'text')
} }
export type Fila = Record<string, any>
export interface Resultado { affectedRows: number; insertId: number }
export interface Con { readonly motor: 'mysql' | 'postgres'; readonly raw: MysqlPool | PoolConnection | PgPool | PoolClient }
export type ConTx = Con
let pool: Con | null = null
export function sqlPorMotor(sql: { mysql: string; postgres: string }): string { return sql[config().DB_MOTOR] }

/** La URL no puede sustituir el objeto TLS verificado. No registrar estas opciones. */
export function opcionesPostgres(c = config()): pg.PoolConfig {
  const url = new URL(c.DATABASE_URL!)
  for (const clave of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(clave)
  return {
    connectionString: url.toString(), max: c.PG_POOL_MAX, types: tipos,
    connectionTimeoutMillis: c.PG_CONNECTION_TIMEOUT_MS,
    ssl: c.DB_SSL ? { rejectUnauthorized: true, ...(c.DB_SSL_CA ? { ca: c.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) } : false,
  }
}
const inicializadas = new WeakSet<PoolClient>()
async function inicializarPg(client: PoolClient) {
  if (inicializadas.has(client)) return
  const c = config()
  await client.query("SET TimeZone='UTC'")
  await client.query(`SET statement_timeout=${c.PG_STATEMENT_TIMEOUT_MS}`)
  await client.query(`SET lock_timeout=${c.PG_LOCK_TIMEOUT_MS}`)
  inicializadas.add(client)
}
async function consultaPg(con: Con, sql: string, params: unknown[]) {
  if (!(con.raw instanceof pg.Pool)) return (con.raw as PoolClient).query(marcadoresPostgres(sql), params)
  const client = await con.raw.connect()
  let lista = false
  try {
    await inicializarPg(client); lista = true
    return await client.query(marcadoresPostgres(sql), params)
  } finally { client.release(!lista) }
}
export function bd(): Con {
  if (pool) return pool
  const c = config()
  if (c.DB_MOTOR === 'postgres') {
    const raw = new pg.Pool(opcionesPostgres(c))
    raw.on('error', () => console.error('Conexión PostgreSQL inactiva cerrada.'))
    pool = { motor: 'postgres', raw }
  } else {
    const raw = mysql.createPool({ host: c.DB_HOST, port: c.DB_PUERTO, user: c.DB_USUARIO,
      password: c.DB_CONTRASENA, database: c.DB_NOMBRE,
      ssl: c.DB_SSL ? { rejectUnauthorized: true, ...(c.DB_SSL_CA ? { ca: c.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) } : undefined,
      connectTimeout: 10000, timezone: 'Z', connectionLimit: 10, charset: 'utf8mb4', supportBigNumbers: true, decimalNumbers: true,
    })
    raw.on('connection', (con) => { con.query("SET time_zone = '+00:00'") })
    pool = { motor: 'mysql', raw }
  }
  return pool
}
export async function cerrarBd() { const anterior = pool; pool = null; if (anterior) await (anterior.raw as MysqlPool | PgPool).end() }
export async function filas<T = Fila>(con: Con, sql: string, params: unknown[] = []): Promise<T[]> {
  if (con.motor === 'postgres') return (await consultaPg(con, sql, params)).rows as T[]
  const [r] = await (con.raw as MysqlPool).query<RowDataPacket[]>(quitarReturning(sql), params)
  return r as T[]
}
export async function fila<T = Fila>(con: Con, sql: string, params: unknown[] = []): Promise<T | null> { return (await filas<T>(con, sql, params))[0] ?? null }
export async function ejecutar(con: Con, sql: string, params: unknown[] = []): Promise<Resultado> {
  if (con.motor === 'postgres') {
    const r = await consultaPg(con, sql, params)
    return { affectedRows: r.rowCount ?? 0, insertId: /\sRETURNING\s+id\s*;?\s*$/i.test(sql) ? r.rows[0]?.id ?? 0 : 0 }
  }
  const [r] = await (con.raw as MysqlPool).query<ResultSetHeader>(quitarReturning(sql), params)
  return { affectedRows: r.affectedRows, insertId: r.insertId }
}
export async function transaccion<T>(fn: (con: ConTx) => Promise<T>): Promise<T> {
  const p = bd()
  for (let intento = 1; ; intento++) {
    const raw = p.motor === 'mysql' ? await (p.raw as MysqlPool).getConnection() : await (p.raw as PgPool).connect()
    const con: Con = { motor: p.motor, raw }
    try {
      if (p.motor === 'postgres') await inicializarPg(raw as PoolClient)
      await ejecutar(con, p.motor === 'mysql' ? 'START TRANSACTION' : 'BEGIN ISOLATION LEVEL READ COMMITTED')
      const resultado = await fn(con)
      await ejecutar(con, 'COMMIT')
      return resultado
    } catch (e) {
      await ejecutar(con, 'ROLLBACK').catch(() => undefined)
      const codigo = (e as { code?: string }).code ?? ''
      const repetir = p.motor === 'mysql' ? ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'] : ['40P01', '40001']
      if (!repetir.includes(codigo) || intento >= 3) throw e
    } finally { raw.release() }
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 80))
  }
}
export async function bloquearDispositivo(con: ConTx, dispositivoId: number) {
  const d = await fila(con, 'SELECT id, terreno_id, uid, estado, id_arranque_actual, config_version_deseada, config_version_aplicada, hardware_confirmado, tope_riego_s, ultima_conexion_en FROM dispositivos WHERE id = ? FOR UPDATE', [dispositivoId])
  if (!d) throw new Error('Dispositivo no encontrado al bloquear')
  return d
}
