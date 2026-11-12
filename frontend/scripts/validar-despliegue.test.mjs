import assert from 'node:assert/strict'
import { validarDespliegue } from './validar-despliegue.mjs'

const config = (destination) => ({ rewrites: [{ source: '/api/:path*', destination }] })
for (const domain of ['api.agrocontrol.example', 'API.AGROCONTROL.EXAMPLE', 'example.com', 'api.example.org', 'example.net', 'BACKEND_DOMINIO_PENDIENTE']) {
  assert.throws(() => validarDespliegue(config(`https://${domain}/api/:path*`), '1'), /Despliegue bloqueado/)
}
assert.doesNotThrow(() => validarDespliegue(config('https://api.agrocontrol.example/api/:path*'), '0'))
assert.doesNotThrow(() => validarDespliegue(config('https://agrocontrol-production.up.railway.app/api/:path*'), '1'))
assert.doesNotThrow(() => validarDespliegue(config('https://presentacion.trycloudflare.com/api/:path*'), '1'))
assert.throws(() => validarDespliegue({ nested: { value: 'https://api.agrocontrol.example' } }, '1'), /Despliegue bloqueado/)


assert.throws(() => validarDespliegue(config('https://api.agrocontrol.example/api/:path*'), '0', 'true'), /Despliegue bloqueado/)

console.log('PASS: 11 casos de dominios; guard Vercel/Render y acceso trycloudflare.com.')
