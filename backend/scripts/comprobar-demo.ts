import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { sembrarDemo } from '../src/demo.js'
import { config } from '../src/config.js'
import { bd, cerrarBd, fila } from '../src/db.js'
if (config().NODE_ENV !== 'test') throw new Error('Comprobación reservada a instancia temporal.')
try {
  const password = randomBytes(24).toString('base64url')
  assert.equal((await sembrarDemo(password)).creada, true)
  const antes = await fila(bd(), 'SELECT COUNT(*) AS n FROM mediciones')
  assert.equal((await sembrarDemo(password)).creada, false)
  assert.equal((await fila(bd(), 'SELECT COUNT(*) AS n FROM mediciones'))!.n, antes!.n)
  const d = await fila(bd(), "SELECT intervalo_telemetria_s,intervalo_ordenes_s,hardware_confirmado FROM dispositivos WHERE uid='AGC-DEMO-0001'")
  assert.equal(d!.intervalo_telemetria_s, 15); assert.equal(d!.intervalo_ordenes_s, 3); assert.ok(!d!.hardware_confirmado)
  assert.equal(Number((await fila(bd(),'SELECT COUNT(*) AS n FROM ordenes_riego'))!.n), 0)
  console.log('PASS: demo sintética reproducible e idempotente; sin órdenes ni hardware.')
} finally { await cerrarBd() }
