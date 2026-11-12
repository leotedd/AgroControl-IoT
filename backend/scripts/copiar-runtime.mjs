import { copyFileSync, mkdirSync } from 'node:fs'
const destino = new URL('../dist/src/util/', import.meta.url)
mkdirSync(destino, { recursive: true })
copyFileSync(new URL('../src/util/trust-proxy.mjs', import.meta.url), new URL('trust-proxy.mjs', destino))
