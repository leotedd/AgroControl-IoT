import cookieParser from 'cookie-parser'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { config } from './config.js'
import { bd, fila } from './db.js'
import { ErrorApi, asincrono, manejadorErrores } from './errores.js'
import { idSolicitud } from './middlewares/seguridad.js'
import { cors } from './middlewares/cors.js'
import { rutasAuth } from './modulos/auth.js'
import { rutasIot } from './modulos/iot.js'
import { rutasPanel } from './modulos/panel.js'
import { ahoraIso, sha256 } from './util/comun.js'
import { instalarFrontend } from './frontend.js'

const limite = (max: number, clave?: (req: express.Request) => string) =>
  rateLimit({
    windowMs: 60_000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config().LIMITES_DESACTIVADOS,
    keyGenerator: clave,
    handler: (_req, _res, next) => next(new ErrorApi(429, 'DEMASIADAS_SOLICITUDES', 'Límite de solicitudes superado.')),
  })

// Clave por dispositivo (hash del token), no por IP: varios ESP32 pueden compartir hotspot.
const porToken = (req: express.Request) => sha256(req.header('authorization') ?? req.ip ?? '')

export function crearApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config().TRUST_PROXY)
  app.use(idSolicitud)
  // Registro de peticiones del ESP32 para la integración física (nunca se registra el token).
  if (config().NODE_ENV !== 'test')
    app.use('/api/v1/iot', (req, res, next) => {
      const inicio = Date.now()
      res.on('finish', () => {
        const d = req.dispositivo
        console.log(`[iot] ${new Date().toISOString().slice(11, 19)} ${d?.uid ?? 'sin-auth'} ${d ? `arr=${d.idArranque}` : ''} ${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode} (${Date.now() - inicio} ms)`)
      })
      next()
    })
  const produccion = config().NODE_ENV === 'production'
  app.use(helmet({
    strictTransportSecurity: produccion,
    contentSecurityPolicy: { useDefaults: false, directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      baseUri: ["'self'"], formAction: ["'self'"],
      ...(produccion ? { upgradeInsecureRequests: [] } : {}),
    } },
  }))
  app.use(cors)
  app.use(cookieParser())
  app.use('/api/v1', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  app.get('/api/v1/diagnostico/proxy', (req, res, next) => {
    const c = config()
    if (!c.DIAGNOSTICO_PROXY || (c.NODE_ENV === 'production' && Date.parse(c.DIAGNOSTICO_PROXY_HASTA ?? '') <= Date.now())) {
      return next(new ErrorApi(404, 'RECURSO_NO_ENCONTRADO', 'Ruta no encontrada.'))
    }
    res.json({ ip: req.ip, ips: req.ips, secure: req.secure, protocolo: req.protocol, saltos_xff: (req.get('x-forwarded-for') ?? '').split(',').filter((s) => s.trim()).length })
  })

  app.get(
    '/api/v1/salud',
    asincrono(async (_req, res) => {
      let estadoBd = 'OK'
      try {
        await fila(bd(), 'SELECT 1 AS ok')
      } catch {
        estadoBd = 'NO_DISPONIBLE'
      }
      res.setHeader('Cache-Control', 'no-store')
      res.status(estadoBd === 'OK' ? 200 : 503).json({ data: { estado: estadoBd === 'OK' ? 'OK' : 'DEGRADADO', base_datos: estadoBd, hora_servidor: ahoraIso() } })
    }),
  )

  // Dispositivos: cuerpo ≤ 16 KB; cubo propio para la consulta de órdenes (contrato §14).
  app.get('/api/v1/iot/ordenes', limite(40, porToken))
  app.use('/api/v1/iot', limite(80, porToken), express.json({ limit: '16kb' }), rutasIot)

  app.use('/api/v1/auth/login', limite(30), express.json({ limit: '100kb' }), limite(5, (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    return sha256(req.ip + (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? ':' + email : ''))
  }))
  app.use('/api/v1/auth', express.json({ limit: '100kb' }), rutasAuth)
  app.use('/api/v1', limite(300), express.json({ limit: '100kb' }), rutasPanel)

  app.use('/api', (_req, _res, next) => next(new ErrorApi(404, 'RECURSO_NO_ENCONTRADO', 'Ruta no encontrada.')))
  instalarFrontend(app, config().SERVIR_FRONTEND)
  app.use(manejadorErrores)
  return app
}
