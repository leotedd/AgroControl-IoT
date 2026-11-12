import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

/** Verificación opcional: reutiliza Chromium ya instalado, nunca instala dependencias. */
export async function comprobarNavegador({ base, password }) {
  const origen = new URL(base)
  if (!['localhost', '127.0.0.1'].includes(origen.hostname)) throw new Error('Sólo se verifica loopback.')
  const require = createRequire(new URL('../../test2026/package.json', import.meta.url))
  const { chromium, expect } = require('@playwright/test')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' })
    // Sin red externa, ni siquiera para Google Fonts. La tipografía de respaldo sigue funcionando.
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origen.origin) return route.continue()
      return route.abort()
    })
    const page = await context.newPage()
    const errores = []
    page.on('pageerror', e => errores.push(e))
    await page.goto(base)
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('admin@demo.invalid')
    await page.locator('input[type=password]').fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByRole('button', { name: /Cerrar sesión/ }).first()).toBeVisible()
    const cookies = await context.cookies()
    const refresh = cookies.find(c => c.name === 'agc_refresh')
    assert.ok(refresh?.httpOnly && refresh?.secure && refresh?.sameSite === 'Strict')
    await page.reload()
    await expect(page.getByRole('button', { name: /Cerrar sesión/ }).first()).toBeVisible()
    const destino = new URL('../../documentacion/despliegue/preparacion-codex/fase-2/', import.meta.url)
    mkdirSync(destino, { recursive: true })
    await page.screenshot({ path: fileURLToPath(new URL('presentacion-api-local.png', destino)), fullPage: true })
    await page.getByRole('button', { name: /Cerrar sesión/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
    assert.equal(errores.length, 0, 'Se encontraron errores JavaScript en el navegador.')
    console.log('PASS: Chromium local, login visual, cookie Secure/HttpOnly/Strict, recarga con refresh y logout; sin red externa.')
  } finally { await browser.close() }
}

export async function comprobarFrontendDemo(base = 'http://127.0.0.1:5173') {
  const origen = new URL(base)
  if (!['localhost', '127.0.0.1'].includes(origen.hostname)) throw new Error('Sólo se verifica loopback.')
  const require = createRequire(new URL('../../test2026/package.json', import.meta.url))
  const { chromium, expect } = require('@playwright/test')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' })
    await context.route('**/*', route => new URL(route.request().url()).origin === origen.origin ? route.continue() : route.abort())
    const page = await context.newPage()
    const errores = []
    page.on('pageerror', e => errores.push(e))
    await page.goto(base)
    await expect(page.getByText('MODO DEMO', { exact: true }).first()).toBeVisible()
    const destino = new URL('../../documentacion/despliegue/preparacion-codex/fase-2/', import.meta.url)
    await page.screenshot({ path: fileURLToPath(new URL('presentacion-demo-escritorio.png', destino)), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: fileURLToPath(new URL('presentacion-demo-movil.png', destino)), fullPage: true })
    assert.equal(errores.length, 0, 'Errores JavaScript en el modo DEMO.')
    console.log('PASS: modo DEMO en navegador, escritorio y 390 px; sin errores JavaScript ni red externa.')
  } finally { await browser.close() }
}
