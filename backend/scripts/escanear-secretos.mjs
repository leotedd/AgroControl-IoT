import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const raiz = fileURLToPath(new URL('../../', import.meta.url))
const archivos = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: raiz, encoding: 'utf8' }).split('\0').filter(Boolean)
const patrones = [
  new RegExp('agc_' + 'dev_[A-Za-z0-9_-]{20,}'),
  new RegExp('postgres(ql)?' + '://[^<\\s]+:[^<\\s]+@'),
  new RegExp('-----BEGIN ' + '(RSA |EC )?PRIVATE KEY'),
  new RegExp('JWT_' + 'SECRETO=[^<\\s]'), new RegExp('DB_' + 'CONTRASENA=[^<\\s]'),
  new RegExp('ey' + 'J[A-Za-z0-9_-]{20,}\\.'),
]
let cantidad = 0
for (const archivo of new Set(archivos)) {
  const bytes = readFileSync(resolve(raiz, archivo))
  if (bytes.includes(0)) continue
  const lineas = bytes.toString('utf8').split(/\r?\n/)
  for (let i = 0; i < lineas.length; i++) if (patrones.some((p) => p.test(lineas[i]))) {
    console.log(`${archivo}:${i + 1}`); cantidad++
  }
}
console.log(`Escaneo: ${cantidad} hallazgos; no se imprimen valores.`)
process.exitCode = cantidad ? 1 : 0
