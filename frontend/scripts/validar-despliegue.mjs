import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function validarDespliegue(configuracion, vercel = process.env.VERCEL, render = process.env.RENDER) {
  if (vercel !== '1' && render !== 'true') return
  const valores = []
  function recorrer(valor) {
    if (typeof valor === 'string') valores.push(valor)
    else if (valor && typeof valor === 'object') Object.values(valor).forEach(recorrer)
  }
  recorrer(configuracion)
  if (valores.some((v) => /\.example\b|\bexample\.(?:com|org|net)\b|BACKEND_DOMINIO_PENDIENTE/i.test(v))) {
    throw new Error('Despliegue bloqueado: sustituya los dominios de ejemplo en frontend/vercel.json por el backend HTTPS definitivo.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const configuracion = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    validarDespliegue(configuracion)
    console.log(process.env.VERCEL === '1' ? 'PASS: configuración sin dominios de ejemplo.' : 'Validación de dominios reservada a VERCEL=1; desarrollo local sin cambios.')
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}
