import express, { type Express } from 'express'
import { statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Debe instalarse después del cierre de /api: nunca devolver HTML para una API. */
export function instalarFrontend(app: Express, directorio: string) {
  if (!directorio) return
  const base = fileURLToPath(new URL('../', import.meta.url))
  const raiz = resolve(basename(base.replace(/[\\/]$/, '')) === 'dist' ? dirname(base.replace(/[\\/]$/, '')) : base, directorio)
  try {
    if (!statSync(join(raiz, 'index.html')).isFile()) throw new Error()
  } catch {
    throw new Error('SERVIR_FRONTEND debe apuntar a un build con index.html.')
  }
  app.use(express.static(raiz, {
    index: false,
    dotfiles: 'ignore',
    setHeaders(res, archivo) {
      // Vite incluye hash en sus assets. HTML y otros archivos deben revalidarse.
      res.setHeader('Cache-Control', /[\\/]assets[\\/][^\\/]+-[\w-]{8,}\.[\w.]+$/.test(archivo)
        ? 'public, max-age=31536000, immutable' : 'no-cache')
    },
  }))
  app.get('*', (req, res, next) => {
    // Un asset perdido no debe responder index.html con 200.
    if (req.path.startsWith('/assets/') || req.path.split('/').some((p) => p.startsWith('.')) || !req.get('accept')?.includes('text/html')) return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(join(raiz, 'index.html'))
  })
}
