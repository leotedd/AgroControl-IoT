import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Se invoca con npm run build:cloud; dependencias ya instaladas por el build del proveedor.
if (!process.env.npm_execpath) throw new Error('Ejecute mediante npm run build:cloud.')
for (const [carpeta, tarea] of [['../../frontend/', 'build:real'], ['../', 'build']]) {
  const resultado = spawnSync(process.execPath, [process.env.npm_execpath, 'run', tarea], {
    cwd: fileURLToPath(new URL(carpeta, import.meta.url)), stdio: 'inherit',
  })
  if (resultado.error || resultado.status !== 0) process.exit(resultado.status || 1)
}
