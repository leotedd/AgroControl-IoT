import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `vite` (modo development) → DEMO; `vite --mode real` → REAL, con proxy al backend local.
// `vite --mode movil` → REAL en la red local por HTTPS (certificado autofirmado): el celular necesita
// un contexto seguro para conservar la cookie de sesión (Secure) y generar claves de idempotencia.
export default defineConfig(({ mode }) => {
  const real = mode === 'real' || mode === 'movil' || mode === 'production'
  const movil = mode === 'movil'
  return {
    plugins: [react(), tailwindcss(), ...(movil ? [basicSsl({ name: 'agrocontrol-local' })] : [])],
    define: { 'import.meta.env.VITE_FUENTE': JSON.stringify(real ? 'real' : 'demo') },
    // Bibliotecas en chunks propios: se cachean entre despliegues de la aplicación (útil en datos móviles).
    build: {
      chunkSizeWarningLimit: 600, // recharts + d3 (~160 kB gzip) es un único chunk cacheable
      rollupOptions: {
        output: {
          manualChunks: (id) =>
            /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : /node_modules[\\/](recharts|d3-|victory|lodash)/.test(id) ? 'graficas' : undefined,
        },
      },
    },
    server: {
      // Sólo loopback salvo en modo movil (o con --host): el backend nunca se expone, lo alcanza el proxy.
      host: movil ? '0.0.0.0' : '127.0.0.1',
      port: movil ? 5175 : real ? 5174 : 5173,
      strictPort: true,
      // Mismo origen para el navegador: la cookie de sesión HttpOnly funciona sin CORS.
      // En modo movil añade X-Forwarded-Proto=https y X-Forwarded-For (acuerdo con backend/ENTREGA_BACKEND.md;
      // el backend sólo confía en esas cabeceras desde loopback).
      proxy: real ? { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false, xfwd: movil } } : undefined,
    },
  }
})
