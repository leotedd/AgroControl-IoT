import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config, reiniciarConfig } from '../../src/config.js'
import { opcionesPostgres } from '../../src/db.js'
const original = { ...process.env }
beforeEach(() => {
  process.env = { NODE_ENV: 'test', DB_MOTOR: 'postgres', DATABASE_URL: 'postgresql://' + 'usuario:prueba' + '@127.0.0.1:5432/temporal', JWT_SECRETO: 'prueba-config-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', PERMITIR_ENCENDIDO: 'false' }
  reiniciarConfig()
})
afterEach(() => { process.env = original; reiniciarConfig() })
describe('V-ISO guardas y TLS sin conectar', () => {
  it('MySQL sigue siendo el motor por defecto fuera de producción', () => {
    delete process.env.DB_MOTOR; process.env.DB_USUARIO = 'sintetico'
    expect(config().DB_MOTOR).toBe('mysql')
  })
  it('producción requiere selección de motor explícita', () => {
    process.env.NODE_ENV = 'production'; delete process.env.DB_MOTOR
    expect(() => config()).toThrow(/DB_MOTOR/)
  })
  it.each(['postgresql://' + 'x:y' + '@remoto.invalid/demo', 'mysql://x:y@localhost/demo', 'cadena-invalida'])('rechaza URL no permitida en pruebas', (url) => {
    process.env.DATABASE_URL = url
    try { config(); expect.fail('Debe rechazar') } catch (e) { expect((e as Error).message).not.toContain(url) }
  })
  it('rechaza MySQL remoto antes de crear pool', () => {
    Object.assign(process.env, { DB_MOTOR: 'mysql', DB_USUARIO: 'sintetico', DB_HOST: 'remoto.invalid' })
    expect(() => config()).toThrow(/DB_HOST/)
  })
  it('TLS explícito prevalece sobre sslmode de URL; conserva timeouts y UTC', () => {
    process.env.DATABASE_URL += '?sslmode=disable'; process.env.DB_SSL = 'true'
    process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\\nfixture-no-certificado\\n-----END CERTIFICATE-----'
    const r = opcionesPostgres()
    expect(r.connectionString).not.toContain('sslmode')
    expect(r.ssl).toMatchObject({ rejectUnauthorized: true })
    // La configuración de sesión se aplica mediante SET, sin opciones de inicio dependientes del pooler.
    expect(r.options).toBeUndefined()
    expect(config().PG_STATEMENT_TIMEOUT_MS).toBe(10000)
    expect(r.max).toBe(5)
  })
  it('diagnóstico de producción exige caducidad futura no mayor a 24 h', () => {
    Object.assign(process.env, { NODE_ENV: 'production', DB_MOTOR: 'mysql', DB_USUARIO: 'sintetico', DIAGNOSTICO_PROXY: 'true' })
    expect(() => config()).toThrow(/DIAGNOSTICO_PROXY_HASTA/)
    process.env.DIAGNOSTICO_PROXY_HASTA = new Date(Date.now() + 3600000).toISOString(); reiniciarConfig()
    expect(config().DIAGNOSTICO_PROXY).toBe(true)
  })
})
