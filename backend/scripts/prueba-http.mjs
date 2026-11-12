// Pruebas HTTP con datos existentes: sólo SELECT; sin telemetría, órdenes ni ACK ficticios.
import 'dotenv/config'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { crearApp } from '../dist/src/app.js'
import { config } from '../dist/src/config.js'
import { bd, fila, cerrarBd } from '../dist/src/db.js'

process.env.PERMITIR_ENCENDIDO = 'false'
const servidor = crearApp().listen(0, '127.0.0.1')
await new Promise((resolve, reject) => { servidor.once('listening', resolve); servidor.once('error', reject) })
const base = `http://127.0.0.1:${servidor.address().port}/api/v1`
let total = 0
async function comprobar(ruta, estado, opciones = {}) {
  const r = await fetch(base + ruta, opciones)
  assert.equal(r.status, estado, `${opciones.method ?? 'GET'} ${ruta}`)
  const cuerpo = estado === 204 ? null : await r.json()
  assert.ok(r.headers.get('x-request-id'))
  total++
  console.log(`[OK] ${opciones.method ?? 'GET'} ${ruta}: ${estado}`)
  return { r, cuerpo }
}
try {
  await comprobar('/salud', 200)
  for (const ruta of ['/auth/me', '/terrenos', '/dispositivos/1/estado', '/sensores/1/mediciones', '/dispositivos/1/ordenes', '/zonas/1/riegos']) await comprobar(ruta, 401)
  await comprobar('/auth/me', 401, { headers: { Authorization: 'Bearer invalido' } })
  await comprobar('/auth/refresh', 401, { method: 'POST' })
  await comprobar('/auth/refresh', 401, { method: 'POST', headers: { Cookie: 'agc_refresh=j%3A%7B%22x%22%3A1%7D' } })
  await comprobar('/auth/login', 422, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  await comprobar('/auth/login', 400, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
  await comprobar('/iot/ordenes', 403)
  await comprobar('/iot/ordenes', 401, { headers: { 'X-Forwarded-Proto': 'https' } })
  await comprobar('/salud', 403, { headers: { Origin: 'https://no-autorizado.invalid' } })
  const origen = config().CORS_ORIGENES[0]
  if (origen) {
    const { r } = await comprobar('/auth/login', 204, { method: 'OPTIONS', headers: { Origin: origen, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } })
    assert.equal(r.headers.get('access-control-allow-origin'), origen)
    assert.equal(r.headers.get('access-control-allow-credentials'), 'true')
    await comprobar('/auth/login', 403, { method: 'OPTIONS', headers: { Origin: origen, 'Access-Control-Request-Method': 'DELETE' } })
  }
  // JWT local de prueba: no cambia contraseña ni crea sesiones en la BD.
  const u = await fila(bd(), "SELECT id, rol, nombre FROM usuarios WHERE activo = 1 AND rol = 'ADMIN' LIMIT 1")
  if (!u) throw new Error('Falta un administrador activo para comprobar las consultas autenticadas')
  const headers = { Authorization: `Bearer ${jwt.sign({ sub: u.id, rol: u.rol, nombre: u.nombre }, config().JWT_SECRETO, { algorithm: 'HS256', expiresIn: 60 })}` }
  for (const ruta of ['/auth/me', '/terrenos', '/alertas']) await comprobar(ruta, 200, { headers })
  const d = await fila(bd(), 'SELECT id, terreno_id FROM dispositivos ORDER BY id LIMIT 1')
  if (d) {
    await comprobar(`/terrenos/${d.terreno_id}/dispositivos`, 200, { headers })
    for (const sufijo of ['estado', 'ordenes', 'eventos']) await comprobar(`/dispositivos/${d.id}/${sufijo}`, 200, { headers })
    await comprobar(`/dispositivos/${d.id}/ordenes?limite=1.5`, 422, { headers })
    await comprobar(`/dispositivos/${d.id}/ordenes?limite=2`, 200, { headers })
    const s = await fila(bd(), 'SELECT id, zona_id FROM sensores WHERE dispositivo_id = ? LIMIT 1', [d.id])
    if (s) {
      await comprobar(`/sensores/${s.id}/mediciones`, 200, { headers })
      await comprobar(`/sensores/${s.id}/mediciones?agrupacion=5m`, 200, { headers })
      if (s.zona_id) await comprobar(`/zonas/${s.zona_id}/riegos`, 200, { headers })
    }
    const o = await fila(bd(), 'SELECT id FROM ordenes_riego WHERE dispositivo_id = ? LIMIT 1', [d.id])
    if (o) await comprobar(`/ordenes/${o.id}`, 200, { headers })
  }
  console.log(`${total} solicitudes HTTP verificadas; sin escrituras en MySQL ni comandos físicos.`)
} finally {
  await new Promise((resolve) => servidor.close(resolve))
  await cerrarBd()
}
