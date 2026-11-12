import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError, type ZodTypeAny, type z } from 'zod'

export interface DetalleError {
  campo: string
  codigo: string
  mensaje: string
}

/** Error con el formato del contrato §12. */
export class ErrorApi extends Error {
  constructor(
    public estado: number,
    public codigo: string,
    mensaje: string,
    public detalles?: DetalleError[],
    public cabeceras?: Record<string, string>,
  ) {
    super(mensaje)
  }
}

export const noEncontrado = (codigo = 'RECURSO_NO_ENCONTRADO', mensaje = 'Recurso no encontrado.') =>
  new ErrorApi(404, codigo, mensaje)
export const conflicto = (codigo: string, mensaje: string) => new ErrorApi(409, codigo, mensaje)

function detallesZod(e: ZodError): DetalleError[] {
  return e.issues.map((i) => ({
    campo: i.path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join('.').replace(/\.\[/g, '['),
    codigo:
      i.code === 'invalid_type'
        ? i.received === 'undefined'
          ? 'REQUERIDO'
          : 'TIPO_INVALIDO'
        : i.code === 'too_small' || i.code === 'too_big'
          ? 'FUERA_DE_RANGO'
          : i.code === 'invalid_enum_value' || i.code === 'invalid_literal'
            ? 'VALOR_NO_PERMITIDO'
            : i.code === 'custom'
              ? ((i.params?.codigo as string) ?? 'VALOR_NO_PERMITIDO')
              : 'FORMATO_INVALIDO',
    mensaje: i.message,
  }))
}

export function validar<T extends ZodTypeAny>(esquema: T, datos: unknown): z.infer<T> {
  const r = esquema.safeParse(datos)
  if (!r.success) throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'La solicitud contiene datos inválidos.', detallesZod(r.error))
  return r.data
}

/** Envuelve handlers async para que los errores lleguen al manejador. */
export const asincrono =
  (fn: (...a: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next)

export const manejadorErrores: ErrorRequestHandler = (err, req, res, _next) => {
  const id = (req as { idSolicitud?: string }).idSolicitud
  if (err instanceof ErrorApi) {
    if (err.cabeceras) for (const [k, v] of Object.entries(err.cabeceras)) res.setHeader(k, v)
    res.status(err.estado).json({
      error: { codigo: err.codigo, mensaje: err.message, ...(err.detalles ? { detalles: err.detalles } : {}) },
      id_solicitud: id,
    })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON válido.' }, id_solicitud: id })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { codigo: 'CARGA_DEMASIADO_GRANDE', mensaje: 'El cuerpo supera el tamaño máximo.' }, id_solicitud: id })
    return
  }
  const codigoBd = (err as { code?: string })?.code
  const caido = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_CON_COUNT_ERROR', '57P01', '57P03', '53300', '08000', '08001', '08003', '08006', '55P03', '57014'].includes(codigoBd ?? '')
  // Nunca exponer trazas (contrato §12). Se registra sin datos sensibles.
  console.error(`[${new Date().toISOString()}] ${id} ${req.method} ${req.path} ->`, codigoBd === 'P0001' ? 'INMUTABILIDAD_VIOLADA' : codigoBd ?? 'ERROR_INTERNO')
  res.status(caido ? 503 : 500).json({
    error: caido
      ? { codigo: 'SERVICIO_NO_DISPONIBLE', mensaje: 'Servicio no disponible temporalmente.' }
      : { codigo: 'ERROR_INTERNO', mensaje: 'Error interno.' },
    id_solicitud: id,
  })
}

export { ZodError }
