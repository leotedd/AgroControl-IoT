import { sqlPorMotor } from '../db.js'
import { ejecutar, fila, type Con } from '../db.js'

export type TipoAlerta =
  | 'DISPOSITIVO_FUERA_DE_LINEA'
  | 'HUMEDAD_BAJA'
  | 'HUMEDAD_ALTA'
  | 'FALLA_SENSOR'
  | 'BLOQUEO_ACTIVADO'
  | 'ORDEN_SIN_CONFIRMAR'
  | 'ORDEN_FALLIDA'
  | 'ACK_INCOHERENTE'
  | 'REINICIO_INESPERADO'
  | 'CONFIG_RECHAZADA'
  | 'DATOS_PERDIDOS'
  | 'PERSISTENCIA_DISPOSITIVO'
  | 'RELOJ_NO_CONFIABLE'

/** Crea una alerta salvo que ya exista una abierta con la misma clave (contrato §6.5/alertas). */
export async function crearAlerta(
  con: Con,
  a: {
    dispositivoId: number
    tipo: TipoAlerta
    severidad: 'INFO' | 'ADVERTENCIA' | 'CRITICA'
    mensaje: string
    datos?: unknown
    clave?: string
    ordenId?: number | null
  },
) {
  const clave = a.clave ?? `${a.tipo}:${a.dispositivoId}`
  const abierta = await fila(con, "SELECT id FROM alertas WHERE clave_dedup = ? AND estado <> 'RESUELTA' LIMIT 1", [clave])
  if (abierta) return
  await ejecutar(
    con,
    `INSERT INTO alertas (terreno_id, dispositivo_id, orden_id, tipo, severidad, mensaje, datos, clave_dedup)
     SELECT terreno_id, id, ?, ?, ?, ?, ?, ? FROM dispositivos WHERE id = ? RETURNING id`,
    [a.ordenId ?? null, a.tipo, a.severidad, a.mensaje.slice(0, 255), a.datos ? JSON.stringify(a.datos) : null, clave, a.dispositivoId],
  )
}

export async function resolverAlerta(con: Con, clave: string) {
  await ejecutar(con, sqlPorMotor({ mysql: "UPDATE alertas SET estado = 'RESUELTA', resuelta_en = NOW(3) WHERE clave_dedup = ? AND estado <> 'RESUELTA'", postgres: `UPDATE alertas SET estado = 'RESUELTA', resuelta_en = now() WHERE clave_dedup = ? AND estado <> 'RESUELTA'` }), [clave])
}

/** Auditoría: sólo inserción (contrato §13.1.4). */
export async function auditar(
  con: Con,
  a: { usuarioId?: number | null; actor?: 'USUARIO' | 'SISTEMA' | 'DISPOSITIVO'; accion: string; entidad: string; entidadId?: string | number | null; datos?: unknown; ip?: string | null },
) {
  await ejecutar(con, 'INSERT INTO auditoria (usuario_id, actor, accion, entidad, entidad_id, datos, ip) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id', [
    a.usuarioId ?? null,
    a.actor ?? (a.usuarioId ? 'USUARIO' : 'SISTEMA'),
    a.accion,
    a.entidad,
    a.entidadId != null ? String(a.entidadId) : null,
    a.datos ? JSON.stringify(a.datos) : null,
    a.ip ?? null,
  ])
}
