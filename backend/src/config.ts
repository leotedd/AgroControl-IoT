import { z } from 'zod'
import { validarTrustProxy } from './util/trust-proxy.mjs'

// Configuración desde variables de entorno (backend/.env). Nunca credenciales en el código.
const sinMarcador = (s: z.ZodString) => s.refine((v) => !/^<.*>$/.test(v.trim()), 'Todavía tiene el marcador <…> de .env.example; complételo')

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PUERTO: z.coerce.number().int().min(1).max(65535).default(3000),
  // Local: loopback. Hosting: HOST=0.0.0.0 detrás de un proxy HTTPS confiable.
  HOST: z.enum(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::']).default('127.0.0.1'),
  // Direcciones/CIDR del proxy de confianza; nunca aceptar cabeceras de cualquier cliente.
  TRUST_PROXY: z.string().default('loopback').transform((v, ctx) => {
    try { return validarTrustProxy(v) } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use alias, IP o CIDR de proxies concretos; no valores universales ni números de saltos.' })
      return z.NEVER
    }
  }),
  // Optativo: ruta del build estático; vacío conserva el servidor sólo API.
  SERVIR_FRONTEND: z.string().default(''),
  DB_MOTOR: z.enum(['mysql', 'postgres']).default('mysql'),
  DATABASE_URL: z.string().optional(),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(10).default(5),
  PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  PG_LOCK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  LIMITE_BD_MB: z.coerce.number().positive().default(500),
  DIAGNOSTICO_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  DIAGNOSTICO_PROXY_HASTA: z.string().datetime().optional(),
  CORS_ORIGENES: z.string().default('http://localhost:5174,http://127.0.0.1:5174').transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)).refine(
    (vs) => vs.every((v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && u.origin === v } catch { return false } }),
    'Use orígenes HTTP/HTTPS exactos separados por comas, sin rutas ni comodines',
  ),
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PUERTO: z.coerce.number().int().default(3306),
  DB_USUARIO: sinMarcador(z.string().min(1)).optional(),
  DB_CONTRASENA: sinMarcador(z.string()).default(''),
  DB_NOMBRE: z.string().regex(/^\w+$/).default('agrocontrol'),
  DB_SSL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  DB_SSL_CA: z.string().optional(),
  JWT_SECRETO: sinMarcador(z.string().min(32, 'JWT_SECRETO debe tener al menos 32 caracteres')).refine(
    (v) => new Set(v).size >= 12,
    'JWT_SECRETO parece poco aleatorio; genere uno nuevo',
  ),
  PERMITIR_ENCENDIDO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Tope del servidor para cualquier encendido (primera prueba: 5 s). Se suma a riego_max_s y al tope del ESP32.
  ENCENDIDO_MAX_S: z.coerce.number().int().min(1).max(15).default(5),
  IOT_PERMITIR_HTTP_LOCAL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  LIMITES_DESACTIVADOS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}).superRefine((c, ctx) => {
  const falla = (campo: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: 'Ausente o inválida para este entorno.' })
  const locales = ['127.0.0.1', '::1', '[::1]', 'localhost']
  if (c.DB_MOTOR === 'mysql') {
    if (!c.DB_USUARIO) falla('DB_USUARIO')
    if (c.NODE_ENV === 'test' && !locales.includes(c.DB_HOST)) falla('DB_HOST')
  } else {
    try {
      const u = new URL(c.DATABASE_URL ?? '')
      if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname || !u.pathname.slice(1)) falla('DATABASE_URL')
      if (c.NODE_ENV === 'test' && !locales.includes(u.hostname)) falla('DATABASE_URL')
    } catch { falla('DATABASE_URL') }
    if (c.NODE_ENV === 'production' && (!c.DB_SSL || !c.DB_SSL_CA?.replace(/\\n/g, '\n').includes('-----BEGIN CERTIFICATE-----'))) falla('DB_SSL_CA')
  }
  if (c.NODE_ENV === 'production' && c.DIAGNOSTICO_PROXY) {
    const resta = Date.parse(c.DIAGNOSTICO_PROXY_HASTA ?? '') - Date.now()
    if (!(resta > 0 && resta <= 86400000)) falla('DIAGNOSTICO_PROXY_HASTA')
  }
})

export type Config = z.infer<typeof esquema>

let cache: Config | null = null

export function config(): Config {
  if (cache) return cache
  if (process.env.NODE_ENV === 'production' && !process.env.DB_MOTOR) throw new Error('Configuración inválida: DB_MOTOR debe declararse en producción.')
  const r = esquema.safeParse({ ...process.env, PUERTO: process.env.PORT ?? process.env.PUERTO })
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuración inválida (revise backend/.env):\n${detalle}`)
  }
  cache = r.data
  if (cache.NODE_ENV === 'production') {
    cache.IOT_PERMITIR_HTTP_LOCAL = false
    cache.LIMITES_DESACTIVADOS = false
  }
  return cache
}

/** Sólo para pruebas: fuerza a releer el entorno. */
export function reiniciarConfig() {
  cache = null
}
