import bcrypt from 'bcryptjs'
import { bloquearDispositivo, ejecutar, fila, transaccion } from './db.js'
import { sha256, nuevoTokenDispositivo } from './util/comun.js'
import { config } from './config.js'

/** Base NUEVA sintética. No lee dotenv, no actualiza ni importa personas del origen. */
export async function sembrarDemo(password: string) {
  if (config().DB_MOTOR !== 'postgres' || config().PERMITIR_ENCENDIDO) throw new Error('El seed demo exige PostgreSQL y encendido deshabilitado.')
  if (password.length < 16) throw new Error('La contraseña temporal de demostración debe tener al menos 16 caracteres.')
  const hash = await bcrypt.hash(password, 12)
  return transaccion(async (con) => {
    // Exclusión entre dos inicializaciones: antes de crear aún no existe dispositivo que bloquear.
    await fila(con, 'SELECT pg_advisory_xact_lock(17012026)')
    const existente = await fila(con, "SELECT id, terreno_id FROM dispositivos WHERE uid = 'AGC-DEMO-0001'")
    if (existente) {
      await bloquearDispositivo(con, existente.id)
      const u = await fila(con, "SELECT u.id FROM usuarios u JOIN usuario_terreno ut ON ut.usuario_id=u.id WHERE u.email='admin@demo.invalid' AND ut.terreno_id=?", [existente.terreno_id])
      if (!u) throw new Error('Datos demo existentes no corresponden al seed; no se modifican.')
      return { creada: false }
    }
    const n = await fila(con, 'SELECT COUNT(*) AS n FROM usuarios')
    const d = await fila(con, 'SELECT COUNT(*) AS n FROM dispositivos')
    const t0 = await fila(con, 'SELECT COUNT(*) AS n FROM terrenos')
    if (Number(n!.n) || Number(d!.n) || Number(t0!.n)) throw new Error('El seed demo sólo admite una base nueva vacía.')
    const u = await ejecutar(con, "INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Administrador sintético','admin@demo.invalid',?,'ADMIN') RETURNING id", [hash])
    const t = await ejecutar(con, "INSERT INTO terrenos (nombre,descripcion,creado_por) VALUES ('Finca demostración','DATOS SINTÉTICOS; sin equipo físico',?) RETURNING id", [u.insertId])
    await ejecutar(con, "INSERT INTO usuario_terreno (usuario_id,terreno_id,rol) VALUES (?,?,'PROPIETARIO')", [u.insertId, t.insertId])
    const c = await ejecutar(con, "INSERT INTO cultivos (terreno_id,nombre) VALUES (?,'Cultivo ficticio') RETURNING id", [t.insertId])
    const z = await ejecutar(con, "INSERT INTO zonas (terreno_id,cultivo_id,nombre) VALUES (?,?,'Zona sintética') RETURNING id", [t.insertId, c.insertId])
    const dev = await ejecutar(con, "INSERT INTO dispositivos (terreno_id,uid,nombre,token_hash,token_prefijo,intervalo_telemetria_s,intervalo_ordenes_s) VALUES (?,'AGC-DEMO-0001','ESP32 ficticio',?,'DEMO-SIN-NVS',15,3) RETURNING id", [t.insertId, sha256(nuevoTokenDispositivo())])
    const sensor = await ejecutar(con, "INSERT INTO sensores (dispositivo_id,zona_id,codigo,tipo) VALUES (?,?,'HUM1','HUMEDAD_SUELO') RETURNING id", [dev.insertId, z.insertId])
    const a = await ejecutar(con, "INSERT INTO actuadores (dispositivo_id,zona_id,codigo) VALUES (?,?,'BOMBA1') RETURNING id", [dev.insertId, z.insertId])
    await ejecutar(con, "INSERT INTO configuraciones_control (actuador_id,sensor_id,modo) VALUES (?,?,'DESHABILITADO')", [a.insertId, sensor.insertId])
    for (let i = 0; i < 12; i++) await ejecutar(con, "INSERT INTO mediciones (sensor_id,valor,valor_raw,estado,medido_en,hora_estimada,id_arranque,seq,uptime_ms) VALUES (?,?,?,'OK',?,0,'de000001',?,?)", [sensor.insertId, 40 + i / 10, 2200 - i, new Date(Date.UTC(2026, 0, 1, 12, 0, i * 15)), i + 1, (i + 1) * 15000])
    await ejecutar(con, "INSERT INTO auditoria (actor,accion,entidad,datos) VALUES ('SISTEMA','SEED_DEMO','base',?)", [JSON.stringify({ origen: 'SINTETICO', version: 1 })])
    return { creada: true }
  })
}
