import { useSyncExternalStore } from 'react'
import { SimuladorDemo } from '../demo/simulador'
import type { FuenteDatos, VistaPanel } from '../tipos/contrato'
import { FuenteApi } from './api'

// Modo fijado al ARRANCAR, nunca mezclado en tiempo de ejecución:
//   npm run dev       → DEMO  (simulador en el navegador, sin backend)
//   npm run dev:real  → REAL  (backend + MySQL; datos del ESP32 o del simulador por HTTP)
export const MODO: 'demo' | 'real' = import.meta.env.VITE_FUENTE === 'real' ? 'real' : 'demo'

export const simulador = MODO === 'demo' ? new SimuladorDemo() : null
export const api = MODO === 'real' ? new FuenteApi() : null
simulador?.iniciar()

export const fuente: FuenteDatos = (simulador ?? api)!

export function useVistaPanel(): VistaPanel {
  return useSyncExternalStore(
    (oyente) => fuente.suscribir(oyente),
    () => fuente.vista(),
  )
}

export function useEstadoApi() {
  return useSyncExternalStore(
    (oyente) => api!.suscribir(oyente),
    () => api!.estado(),
  )
}
