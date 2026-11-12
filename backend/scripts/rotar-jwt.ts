// Sustituye JWT_SECRETO en backend/.env por uno aleatorio nuevo (48 bytes, base64url).
//   npm run secreto:jwt
// Nunca muestra el valor anterior ni el nuevo. Modifica sólo esa línea (y vacía
// SEED_ADMIN_CONTRASENA si aún tiene valor: tras el seed ya no se usa).
// Reinicie el backend después: las sesiones abiertas tendrán que iniciar sesión de nuevo.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ruta = fileURLToPath(new URL('../.env', import.meta.url))
if (!existsSync(ruta)) {
  console.error('No existe backend/.env')
  process.exit(1)
}

const original = readFileSync(ruta, 'utf8')
const salto = original.includes('\r\n') ? '\r\n' : '\n'
let jwt = false
let seed = false
const lineas = original.split(/\r?\n/).map((l) => {
  if (/^\s*JWT_SECRETO\s*=/.test(l)) {
    jwt = true
    return `JWT_SECRETO=${randomBytes(48).toString('base64url')}`
  }
  if (/^\s*SEED_ADMIN_CONTRASENA\s*=\s*\S/.test(l)) {
    seed = true
    return 'SEED_ADMIN_CONTRASENA='
  }
  return l
})
if (!jwt) lineas.push(`JWT_SECRETO=${randomBytes(48).toString('base64url')}`)

// Escribe sobre el mismo archivo: conserva sus permisos restringidos.
writeFileSync(ruta, lineas.join(salto), 'utf8')
console.log(`JWT_SECRETO ${jwt ? 'sustituido' : 'añadido'} (64 caracteres; no se muestra).`)
if (seed) console.log('SEED_ADMIN_CONTRASENA vaciada (ya no se necesita tras el seed).')
console.log('Reinicie el backend para aplicar el cambio.')
