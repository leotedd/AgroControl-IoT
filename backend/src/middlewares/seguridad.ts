import { sqlPorMotor } from '../db.js'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { bd, bloquearDispositivo, ejecutar, fila, filas, transaccion, type Fila } from '../db.js'
import { ErrorApi, asincrono } from '../errores.js'
import { idArranque, sha256, uuid } from '../util/comun.js'
import { auditar } from '../util/registro.js'
import { actualizarPresencia } from '../presencia.js'

declare module 'express-serve-static-core' {
  interface Request {
    idSolicitud: string
    dispositivo?: { id: number; terrenoId: number; uid: string; idArranque: string }
    usuario?: { id: number; rol: 'ADMIN' | 'USUARIO'; nombre: string }
  }
}

export const idSolicitud: RequestHandler = (req, res, next) => {
  req.idSolicitud = uuid()
  res.setHeader('X-Request-Id', req.idSolicitud)
  next()
}

/** /iot sólo por HTTPS (contrato §4.1). Excepción explícita para el simulador en 127.0.0.1 en desarrollo. */
export const requerirHttps: RequestHandler = (req, _res, next) => {
  if (req.secure) return next()
  const c = config()
  const local = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
  if (c.IOT_PERMITIR_HTTP_LOCAL && c.NODE_ENV !== 'production' && local) return next()
  next(new ErrorApi(403, 'HTTPS_REQUERIDO', 'El acceso del dispositivo requiere HTTPS.'))
}

export const sinCache: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

/**
 * Autenticación del ESP32 (contrato §5.1) y regla de reinicio (§8.5).
 * Token Bearer → SHA-256; acepta el token anterior durante la gracia; el primer uso del nuevo
 * invalida el anterior. X-Id-Arranque obligatorio.
 */
export const autenticarDispositivo = asincrono(async (req: Request, _res: Response, next: NextFunction) => {
  const cab = req.header('authorization') ?? ''
  const m = /^Bearer (agc_dev_[A-Za-z0-9_-]{20,80})$/.exec(cab)
  if (!m) throw new ErrorApi(401, 'TOKEN_DISPOSITIVO_INVALIDO', 'Token de dispositivo ausente o inválido.')
  const arranque = req.header('x-id-arranque') ?? ''
  if (!idArranque.safeParse(arranque).success)
    throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'Cabecera X-Id-Arranque inválida.', [
      { campo: 'X-Id-Arranque', codigo: 'FORMATO_INVALIDO', mensaje: 'Debe ser 8 caracteres hex en minúscula.' },
    ])

  const hash = sha256(m[1])
  const d = await fila(
    bd(),
    sqlPorMotor({ mysql: `SELECT id, terreno_id, uid, estado, token_hash, token_anterior_hash, id_arranque_actual
       FROM dispositivos
      WHERE token_hash = ? OR (token_anterior_hash = ? AND token_anterior_expira_en > NOW(3))
      LIMIT 1`, postgres: `SELECT id, terreno_id, uid, estado, token_hash, token_anterior_hash, id_arranque_actual
       FROM dispositivos
      WHERE token_hash = ? OR (token_anterior_hash = ? AND token_anterior_expira_en > now())
      LIMIT 1` }),
    [hash, hash],
  )
  if (!d) throw new ErrorApi(401, 'TOKEN_DISPOSITIVO_INVALIDO', 'Token de dispositivo ausente o inválido.')
  if (d.estado === 'DESHABILITADO') throw new ErrorApi(403, 'DISPOSITIVO_DESHABILITADO', 'Dispositivo deshabilitado.')

  if (d.token_hash === hash && d.token_anterior_hash) {
    await ejecutar(bd(), 'UPDATE dispositivos SET token_anterior_hash = NULL, token_anterior_expira_en = NULL WHERE id = ?', [d.id])
  }

  if (d.id_arranque_actual !== arranque) await registrarArranque(d.id, arranque, req.ip ?? null)

  await actualizarPresencia(d.id, req.ip ?? null, arranque, d.id_arranque_actual !== arranque)
  req.dispositivo = { id: d.id, terrenoId: d.terreno_id, uid: d.uid, idArranque: arranque }
  next()
})

/** Regla de reinicio (contrato §8.5). */
async function registrarArranque(dispositivoId: number, arranque: string, ip: string | null) {
  await transaccion(async (con) => {
    const d = await bloquearDispositivo(con, dispositivoId)
    if (d.id_arranque_actual === arranque) return // otra solicitud ya lo registró
    await ejecutar(con, sqlPorMotor({ mysql: 'INSERT IGNORE INTO arranques_dispositivo (dispositivo_id, id_arranque) VALUES (?, ?) RETURNING id', postgres: `INSERT INTO arranques_dispositivo (dispositivo_id, id_arranque) VALUES (?, ?) ON CONFLICT (dispositivo_id, id_arranque) DO NOTHING RETURNING id` }), [dispositivoId, arranque])
    const sinConfirmar = await ejecutar(
      con,
      `UPDATE ordenes_riego
          SET estado = 'SIN_CONFIRMAR', motivo_cierre = 'REINICIO_DISPOSITIVO'
        WHERE dispositivo_id = ? AND estado = 'ENTREGADA' AND id_arranque_entrega <> ? AND motivo_cierre IS NULL`,
      [dispositivoId, arranque],
    )
    await ejecutar(
      con,
      sqlPorMotor({ mysql: `UPDATE ciclos_riego c JOIN actuadores a ON a.id = c.actuador_id
          SET c.finalizado_en = NOW(3), c.motivo_fin = 'REINICIO',
              c.duracion_s = TIMESTAMPDIFF(SECOND, c.iniciado_en, NOW(3))
        WHERE a.dispositivo_id = ? AND c.finalizado_en IS NULL`, postgres: `UPDATE ciclos_riego c
          SET finalizado_en = now(), motivo_fin = 'REINICIO',
              duracion_s = floor(extract(epoch from (now() - c.iniciado_en)))::bigint
        FROM actuadores a WHERE a.id = c.actuador_id AND a.dispositivo_id = ? AND c.finalizado_en IS NULL` }),
      [dispositivoId],
    )
    await ejecutar(con, sqlPorMotor({ mysql: 'UPDATE dispositivos SET id_arranque_actual = ?, arranque_detectado_en = NOW(3) WHERE id = ?', postgres: `UPDATE dispositivos SET id_arranque_actual = ?, arranque_detectado_en = now() WHERE id = ?` }), [arranque, dispositivoId])
    await auditar(con, {
      actor: 'DISPOSITIVO',
      accion: 'ARRANQUE_DETECTADO',
      entidad: 'dispositivo',
      entidadId: dispositivoId,
      datos: { anterior: d.id_arranque_actual, nuevo: arranque, ordenes_sin_confirmar: sinConfirmar.affectedRows },
      ip,
    })
  })
}

// ---------------------------------------------------------------- usuarios (contrato §5.2)

export interface ContenidoJwt {
  sub: number
  rol: 'ADMIN' | 'USUARIO'
  nombre: string
}

export const autenticarUsuario: RequestHandler = (req, _res, next) => {
  const m = /^Bearer (.+)$/.exec(req.header('authorization') ?? '')
  if (!m) return next(new ErrorApi(401, 'NO_AUTENTICADO', 'Debe iniciar sesión.'))
  try {
    const p = jwt.verify(m[1], config().JWT_SECRETO, { algorithms: ['HS256'] }) as unknown as ContenidoJwt
    req.usuario = { id: Number(p.sub), rol: p.rol, nombre: p.nombre }
    next()
  } catch (e) {
    next(
      (e as Error).name === 'TokenExpiredError'
        ? new ErrorApi(401, 'TOKEN_EXPIRADO', 'La sesión expiró.')
        : new ErrorApi(401, 'NO_AUTENTICADO', 'Debe iniciar sesión.'),
    )
  }
}

export type RolTerreno = 'LECTOR' | 'OPERADOR' | 'PROPIETARIO'
const NIVEL: Record<RolTerreno, number> = { LECTOR: 1, OPERADOR: 2, PROPIETARIO: 3 }

/**
 * Pertenencia y rol (contrato §13.1.1 P-4/P-5): no miembro → 404 (no revela existencia);
 * miembro con rol insuficiente → 403. ADMIN global accede a todo.
 */
export async function exigirRol(req: Request, terrenoId: number | null | undefined, minimo: RolTerreno, codigo404: string) {
  if (!terrenoId) throw new ErrorApi(404, codigo404, 'Recurso no encontrado.')
  const u = req.usuario!
  if (u.rol === 'ADMIN') return
  const r = await fila(bd(), 'SELECT rol FROM usuario_terreno WHERE usuario_id = ? AND terreno_id = ?', [u.id, terrenoId])
  if (!r) throw new ErrorApi(404, codigo404, 'Recurso no encontrado.')
  if (NIVEL[r.rol as RolTerreno] < NIVEL[minimo]) throw new ErrorApi(403, 'PERMISO_DENEGADO', 'Su rol no permite esta acción.')
}

export async function terrenosVisibles(req: Request): Promise<Fila[]> {
  const u = req.usuario!
  return u.rol === 'ADMIN'
    ? filas(bd(), "SELECT t.*, 'PROPIETARIO' AS rol FROM terrenos t WHERE t.activo = 1 ORDER BY t.id")
    : filas(bd(), 'SELECT t.*, ut.rol FROM terrenos t JOIN usuario_terreno ut ON ut.terreno_id = t.id WHERE ut.usuario_id = ? AND t.activo = 1 ORDER BY t.id', [u.id])
}
