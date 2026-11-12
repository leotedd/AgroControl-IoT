// Prueba sin MySQL ni lectura de .env. Ejecutar después de npm run build.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { config, reiniciarConfig } from '../dist/src/config.js'

const anterior = { ...process.env }
try {
  Object.assign(process.env, {
    NODE_ENV: 'production', DB_MOTOR: 'mysql', PORT: '4321', PUERTO: '3000', HOST: '0.0.0.0',
    DB_USUARIO: 'prueba', JWT_SECRETO: randomBytes(48).toString('base64url'),
    PERMITIR_ENCENDIDO: 'false', IOT_PERMITIR_HTTP_LOCAL: 'true', LIMITES_DESACTIVADOS: 'true',
    DB_SSL: 'true', TRUST_PROXY: 'loopback,10.20.30.0/24',
  })
  reiniciarConfig()
  const c = config()
  assert.equal(c.PUERTO, 4321)
  assert.equal(c.HOST, '0.0.0.0')
  assert.equal(c.DB_SSL, true)
  assert.equal(c.IOT_PERMITIR_HTTP_LOCAL, false)
  assert.equal(c.LIMITES_DESACTIVADOS, false)
  assert.equal(c.PERMITIR_ENCENDIDO, false)
  assert.deepEqual(c.TRUST_PROXY, ['loopback', '10.20.30.0/24'])
  delete process.env.PORT
  reiniciarConfig()
  assert.equal(config().PUERTO, 3000)
  process.env.PORT = 'invalido'
  reiniciarConfig()
  assert.throws(() => config(), /Configuración inválida/)
  console.log('PASS: PORT, PUERTO, HOST, TLS MySQL, proxy y barreras de producción (sin BD).')
} finally {
  process.env = anterior
  reiniciarConfig()
}
