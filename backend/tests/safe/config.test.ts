import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config, reiniciarConfig } from '../../src/config.js'

const original = { ...process.env }
beforeEach(() => {
  process.env = { NODE_ENV: 'production', DB_MOTOR: 'mysql', DB_USUARIO: 'sintetico', JWT_SECRETO: 'prueba-config-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', PERMITIR_ENCENDIDO: 'false' }
  reiniciarConfig()
})
afterEach(() => { process.env = { ...original }; reiniciarConfig() })

describe('configuración real sin dotenv ni BD', () => {
  it.each(['1', 'true', 'false', '0.0.0.0/0', '::/0', '10.0.0.0/33', 'loopback,', 'localhost', '', 'saltos:0', 'saltos:4', 'saltos:01'])('rechaza proxy inseguro %s', (valor) => {
    process.env.TRUST_PROXY = valor
    expect(() => config()).toThrow(/TRUST_PROXY/)
  })
  it.each(['loopback', '127.0.0.1', '10.20.0.0/16', '::1/128', ' loopback,10.0.0.1/32 '])('admite proxy concreto %s', (valor) => {
    process.env.TRUST_PROXY = valor
    expect(Array.isArray(config().TRUST_PROXY)).toBe(true)
  })
  it.each([1, 2, 3])('admite saltos:%i explícitos', (n) => { process.env.TRUST_PROXY = `saltos:${n}`; expect(config().TRUST_PROXY).toBe(n) })
  it('PORT tiene prioridad y producción mantiene las barreras de seguridad', () => {
    Object.assign(process.env, { PORT: '4321', PUERTO: '3000', HOST: '0.0.0.0', IOT_PERMITIR_HTTP_LOCAL: 'true', LIMITES_DESACTIVADOS: 'true' })
    expect(config()).toMatchObject({ PUERTO: 4321, HOST: '0.0.0.0', PERMITIR_ENCENDIDO: false, IOT_PERMITIR_HTTP_LOCAL: false, LIMITES_DESACTIVADOS: false, SERVIR_FRONTEND: '' })
  })
})
