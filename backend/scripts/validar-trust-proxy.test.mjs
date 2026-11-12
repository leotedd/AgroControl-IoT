import assert from 'node:assert/strict'
import { validarTrustProxy } from './validar-trust-proxy.mjs'

const validos = ['loopback', 'linklocal', 'uniquelocal', '127.0.0.1', '::1', '10.20.30.0/24', '2001:db8::/32', '::ffff:127.0.0.1', '10.0.0.1/32', '::1/128', ' loopback, 10.20.30.0/24 ']
const invalidos = ['', ' ', '1', '2', 'true', 'false', '0.0.0.0/0', '::/0', '256.1.1.1', 'localhost', 'loopback,', ',loopback', 'loopback,,::1', '10.0.0.0/33', '::1/129', '10.0.0.0/-1', '10.0.0.0/01', '10.0.0.0/', '::1/abc', '10.0.0.0/24/1', '*', true, 1, null]
for (const value of validos) assert.doesNotThrow(() => validarTrustProxy(value))
for (const value of invalidos) assert.throws(() => validarTrustProxy(value), /TRUST_PROXY/)
assert.deepEqual(validarTrustProxy(), ['loopback'])
assert.deepEqual(validarTrustProxy(' loopback, 10.20.30.0/24 '), ['loopback', '10.20.30.0/24'])
console.log(`PASS: ${validos.length + invalidos.length + 2} casos de TRUST_PROXY; validador compartido e integrado al servidor.`)
