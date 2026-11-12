import type { RequestHandler } from 'express'
import { config } from '../config.js'
import { ErrorApi } from '../errores.js'

const metodos = ['GET', 'POST', 'PATCH', 'OPTIONS']
const cabeceras = ['authorization', 'content-type', 'idempotency-key', 'x-id-arranque', 'if-none-match']

/** Lista exacta; solicitudes sin Origin (firmware/proxy/CLI) conservan su autenticación. */
export const cors: RequestHandler = (req, res, next) => {
  res.vary('Origin')
  const origen = req.header('origin')
  if (!origen) return next()
  if (!config().CORS_ORIGENES.includes(origen))
    return next(new ErrorApi(403, 'ORIGEN_NO_PERMITIDO', 'Origen no permitido.'))
  res.setHeader('Access-Control-Allow-Origin', origen)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, ETag, Retry-After')
  if (req.method !== 'OPTIONS') return next()
  res.vary('Access-Control-Request-Method')
  res.vary('Access-Control-Request-Headers')
  const metodo = req.header('access-control-request-method') ?? ''
  const solicitadas = (req.header('access-control-request-headers') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!metodos.includes(metodo) || solicitadas.some((s) => !cabeceras.includes(s)))
    return next(new ErrorApi(403, 'CORS_NO_PERMITIDO', 'Método o cabeceras no permitidos.'))
  res.setHeader('Access-Control-Allow-Methods', metodos.join(', '))
  res.setHeader('Access-Control-Allow-Headers', cabeceras.join(', '))
  res.status(204).end()
}
