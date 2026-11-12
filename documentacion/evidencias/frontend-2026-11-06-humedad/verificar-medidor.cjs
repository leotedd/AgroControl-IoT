// Verificación visual/funcional del medidor de humedad (build DEMO servido en :4319).
const { chromium } = require('C:/Users/i7del/OneDrive/Desktop/AgroControl-IoT/test2026/node_modules/playwright')
const path = require('path')
const OUT = process.argv[2]
const URL = 'http://localhost:4319/'
const r = []
const ok = (nombre, cond, extra = '') => r.push({ nombre, ok: !!cond, extra: String(extra) })

async function abrir(browser, ancho, alto, tema) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, colorScheme: tema })
  await ctx.addInitScript((t) => localStorage.setItem('agc-tema', t), tema)
  const page = await ctx.newPage()
  const errores = []
  page.on('console', (m) => m.type() === 'error' && errores.push(m.text()))
  page.on('pageerror', (e) => errores.push(e.message))
  await page.goto(URL)
  await page.waitForSelector('section[aria-label="Humedad del suelo"]')
  await page.waitForTimeout(1200)
  return { ctx, page, errores }
}

const tarjeta = (p) => p.locator('section[aria-label="Humedad del suelo"]')
const angulo = (p) =>
  tarjeta(p).locator('svg g[aria-hidden]').first().evaluate((g) => {
    const m = /rotate\(([-\d.]+)deg\)/.exec(g.getAttribute('style') || '')
    return { ang: m ? Number(m[1]) : null, opacidad: getComputedStyle(g).opacity }
  })
const numero = (p) => tarjeta(p).locator('p.text-5xl').innerText()
const actual = (p) => tarjeta(p).locator('li[aria-current="true"]').allInnerTexts()

;(async () => {
  const browser = await chromium.launch()
  // ── Escritorio claro: valores obligatorios con la vista previa DEMO ──
  {
    const { ctx, page, errores } = await abrir(browser, 1440, 1000, 'light')
    const t = tarjeta(page)
    const n1 = await numero(page)
    await page.waitForTimeout(3500)
    const n2 = await numero(page)
    ok('Actualiza sin recargar (valor cambia en vivo)', n1 !== n2, `${n1} → ${n2}`)
    await t.screenshot({ path: path.join(OUT, 'escritorio-claro-lectura-simulada.png') })

    await t.getByLabel('Probar valores en el medidor').check()
    const casos = [
      [0, 'Suelo seco', 'SECO', 0],
      [9.1, 'Suelo seco', 'SECO', 16.38],
      [29.9, 'Suelo seco', 'SECO', 53.82],
      [30, 'Humedad adecuada', 'ADECUADO', 54],
      [55, 'Humedad adecuada', 'ADECUADO', 99],
      [55.1, 'Suelo muy húmedo', 'MUY HÚMEDO', 99.18],
      [100, 'Suelo muy húmedo', 'MUY HÚMEDO', 180],
    ]
    for (const [v, etiqueta, ley, ang] of casos) {
      await t.getByRole('button', { name: `${v} %`, exact: true }).click()
      await page.waitForTimeout(750)
      const num = await numero(page)
      const estado = await t.locator('[aria-live="polite"]').innerText()
      const leyenda = (await actual(page)).join(' ')
      const a = await angulo(page)
      ok(`${v} % → ${etiqueta}`, num.startsWith(v.toFixed(1)) && estado.includes(etiqueta) && leyenda.toUpperCase().includes(ley) && Math.abs(a.ang - ang) < 0.01, `num=${num.replace(/\s+/g, ' ')} estado=${estado} aguja=${a.ang}°`)
      if ([9.1, 55, 55.1].includes(v)) await t.screenshot({ path: path.join(OUT, `escritorio-claro-prueba-${String(v).replace('.', '_')}.png`) })
    }
    // Tooltip accesible por teclado
    await t.getByRole('button', { name: 'Más información: Suelo seco' }).focus()
    const tip = await page.locator('[role="tooltip"]:visible').first().innerText()
    ok('Tooltip se abre con foco de teclado', tip.includes('Por debajo'), tip.slice(0, 60))
    await page.keyboard.press('Escape')
    ok('Tooltip se cierra con Esc', (await page.locator('[role="tooltip"]:visible').count()) === 0)
    await t.getByRole('button', { name: 'Lectura simulada' }).click()
    ok('Volver a la lectura simulada', (await t.locator('text=VISTA PREVIA').count()) === 0)

    // Fallo del sensor: sin valor inventado, medidor gris, bomba bloqueada visible
    await page.getByLabel('Fallo del sensor').check()
    await page.waitForTimeout(3500)
    const num = await numero(page)
    const a = await angulo(page)
    const texto = await t.innerText()
    ok('Lectura inválida: no muestra porcentaje', num.trim() === '—', num)
    ok('Lectura inválida: aguja oculta', a.opacidad === '0', a.opacidad)
    ok('Lectura inválida: estado textual', texto.includes('Lectura inválida'))
    ok('Lectura inválida: sin zona destacada en la leyenda', (await actual(page)).length === 0)
    ok('Bloqueo de seguridad visible', texto.includes('Bomba bloqueada por seguridad') && texto.includes('Bloqueada'), '')
    await t.screenshot({ path: path.join(OUT, 'escritorio-claro-sensor-falla.png') })
    // Bloqueo + suelo seco (vista previa) → mensaje explícito
    await t.getByLabel('Probar valores en el medidor').check()
    await t.getByRole('button', { name: '9.1 %', exact: true }).click()
    await page.waitForTimeout(700)
    ok('Suelo seco + bloqueo: avisa que no regará', (await t.innerText()).includes('El suelo está seco, pero la bomba está bloqueada'))
    await t.screenshot({ path: path.join(OUT, 'escritorio-claro-seco-bloqueada.png') })
    ok('Escritorio claro sin errores de consola', errores.length === 0, errores.join(' | '))
    await ctx.close()
  }
  // ── Escritorio oscuro + desconexión ──
  {
    const { ctx, page, errores } = await abrir(browser, 1440, 1000, 'dark')
    const t = tarjeta(page)
    ok('Tema oscuro aplicado', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zona-seco').trim())) === '#f06b6b')
    await t.screenshot({ path: path.join(OUT, 'escritorio-oscuro.png') })
    await page.getByLabel('Desconectar ESP32').check()
    await page.waitForTimeout(36000)
    const texto = await t.innerText()
    ok('ESP32 desconectado: estado distinto de "funcionando"', /desconectado|desactualizada/i.test(texto) && !texto.includes('Sensor funcionando'), texto.match(/Sensor (desconectado)|Información desactualizada/)?.[0])
    await t.screenshot({ path: path.join(OUT, 'escritorio-oscuro-desconectado.png') })
    ok('Escritorio oscuro sin errores de consola', errores.length === 0, errores.join(' | '))
    await ctx.close()
  }
  // ── Móvil 390 y tableta 768 ──
  for (const [ancho, tema] of [[390, 'dark'], [390, 'light'], [768, 'light']]) {
    const { ctx, page, errores } = await abrir(browser, ancho, 900, tema)
    const t = tarjeta(page)
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(`${ancho}px ${tema}: sin desborde horizontal`, desborde <= 0, `${desborde}px`)
    const caja = await t.boundingBox()
    ok(`${ancho}px ${tema}: tarjeta dentro de la pantalla`, caja.x >= 0 && caja.x + caja.width <= ancho, JSON.stringify(caja))
    await t.screenshot({ path: path.join(OUT, `movil-${ancho}-${tema}.png`) })
    ok(`${ancho}px ${tema}: sin errores de consola`, errores.length === 0, errores.join(' | '))
    await ctx.close()
  }
  await browser.close()
  require('fs').writeFileSync(path.join(OUT, 'resultados.json'), JSON.stringify(r, null, 2))
  for (const x of r) console.log(`${x.ok ? 'OK  ' : 'FALLA'} ${x.nombre}${x.extra ? `  [${x.extra}]` : ''}`)
  console.log(`\n${r.filter((x) => x.ok).length}/${r.length} correctas`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
