import { fileURLToPath } from 'node:url'

// Preparación del proceso; no se ejecuta durante las pruebas de build.
if (process.env.PERMITIR_ENCENDIDO && process.env.PERMITIR_ENCENDIDO !== 'false') {
  throw new Error('El perfil cloud requiere PERMITIR_ENCENDIDO=false.')
}
process.env.PERMITIR_ENCENDIDO = 'false'
process.env.NODE_ENV = 'production'
process.env.HOST = '0.0.0.0'
process.env.SERVIR_FRONTEND = fileURLToPath(new URL('../../frontend/dist-real/', import.meta.url))
await import('../dist/src/server.js')
