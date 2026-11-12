import { sqlPorMotor } from './db.js'
// Comprobaciones de SÓLO LECTURA sobre la base configurada. Las usan el arranque del servidor,
// `npm run verificar` y el seed. Nunca escriben ni muestran credenciales.
import { fila, filas, type Con } from './db.js'

export const TABLAS_ESPERADAS = [
  'actuadores', 'alertas', 'arranques_dispositivo', 'auditoria', 'ciclos_riego', 'configuraciones_control',
  'cultivos', 'dispositivos', 'eventos_dispositivo', 'mediciones', 'ordenes_riego', 'sensores',
  'terrenos', 'tokens_refresco', 'usuario_terreno', 'usuarios', 'zonas',
] as const
export const TRIGGERS_ESPERADOS = ['trg_ordenes_inmutables', 'trg_ordenes_sin_borrado'] as const
export const CHECKS_ESPERADOS = ['ck_dispositivos_intervalos', 'ck_dispositivos_tope', 'ck_sensores_calibracion', 'ck_cc_histeresis', 'ck_cc_rangos', 'ck_ordenes_ttl', 'ck_ordenes_duracion'] as const
export const TABLAS_ACTUALIZADAS = ['usuarios', 'terrenos', 'cultivos', 'zonas', 'dispositivos', 'sensores', 'actuadores', 'configuraciones_control'] as const

export interface InformeEsquema {
  version: string
  base: string
  tablas: string[]
  triggers: string[]
  checks: string[]
  faltanTablas: string[]
  faltanTriggers: string[]
  faltanChecks: string[]
  correcto: boolean
}

export async function verificarEsquema(con: Con): Promise<InformeEsquema> {
  const postgres = con.motor === 'postgres'
  const v = await fila(con, postgres ? 'SELECT version() AS v, current_database() AS b' : 'SELECT VERSION() AS v, DATABASE() AS b')
  const tablas = (await filas(con, postgres
    ? "SELECT tablename AS n FROM pg_catalog.pg_tables WHERE schemaname = current_schema() ORDER BY 1"
    : 'SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1')).map((r) => String(r.n))
  const triggers = (await filas(con, postgres
    ? "SELECT t.tgname AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname=current_schema() AND NOT t.tgisinternal AND t.tgenabled='O' ORDER BY 1"
    : 'SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY 1')).map((r) => String(r.n))
  const encontrados = (await filas(con, postgres
    ? "SELECT c.conname AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace WHERE ns.nspname=current_schema() AND c.contype='c' AND c.convalidated ORDER BY 1"
    : 'SELECT CONSTRAINT_NAME AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY 1')).map((r) => String(r.n))
  const checks = encontrados.filter((n) => (CHECKS_ESPERADOS as readonly string[]).includes(n))
  const faltanTablas = TABLAS_ESPERADAS.filter((t) => !tablas.includes(t))
  const esperados = [...TRIGGERS_ESPERADOS, ...(postgres ? TABLAS_ACTUALIZADAS.map((t) => `trg_${t}_actualizado_en`) : [])]
  const faltanTriggers = esperados.filter((t) => !triggers.includes(t))
  const faltanChecks = CHECKS_ESPERADOS.filter((n) => !checks.includes(n))
  return { version: String(v?.v), base: String(v?.b), tablas, triggers, checks, faltanTablas, faltanTriggers, faltanChecks,
    correcto: !faltanTablas.length && !faltanTriggers.length && !faltanChecks.length }

}

export interface InformeDatos {
  usuarios: number
  terrenos: number
  dispositivos: number
  sensores: number
  actuadores: number
  mediciones: number
  ordenes: number
  uidSeedExiste: boolean
  vacia: boolean
}

export const UID_SEED = 'AGC-ESP32-0001'

export async function tamanoBase(con: Con, limiteMb: number) {
  if (con.motor !== 'postgres') return null
  const r = await fila(con, 'SELECT pg_database_size(current_database()) AS bytes')
  const mb = Number(r!.bytes) / 1024 / 1024
  const porcentaje = mb / limiteMb * 100
  return { mb, porcentaje, nivel: porcentaje >= 80 ? 'CRITICO' : porcentaje >= 60 ? 'AVISO' : 'OK' }
}

export interface Hallazgo {
  nivel: 'FALLA' | 'AVISO' | 'INFO'
  codigo: string
  cantidad: number
  mensaje: string
}

/**
 * Consistencia de datos (SÓLO LECTURA): detecta incoherencias sin corregir ni borrar nada.
 * `permitirEncendido` permite señalar configuraciones que contradicen la política de seguridad.
 */
export async function auditarConsistencia(con: Con, permitirEncendido: boolean): Promise<Hallazgo[]> {
  const contar = async (sql: string) => Number((await fila(con, sql))!.n)
  const reglas: [Hallazgo['nivel'], string, string, string][] = [
    ['FALLA', 'VERSION_APLICADA_MAYOR', 'dispositivos con config aplicada mayor que la deseada',
      'SELECT COUNT(*) AS n FROM dispositivos WHERE config_version_aplicada > config_version_deseada'],
    ['FALLA', 'ACTUADOR_SIN_CONTROL', 'actuadores activos sin configuración de control',
      'SELECT COUNT(*) AS n FROM actuadores a LEFT JOIN configuraciones_control cc ON cc.actuador_id = a.id WHERE a.activo = 1 AND cc.actuador_id IS NULL'],
    ['FALLA', 'SENSOR_DE_OTRO_DISPOSITIVO', 'lazos de control con un sensor de otro dispositivo',
      'SELECT COUNT(*) AS n FROM configuraciones_control cc JOIN actuadores a ON a.id = cc.actuador_id JOIN sensores s ON s.id = cc.sensor_id WHERE s.dispositivo_id <> a.dispositivo_id'],
    ['FALLA', 'ZONA_DE_OTRO_TERRENO', 'sensores o actuadores asignados a una zona de otro terreno',
      `SELECT (SELECT COUNT(*) FROM sensores s JOIN dispositivos d ON d.id = s.dispositivo_id JOIN zonas z ON z.id = s.zona_id WHERE z.terreno_id <> d.terreno_id)
            + (SELECT COUNT(*) FROM actuadores a JOIN dispositivos d ON d.id = a.dispositivo_id JOIN zonas z ON z.id = a.zona_id WHERE z.terreno_id <> d.terreno_id) AS n`],
    ['AVISO', 'ORDENES_VENCIDAS_ABIERTAS', 'órdenes PENDIENTE/ENTREGADA vencidas hace más de 5 min (se cierran al arrancar el backend)',
      sqlPorMotor({ mysql: "SELECT COUNT(*) AS n FROM ordenes_riego WHERE estado IN ('PENDIENTE','ENTREGADA') AND expira_en < NOW(3) - INTERVAL 5 MINUTE", postgres: `SELECT COUNT(*) AS n FROM ordenes_riego WHERE estado IN ('PENDIENTE','ENTREGADA') AND expira_en < now() - (5 * interval '1 minute')` })],
    ['AVISO', 'CICLOS_ABIERTOS_ANTIGUOS', 'ciclos de riego abiertos desde hace más de 1 h',
      sqlPorMotor({ mysql: 'SELECT COUNT(*) AS n FROM ciclos_riego WHERE finalizado_en IS NULL AND iniciado_en < NOW(3) - INTERVAL 1 HOUR', postgres: `SELECT COUNT(*) AS n FROM ciclos_riego WHERE finalizado_en IS NULL AND iniciado_en < now() - (1 * interval '1 hour')` })],
    ['AVISO', 'CALIBRACION_SIN_CONFIRMAR', 'sensores activos sin calibración confirmada',
      'SELECT COUNT(*) AS n FROM sensores WHERE activo = 1 AND calibracion_confirmada = 0'],
    ['INFO', 'DISPOSITIVO_SIN_TOKEN', 'dispositivos con token revocado',
      'SELECT COUNT(*) AS n FROM dispositivos WHERE token_hash IS NULL'],
    ['INFO', 'USUARIO_SIN_TERRENO', 'usuarios no ADMIN sin ningún terreno asignado',
      "SELECT COUNT(*) AS n FROM usuarios u LEFT JOIN usuario_terreno ut ON ut.usuario_id = u.id WHERE u.rol <> 'ADMIN' AND ut.usuario_id IS NULL"],
  ]
  if (!permitirEncendido)
    reglas.push(
      ['AVISO', 'AUTOMATICO_CON_ENCENDIDO_BLOQUEADO', 'lazos en AUTOMATICO con PERMITIR_ENCENDIDO=false (al ESP32 se le entregará MANUAL)',
        "SELECT COUNT(*) AS n FROM configuraciones_control WHERE modo = 'AUTOMATICO'"],
      ['AVISO', 'ENCENDIDOS_PENDIENTES_BLOQUEADOS', 'BOMBA_ENCENDER pendientes con PERMITIR_ENCENDIDO=false (se cancelarán, no se entregan)',
        "SELECT COUNT(*) AS n FROM ordenes_riego WHERE tipo = 'BOMBA_ENCENDER' AND estado IN ('PENDIENTE','ENTREGADA')"],
    )
  const r: Hallazgo[] = []
  for (const [nivel, codigo, mensaje, sql] of reglas) {
    const cantidad = await contar(sql)
    if (cantidad > 0) r.push({ nivel, codigo, cantidad, mensaje })
  }
  return r
}

export async function contarDatos(con: Con): Promise<InformeDatos> {
  const n = async (tabla: string) => Number((await fila(con, `SELECT COUNT(*) AS n FROM ${tabla}`))!.n)
  const r = {
    usuarios: await n('usuarios'),
    terrenos: await n('terrenos'),
    dispositivos: await n('dispositivos'),
    sensores: await n('sensores'),
    actuadores: await n('actuadores'),
    mediciones: await n('mediciones'),
    ordenes: await n('ordenes_riego'),
    uidSeedExiste: !!(await fila(con, 'SELECT id FROM dispositivos WHERE uid = ?', [UID_SEED])),
  }
  return { ...r, vacia: r.usuarios + r.terrenos + r.dispositivos + r.sensores + r.actuadores === 0 }
}
