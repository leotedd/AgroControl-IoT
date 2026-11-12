import { sqlPorMotor } from '../db.js'
import bcrypt from 'bcryptjs'
import { Router, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { config } from '../config.js'
import { bd, ejecutar, fila, type Fila } from '../db.js'
import { ErrorApi, asincrono, validar } from '../errores.js'
import { autenticarUsuario, terrenosVisibles } from '../middlewares/seguridad.js'
import { sha256, tokenAleatorio, uuid } from '../util/comun.js'
import { auditar } from '../util/registro.js'

const ACCESO_S = 15 * 60
const REFRESCO_DIAS = 7
const COOKIE = 'agc_refresh'
// Hash ficticio para igualar el tiempo de respuesta cuando el email no existe.
const HASH_FICTICIO = bcrypt.hashSync('contraseña-inexistente', 12)

function emitirAcceso(u: Fila) {
  return jwt.sign({ sub: u.id, rol: u.rol, nombre: u.nombre }, config().JWT_SECRETO, { algorithm: 'HS256', expiresIn: ACCESO_S })
}

async function emitirRefresco(res: Response, usuarioId: number, familia: string, ua: string | undefined, ip: string | undefined) {
  const token = tokenAleatorio(48)
  await ejecutar(
    bd(),
    sqlPorMotor({ mysql: 'INSERT INTO tokens_refresco (usuario_id, token_hash, familia, expira_en, user_agent, ip) VALUES (?, ?, ?, NOW(3) + INTERVAL ? DAY, ?, ?) RETURNING id', postgres: `INSERT INTO tokens_refresco (usuario_id, token_hash, familia, expira_en, user_agent, ip) VALUES (?, ?, ?, now() + (? * interval '1 day'), ?, ?) RETURNING id` }),
    [usuarioId, sha256(token), familia, REFRESCO_DIAS, ua?.slice(0, 255) ?? null, ip ?? null],
  )
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: true, // Chrome acepta cookies Secure en http://localhost
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: REFRESCO_DIAS * 86400 * 1000,
  })
}

const credenciales = z.object({ email: z.string().email().max(190), password: z.string().min(1).max(200) })

export const rutasAuth = Router()

rutasAuth.post(
  '/login',
  asincrono(async (req, res) => {
    const c = validar(credenciales, req.body)
    const u = await fila(bd(), 'SELECT * FROM usuarios WHERE email = ?', [c.email.toLowerCase()])
    // Cuenta bloqueada: misma respuesta y mismo coste que credenciales incorrectas (no revela qué emails existen).
    const bloqueada = !!u?.bloqueado_hasta && new Date(u.bloqueado_hasta).getTime() > Date.now()
    const ok = await bcrypt.compare(c.password, u?.password_hash ?? HASH_FICTICIO)
    if (bloqueada) throw new ErrorApi(401, 'CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.')
    if (!u || !ok || !u.activo) {
      if (u) {
        const n = u.intentos_fallidos + 1
        const bloqueoMin = n >= 5 ? Math.min(30, 2 ** (n - 5)) : 0 // bloqueo progresivo (contrato §13)
        await ejecutar(bd(), sqlPorMotor({ mysql: 'UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = IF(? > 0, NOW(3) + INTERVAL ? MINUTE, NULL) WHERE id = ?', postgres: `UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = (CASE WHEN ? > 0 THEN now() + (? * interval '1 minute') ELSE NULL END) WHERE id = ?` }), [n, bloqueoMin, bloqueoMin, u.id])
        // Rastro de los 401 del login (sin contraseña); los emails inexistentes no se registran.
        await auditar(bd(), { usuarioId: u.id, accion: 'LOGIN_FALLIDO', entidad: 'usuario', entidadId: u.id, datos: { intento: n, bloqueo_min: bloqueoMin }, ip: req.ip })
      }
      throw new ErrorApi(401, 'CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.')
    }
    await ejecutar(bd(), sqlPorMotor({ mysql: 'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso_en = NOW(3) WHERE id = ?', postgres: `UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso_en = now() WHERE id = ?` }), [u.id])
    await emitirRefresco(res, u.id, uuid(), req.header('user-agent'), req.ip)
    await auditar(bd(), { usuarioId: u.id, accion: 'LOGIN', entidad: 'usuario', entidadId: u.id, ip: req.ip })
    res.json({ data: { token_acceso: emitirAcceso(u), expira_en_s: ACCESO_S, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol } } })
  }),
)

rutasAuth.post(
  '/refresh',
  asincrono(async (req, res) => {
    const token = req.cookies?.[COOKIE]
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(token)) throw new ErrorApi(401, 'NO_AUTENTICADO', 'Sesión no iniciada.')
    const t = await fila(bd(), 'SELECT * FROM tokens_refresco WHERE token_hash = ?', [sha256(token)])
    if (!t) throw new ErrorApi(401, 'NO_AUTENTICADO', 'Sesión no válida.')
    if (t.usado_en || t.revocado_en) {
      // Reutilización de un token ya rotado: se revoca toda la familia (posible robo).
      await ejecutar(bd(), sqlPorMotor({ mysql: 'UPDATE tokens_refresco SET revocado_en = NOW(3) WHERE familia = ? AND revocado_en IS NULL', postgres: `UPDATE tokens_refresco SET revocado_en = now() WHERE familia = ? AND revocado_en IS NULL` }), [t.familia])
      throw new ErrorApi(401, 'NO_AUTENTICADO', 'Sesión revocada.')
    }
    if (new Date(t.expira_en).getTime() < Date.now()) throw new ErrorApi(401, 'TOKEN_EXPIRADO', 'La sesión expiró.')
    const u = await fila(bd(), 'SELECT * FROM usuarios WHERE id = ? AND activo = 1', [t.usuario_id])
    if (!u) throw new ErrorApi(401, 'NO_AUTENTICADO', 'Usuario no válido.')
    await ejecutar(bd(), sqlPorMotor({ mysql: 'UPDATE tokens_refresco SET usado_en = NOW(3) WHERE id = ?', postgres: `UPDATE tokens_refresco SET usado_en = now() WHERE id = ?` }), [t.id])
    await emitirRefresco(res, u.id, t.familia, req.header('user-agent'), req.ip)
    res.json({ data: { token_acceso: emitirAcceso(u), expira_en_s: ACCESO_S, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol } } })
  }),
)

rutasAuth.post(
  '/logout',
  asincrono(async (req, res) => {
    const token = req.cookies?.[COOKIE]
    if (typeof token === 'string' && /^[A-Za-z0-9_-]{64}$/.test(token)) await ejecutar(bd(), sqlPorMotor({ mysql: 'UPDATE tokens_refresco SET revocado_en = NOW(3) WHERE token_hash = ? AND revocado_en IS NULL', postgres: `UPDATE tokens_refresco SET revocado_en = now() WHERE token_hash = ? AND revocado_en IS NULL` }), [sha256(token)])
    res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/v1/auth' })
    res.json({ data: { ok: true } })
  }),
)

rutasAuth.get(
  '/me',
  autenticarUsuario,
  asincrono(async (req, res) => {
    const u = await fila(bd(), 'SELECT id, nombre, email, rol FROM usuarios WHERE id = ?', [req.usuario!.id])
    const terrenos = await terrenosVisibles(req)
    res.json({ data: { usuario: u, terrenos: terrenos.map((t) => ({ id: t.id, nombre: t.nombre, rol: t.rol })) } })
  }),
)
