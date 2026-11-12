import { sqlPorMotor } from '../src/db.js'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { crearApp } from '../src/app.js'
import { reiniciarConfig } from '../src/config.js'
import { bd, ejecutar, fila } from '../src/db.js'
import { nuevoTokenDispositivo, sha256 } from '../src/util/comun.js'

export const app = crearApp()
const CLAVE = 'clave-de-prueba-123'
const hashClave = bcrypt.hashSync(CLAVE, 4)
let contador = 0

export function permitirEncendido(si: boolean) {
  process.env.PERMITIR_ENCENDIDO = si ? 'true' : 'false'
  reiniciarConfig()
}

export interface Escenario {
  terrenoId: number
  dispositivoId: number
  sensorId: number
  actuadorId: number
  zonaId: number
  token: string
  arranque: string
  propietario: string
  lector: string
  ajeno: string
}

/** Crea un terreno aislado con dispositivo, sensor, actuador, configuración y tres usuarios. */
export async function escenario(op: { calibrado?: boolean; modo?: string } = {}): Promise<Escenario> {
  const n = `${Date.now()}${++contador}`
  const usuario = async (rol: 'USUARIO') => {
    const r = await ejecutar(bd(), 'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?) RETURNING id', [`U${n}`, `u${n}-${Math.random().toString(36).slice(2, 8)}@prueba.local`, hashClave, rol])
    return (await fila(bd(), 'SELECT email FROM usuarios WHERE id = ?', [r.insertId]))!.email as string
  }
  const t = await ejecutar(bd(), 'INSERT INTO terrenos (nombre) VALUES (?) RETURNING id', [`T${n}`])
  const otro = await ejecutar(bd(), 'INSERT INTO terrenos (nombre) VALUES (?) RETURNING id', [`Otro${n}`])
  const z = await ejecutar(bd(), 'INSERT INTO zonas (terreno_id, nombre) VALUES (?, ?) RETURNING id', [t.insertId, 'Cama'])
  const token = nuevoTokenDispositivo()
  const d = await ejecutar(bd(), 'INSERT INTO dispositivos (terreno_id, uid, nombre, token_hash, token_prefijo) VALUES (?, ?, ?, ?, ?) RETURNING id', [t.insertId, `AGC-${n}`, 'Prueba', sha256(token), token.slice(0, 12)])
  const s = await ejecutar(bd(), "INSERT INTO sensores (dispositivo_id, zona_id, codigo, tipo, calibracion_confirmada) VALUES (?, ?, 'HUM1', 'HUMEDAD_SUELO', ?) RETURNING id", [d.insertId, z.insertId, op.calibrado === false ? 0 : 1])
  const a = await ejecutar(bd(), "INSERT INTO actuadores (dispositivo_id, zona_id, codigo) VALUES (?, ?, 'BOMBA1') RETURNING id", [d.insertId, z.insertId])
  await ejecutar(bd(), 'INSERT INTO configuraciones_control (actuador_id, sensor_id, modo) VALUES (?, ?, ?)', [a.insertId, s.insertId, op.modo ?? 'DESHABILITADO'])
  const propietario = await usuario('USUARIO')
  const lector = await usuario('USUARIO')
  const ajeno = await usuario('USUARIO')
  const id = async (e: string) => (await fila(bd(), 'SELECT id FROM usuarios WHERE email = ?', [e]))!.id
  await ejecutar(bd(), sqlPorMotor({ mysql: "INSERT INTO usuario_terreno VALUES (?, ?, 'PROPIETARIO', NOW(3)), (?, ?, 'LECTOR', NOW(3)), (?, ?, 'PROPIETARIO', NOW(3))", postgres: `INSERT INTO usuario_terreno VALUES (?, ?, 'PROPIETARIO', now()), (?, ?, 'LECTOR', now()), (?, ?, 'PROPIETARIO', now())` }), [
    await id(propietario), t.insertId, await id(lector), t.insertId, await id(ajeno), otro.insertId,
  ])
  return { terrenoId: t.insertId, dispositivoId: d.insertId, sensorId: s.insertId, actuadorId: a.insertId, zonaId: z.insertId, token, arranque: 'a1b2c3d4', propietario, lector, ajeno }
}

export async function sesion(email: string) {
  const r = await request(app).post('/api/v1/auth/login').send({ email, password: CLAVE })
  if (r.status !== 200) throw new Error(`login ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.data.token_acceso as string
}

/** Petición del ESP32 detrás del túnel HTTPS (X-Forwarded-Proto desde loopback). */
export function iot(e: Escenario, metodo: 'get' | 'post', ruta: string, arranque = e.arranque) {
  return request(app)[metodo](`/api/v1/iot${ruta}`).set({ Authorization: `Bearer ${e.token}`, 'X-Id-Arranque': arranque, 'X-Forwarded-Proto': 'https' })
}

export function web(token: string, metodo: 'get' | 'post' | 'patch', ruta: string) {
  return request(app)[metodo](`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`)
}

export function estadoActuador(over: Record<string, unknown> = {}) {
  return { actuador: 'BOMBA1', modo: 'DESHABILITADO', estado_bomba: 'APAGADA', riego_transcurrido_s: 0, riego_restante_s: 0, descanso_restante_s: 0, bloqueo: null, id_orden_activa: null, rearmes_remotos_episodio: 0, uptime_ms: 1000, ...over }
}

export function telemetria(e: Escenario, over: Record<string, unknown> = {}, arranque = e.arranque) {
  return {
    id_arranque: arranque,
    uptime_ms: 60_000,
    ts: new Date().toISOString(),
    version_firmware: '0.2.0',
    version_contrato: '1.0.2',
    config_version: 0,
    seguridad: { hardware_confirmado: true, calibracion_confirmada: true, tope_riego_s: 600, max_id_orden_procesada: 0, reloj_confiable: true, persistencia_ok: true, tls_vigencia: 'VERIFICADOR' },
    lecturas: [],
    actuadores: [estadoActuador()],
    ...over,
  }
}

export function ack(arranque: string, over: Record<string, unknown> = {}) {
  return { resultado: 'EJECUTADA', codigo_motivo: null, mensaje: null, duracion_aplicada_s: null, ejecutada_en: new Date().toISOString(), id_arranque_origen: arranque, uptime_ms: 5000, config_version: 1, estado_actuador: estadoActuador(), ...over }
}

/** Lleva el dispositivo a MANUAL, aplicado y reportado, listo para recibir encendidos. */
export async function prepararManual(e: Escenario, tokenWeb: string) {
  await iot(e, 'post', '/telemetria').send(telemetria(e)) // en línea y hardware confirmado
  const p = await web(tokenWeb, 'patch', `/actuadores/${e.actuadorId}/control`).send({ modo: 'MANUAL' })
  if (p.status !== 200) throw new Error(`PATCH ${p.status} ${JSON.stringify(p.body)}`)
  const v = p.body.data.config_version_deseada
  await iot(e, 'post', '/configuracion/confirmacion').send({ config_version: v, resultado: 'APLICADA', errores: [] })
  await iot(e, 'post', '/telemetria').send(telemetria(e, { config_version: v, actuadores: [estadoActuador({ modo: 'MANUAL', uptime_ms: 2000 })] }))
  return v
}
