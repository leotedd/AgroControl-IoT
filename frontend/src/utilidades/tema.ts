// Tema de la interfaz: claro, oscuro o automático (sigue al sistema).
// Se guarda por navegador en localStorage; si no está disponible (modo privado), funciona igual sin recordarlo.
// El CSS (index.css) lee `data-theme` en <html>: "light", "dark" o ausente (automático).
import { useSyncExternalStore } from 'react'

export type Tema = 'claro' | 'oscuro' | 'auto'
export const CLAVE_TEMA = 'agc-tema'
const COLOR_BARRA = { claro: '#0f6b3a', oscuro: '#0b100d' }

const oscuroDelSistema = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches

export function leerTema(): Tema {
  try {
    const v = localStorage.getItem(CLAVE_TEMA)
    return v === 'claro' || v === 'oscuro' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/** Tema efectivo (el automático se resuelve con la preferencia del sistema). */
export const temaEfectivo = (t: Tema): 'claro' | 'oscuro' => (t === 'auto' ? (oscuroDelSistema() ? 'oscuro' : 'claro') : t)

export function aplicarTema(t: Tema) {
  const raiz = document.documentElement
  if (t === 'auto') raiz.removeAttribute('data-theme')
  else raiz.setAttribute('data-theme', t === 'oscuro' ? 'dark' : 'light')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_BARRA[temaEfectivo(t)])
}

let actual: Tema = typeof window === 'undefined' ? 'auto' : leerTema()
const oyentes = new Set<() => void>()

export function cambiarTema(t: Tema) {
  actual = t
  try {
    if (t === 'auto') localStorage.removeItem(CLAVE_TEMA)
    else localStorage.setItem(CLAVE_TEMA, t)
  } catch {
    // Sin almacenamiento: el tema se aplica sólo en esta visita.
  }
  aplicarTema(t)
  oyentes.forEach((o) => o())
}

if (typeof window !== 'undefined') {
  aplicarTema(actual)
  // En automático, seguir los cambios del sistema (p. ej. modo oscuro programado del celular).
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (actual === 'auto') aplicarTema('auto')
    oyentes.forEach((o) => o())
  })
  // Otra pestaña cambió el tema.
  window.addEventListener('storage', (e) => {
    if (e.key !== CLAVE_TEMA) return
    actual = leerTema()
    aplicarTema(actual)
    oyentes.forEach((o) => o())
  })
}

let instantanea = { tema: actual, efectivo: typeof window === 'undefined' ? 'claro' : temaEfectivo(actual) }
export function useTema() {
  return useSyncExternalStore(
    (o) => {
      oyentes.add(o)
      return () => oyentes.delete(o)
    },
    () => {
      const efectivo = temaEfectivo(actual)
      if (instantanea.tema !== actual || instantanea.efectivo !== efectivo) instantanea = { tema: actual, efectivo }
      return instantanea
    },
  )
}
