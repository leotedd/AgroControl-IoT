import { sqlPorMotor } from '../src/db.js'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bd, cerrarBd, ejecutar, fila } from '../src/db.js'
import { auditarConsistencia } from '../src/verificacion.js'
import { app, escenario, estadoActuador, iot, permitirEncendido, sesion, telemetria, web } from './ayudas.js'

afterAll(() => cerrarBd())
beforeEach(() => permitirEncendido(false))

describe('bomba bloqueada en el servidor (PERMITIR_ENCENDIDO=false)', () => {
  it('un BOMBA_ENCENDER pendiente creado con el permiso activo NO se entrega: se cancela al consultar', async () => {
    const e = await escenario()
    const r = await ejecutar(bd(), sqlPorMotor({ mysql: "INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en) VALUES (?, ?, 'BOMBA_ENCENDER', '{\"duracion_s\":5}', 30, NOW(3) + INTERVAL 30 SECOND) RETURNING id", postgres: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en) VALUES (?, ?, 'BOMBA_ENCENDER', '{"duracion_s":5}', 30, now() + (30 * interval '1 second')) RETURNING id` }), [e.dispositivoId, e.actuadorId])
    const g = await iot(e, 'get', '/ordenes')
    expect(g.status).toBe(200)
    expect(g.body.data.ordenes).toEqual([])
    const o = await fila(bd(), 'SELECT estado, motivo_cierre FROM ordenes_riego WHERE id = ?', [r.insertId])
    expect(o).toMatchObject({ estado: 'CANCELADA', motivo_cierre: 'ENCENDIDO_DESHABILITADO' })
  })

  it('un BOMBA_ENCENDER ya ENTREGADA no se reentrega; un APAGAR sí se entrega', async () => {
    const e = await escenario()
    await ejecutar(bd(), sqlPorMotor({ mysql: "INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en, estado, entregada_en, id_arranque_entrega) VALUES (?, ?, 'BOMBA_ENCENDER', '{\"duracion_s\":5}', 30, NOW(3) + INTERVAL 30 SECOND, 'ENTREGADA', NOW(3), ?) RETURNING id", postgres: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en, estado, entregada_en, id_arranque_entrega) VALUES (?, ?, 'BOMBA_ENCENDER', '{"duracion_s":5}', 30, now() + (30 * interval '1 second'), 'ENTREGADA', now(), ?) RETURNING id` }), [e.dispositivoId, e.actuadorId, e.arranque])
    const tw = await sesion(e.propietario)
    const off = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    const g = await iot(e, 'get', '/ordenes')
    expect(g.body.data.ordenes.map((o: { tipo: string }) => o.tipo)).toEqual(['BOMBA_APAGAR'])
    expect(g.body.data.ordenes[0].id).toBe(off.body.data.id)
  })

  it('AUTOMATICO en la BD se entrega como MANUAL y la reconciliación baja el modo deseado', async () => {
    const e = await escenario({ modo: 'AUTOMATICO' })
    const cfg = await iot(e, 'get', '/configuracion')
    expect(cfg.body.data.control[0].modo).toBe('MANUAL')
    await iot(e, 'post', '/telemetria').send(telemetria(e, { config_version: cfg.body.data.config_version, actuadores: [estadoActuador({ modo: 'MANUAL' })] }))
    const cc = await fila(bd(), 'SELECT modo, modo_origen FROM configuraciones_control WHERE actuador_id = ?', [e.actuadorId])
    expect(cc).toMatchObject({ modo: 'MANUAL', modo_origen: 'SISTEMA' })
  })
})

describe('inicio de sesión sin enumeración de cuentas', () => {
  it('tras 5 fallos la cuenta se bloquea con la MISMA respuesta que credenciales incorrectas', async () => {
    const e = await escenario()
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email: e.propietario, password: 'mala' })
    const bloqueada = await request(app).post('/api/v1/auth/login').send({ email: e.propietario, password: 'clave-de-prueba-123' })
    const inexistente = await request(app).post('/api/v1/auth/login').send({ email: 'nadie@prueba.local', password: 'mala' })
    expect(bloqueada.status).toBe(401)
    expect(inexistente.status).toBe(401)
    expect(bloqueada.body.error).toEqual(inexistente.body.error)
    expect(bloqueada.headers['retry-after']).toBeUndefined()
    // Los 401 quedan auditados (sin contraseña) para poder explicarlos después.
    const a = await fila(bd(), "SELECT COUNT(*) AS n FROM auditoria a JOIN usuarios u ON u.id = a.usuario_id WHERE a.accion = 'LOGIN_FALLIDO' AND u.email = ?", [e.propietario])
    expect(Number(a!.n)).toBe(5)
  })
})

describe('historial agregado (GET /sensores/{id}/mediciones?agrupacion=)', () => {
  it('flujo sensor → API → MySQL → consulta: promedio, mínimo y máximo por intervalo de 5 min', async () => {
    const e = await escenario()
    const base = Date.UTC(2026, 9, 16, 10, 0, 0)
    const lecturas = [0, 60, 120, 400, 460].map((s, i) => ({ seq: i + 1, sensor: 'HUM1', tipo: 'HUMEDAD_SUELO', valor_pct: [40, 42, 44, 50, 52][i], valor_raw: 2000, estado: 'OK', ts: new Date(base + s * 1000).toISOString(), uptime_ms: 1000 + i }))
    // Lecturas "antiguas": se fuerza la marca de tiempo en el rango de 24 h aceptado (§7.1).
    const ahora = Date.now()
    for (const l of lecturas) l.ts = new Date(ahora - 3600_000 + (Date.parse(l.ts) - base)).toISOString()
    const t = await iot(e, 'post', '/telemetria').send(telemetria(e, { lecturas }))
    expect(t.body.data.recibidas).toBe(5)
    const tw = await sesion(e.propietario)
    const desde = new Date(ahora - 2 * 3600_000).toISOString()
    const r = await web(tw, 'get', `/sensores/${e.sensorId}/mediciones?agrupacion=5m&desde=${desde}`)
    expect(r.status).toBe(200)
    expect(r.body.meta).toMatchObject({ agrupacion: '5m', intervalo_s: 300 })
    const total = r.body.data.reduce((s: number, b: { lecturas: number }) => s + b.lecturas, 0)
    expect(total).toBe(5)
    const todos = r.body.data.flatMap((b: { minimo_pct: number; maximo_pct: number }) => [b.minimo_pct, b.maximo_pct])
    expect(Math.min(...todos)).toBe(40)
    expect(Math.max(...todos)).toBe(52)
  })

  it('rango invertido o demasiado amplio para la agrupación → 422', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    const ahora = Date.now()
    const inv = await web(tw, 'get', `/sensores/${e.sensorId}/mediciones?desde=${new Date(ahora).toISOString()}&hasta=${new Date(ahora - 1000).toISOString()}`)
    expect(inv.status).toBe(422)
    const amplio = await web(tw, 'get', `/sensores/${e.sensorId}/mediciones?agrupacion=crudo&desde=${new Date(ahora - 5 * 86400_000).toISOString()}`)
    expect(amplio.status).toBe(422)
    const malo = await web(tw, 'get', `/sensores/${e.sensorId}/mediciones?agrupacion=7m`)
    expect(malo.status).toBe(422)
  })
})

describe('auditoría de consistencia (sólo lectura)', () => {
  it('detecta incoherencias y la política de encendido sin modificar datos', async () => {
    const e = await escenario({ modo: 'AUTOMATICO' })
    await ejecutar(bd(), 'UPDATE dispositivos SET config_version_aplicada = config_version_deseada + 5 WHERE id = ?', [e.dispositivoId])
    const antes = await fila(bd(), 'SELECT config_version_aplicada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId])
    const h = await auditarConsistencia(bd(), false)
    const codigos = h.map((x) => x.codigo)
    expect(codigos).toContain('VERSION_APLICADA_MAYOR')
    expect(codigos).toContain('AUTOMATICO_CON_ENCENDIDO_BLOQUEADO')
    expect(h.find((x) => x.codigo === 'VERSION_APLICADA_MAYOR')!.nivel).toBe('FALLA')
    const despues = await fila(bd(), 'SELECT config_version_aplicada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId])
    expect(despues!.v).toBe(antes!.v) // no corrige nada
    await ejecutar(bd(), 'UPDATE dispositivos SET config_version_aplicada = 0 WHERE id = ?', [e.dispositivoId]) // restaura el escenario de prueba
  })
})
