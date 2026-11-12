import { sqlPorMotor } from '../src/db.js'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bd, cerrarBd, ejecutar, fila, filas } from '../src/db.js'
import { caducarOrdenes } from '../src/tareas.js'
import { ack, app, escenario, estadoActuador, iot, permitirEncendido, prepararManual, sesion, telemetria, web } from './ayudas.js'

afterAll(() => cerrarBd())
beforeEach(() => permitirEncendido(false))

describe('transporte y autenticación del ESP32 (§4.1, §5.1)', () => {
  it('salud es pública y trae hora_servidor', async () => {
    const r = await request(app).get('/api/v1/salud')
    expect(r.status).toBe(200)
    expect(r.body.data.base_datos).toBe('OK')
    expect(Date.parse(r.body.data.hora_servidor)).toBeGreaterThan(0)
    expect(r.headers['x-request-id']).toBeTruthy()
  })

  it('B-13: /iot sin HTTPS → 403 HTTPS_REQUERIDO', async () => {
    const e = await escenario()
    const r = await request(app).get('/api/v1/iot/ordenes').set({ Authorization: `Bearer ${e.token}`, 'X-Id-Arranque': e.arranque })
    expect(r.status).toBe(403)
    expect(r.body.error.codigo).toBe('HTTPS_REQUERIDO')
  })

  it('token inválido → 401; X-Id-Arranque inválido → 422', async () => {
    const e = await escenario()
    const r1 = await iot({ ...e, token: 'agc_dev_' + 'x'.repeat(43) }, 'get', '/ordenes')
    expect(r1.status).toBe(401)
    expect(r1.body.error.codigo).toBe('TOKEN_DISPOSITIVO_INVALIDO')
    const r2 = await iot(e, 'get', '/ordenes', 'XYZ')
    expect(r2.status).toBe(422)
  })

  it('dispositivo deshabilitado → 403', async () => {
    const e = await escenario()
    await ejecutar(bd(), "UPDATE dispositivos SET estado = 'DESHABILITADO' WHERE id = ?", [e.dispositivoId])
    const r = await iot(e, 'get', '/ordenes')
    expect(r.status).toBe(403)
    expect(r.body.error.codigo).toBe('DISPOSITIVO_DESHABILITADO')
  })

  it('respuestas /iot con Cache-Control: no-store', async () => {
    const e = await escenario()
    const r = await iot(e, 'get', '/ordenes')
    expect(r.headers['cache-control']).toBe('no-store')
  })
})

describe('telemetría (§7.1)', () => {
  it('guarda lecturas, deduplica reenvíos (B-11) y descarta sensores ajenos (P-2)', async () => {
    const e = await escenario()
    const lect = (seq: number, sensor = 'HUM1') => ({ seq, sensor, tipo: 'HUMEDAD_SUELO', valor_pct: 41.26, valor_raw: 1900, estado: 'OK', ts: new Date().toISOString(), uptime_ms: 59_000 })
    const cuerpo = telemetria(e, { lecturas: [lect(1), lect(2), lect(3, 'OTRO')] })
    const r1 = await iot(e, 'post', '/telemetria').send(cuerpo)
    expect(r1.status).toBe(200)
    expect(r1.body.data).toMatchObject({ recibidas: 2, duplicadas: 0, descartadas: [{ seq: 3, codigo: 'SENSOR_DESCONOCIDO' }] })
    const r2 = await iot(e, 'post', '/telemetria').send(cuerpo)
    expect(r2.body.data).toMatchObject({ recibidas: 0, duplicadas: 2 })
    const s = await fila(bd(), 'SELECT ultimo_valor FROM sensores WHERE id = ?', [e.sensorId])
    expect(Number(s!.ultimo_valor)).toBe(41.3)
    const n = await fila(bd(), 'SELECT COUNT(*) AS n FROM mediciones WHERE sensor_id = ?', [e.sensorId])
    expect(Number(n!.n)).toBe(2)
  })

  it('id_arranque del cuerpo distinto de la cabecera → 422 ARRANQUE_NO_COINCIDE', async () => {
    const e = await escenario()
    const r = await iot(e, 'post', '/telemetria').send(telemetria(e, {}, 'ffffffff'))
    expect(r.status).toBe(422)
    expect(r.body.error.codigo).toBe('ARRANQUE_NO_COINCIDE')
  })

  it('lectura con fecha sin Z se descarta sin invalidar el lote (§13.1.2)', async () => {
    const e = await escenario()
    const r = await iot(e, 'post', '/telemetria').send(
      telemetria(e, { lecturas: [{ seq: 1, sensor: 'HUM1', tipo: 'HUMEDAD_SUELO', valor_pct: 40, valor_raw: 1900, estado: 'OK', ts: '2026-10-15T20:31:04', uptime_ms: 1 }] }),
    )
    expect(r.status).toBe(200)
    expect(r.body.data.descartadas[0].codigo).toBe('VALIDACION_FALLIDA')
  })

  it('B-10: un estado más antiguo del mismo arranque no sobrescribe el snapshot', async () => {
    const e = await escenario()
    await iot(e, 'post', '/telemetria').send(telemetria(e, { actuadores: [estadoActuador({ estado_bomba: 'RIEGO_MANUAL', uptime_ms: 9000 })] }))
    await iot(e, 'post', '/telemetria').send(telemetria(e, { actuadores: [estadoActuador({ estado_bomba: 'APAGADA', uptime_ms: 5000 })] }))
    const a = await fila(bd(), 'SELECT estado_bomba FROM actuadores WHERE id = ?', [e.actuadorId])
    expect(a!.estado_bomba).toBe('RIEGO_MANUAL')
  })

  it('B-9: modo efectivo menor con versión al día → el servidor baja el modo deseado', async () => {
    const e = await escenario({ modo: 'MANUAL' })
    const d = await fila(bd(), 'SELECT config_version_deseada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId])
    await iot(e, 'post', '/telemetria').send(telemetria(e, { config_version: d!.v, actuadores: [estadoActuador({ modo: 'DESHABILITADO' })] }))
    const cc = await fila(bd(), 'SELECT modo, modo_origen FROM configuraciones_control WHERE actuador_id = ?', [e.actuadorId])
    expect(cc).toMatchObject({ modo: 'DESHABILITADO', modo_origen: 'SISTEMA' })
    const d2 = await fila(bd(), 'SELECT config_version_deseada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId])
    expect(d2!.v).toBe(d!.v + 1)
  })

  it('nunca sube el modo: efectivo mayor que el deseado no cambia nada', async () => {
    const e = await escenario({ modo: 'DESHABILITADO' })
    await iot(e, 'post', '/telemetria').send(telemetria(e, { config_version: 1, actuadores: [estadoActuador({ modo: 'MANUAL' })] }))
    const cc = await fila(bd(), 'SELECT modo FROM configuraciones_control WHERE actuador_id = ?', [e.actuadorId])
    expect(cc!.modo).toBe('DESHABILITADO')
  })
})

describe('configuración (§7.4, §7.5)', () => {
  it('entrega la configuración con valores de banco y ETag/304', async () => {
    const e = await escenario()
    const r = await iot(e, 'get', '/configuracion')
    expect(r.status).toBe(200)
    expect(r.body.data.control[0]).toMatchObject({ actuador: 'BOMBA1', sensor: 'HUM1', modo: 'DESHABILITADO', umbral_inicio_pct: 30, umbral_parada_pct: 55, riego_max_s: 15, descanso_min_s: 60 })
    const r2 = await iot(e, 'get', '/configuracion').set('If-None-Match', r.headers.etag)
    expect(r2.status).toBe(304)
  })

  it('confirmación de versión inexistente → 409', async () => {
    const e = await escenario()
    const r = await iot(e, 'post', '/configuracion/confirmacion').send({ config_version: 99, resultado: 'APLICADA', errores: [] })
    expect(r.status).toBe(409)
    expect(r.body.error.codigo).toBe('VERSION_CONFIG_DESCONOCIDA')
  })
})

describe('órdenes: entrega, ACK, reinicio y caducidad (§8)', () => {
  it('encendido-habilitado-simulado: encendido-habilitado-simulado: flujo completo: crear → entregar → ejecutar; ACK idéntico 200, distinto 409 (B-7)', async () => {
    permitirEncendido(true)
    const e = await escenario()
    const tw = await sesion(e.propietario)
    await prepararManual(e, tw)
    const c = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    expect(c.status).toBe(201)
    const id = c.body.data.id
    expect(Number.isSafeInteger(id)).toBe(true)

    const g = await iot(e, 'get', '/ordenes')
    expect(g.body.data.ordenes).toEqual([expect.objectContaining({ id, tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })])
    const cuerpo = ack(e.arranque, { duracion_aplicada_s: 5, estado_actuador: estadoActuador({ modo: 'MANUAL', estado_bomba: 'RIEGO_MANUAL', uptime_ms: 9000 }) })
    expect((await iot(e, 'post', `/ordenes/${id}/confirmacion`).send(cuerpo)).status).toBe(200)
    expect((await web(tw, 'get', `/ordenes/${id}`)).body.data).toMatchObject({ estado: 'EJECUTADA', duracion_aplicada_s: 5 })
    expect((await iot(e, 'post', `/ordenes/${id}/confirmacion`).send(cuerpo)).status).toBe(200)
    const distinto = await iot(e, 'post', `/ordenes/${id}/confirmacion`).send({ ...cuerpo, resultado: 'RECHAZADA', codigo_motivo: 'DESCANSO_ACTIVO', duracion_aplicada_s: null })
    expect(distinto.status).toBe(409)
    expect(distinto.body.error.codigo).toBe('ORDEN_YA_FINALIZADA')
    const o = await fila(bd(), 'SELECT ack_conflictos, resultado FROM ordenes_riego WHERE id = ?', [id])
    expect(o).toMatchObject({ ack_conflictos: 1, resultado: 'EJECUTADA' })
  })

  it('B-15: ACK de APAGAR EJECUTADA/null y luego EJECUTADA/SIN_CAMBIO → ambos 200', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    const c = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    expect(c.status).toBe(201)
    await iot(e, 'get', '/ordenes')
    expect((await iot(e, 'post', `/ordenes/${c.body.data.id}/confirmacion`).send(ack(e.arranque))).status).toBe(200)
    expect((await iot(e, 'post', `/ordenes/${c.body.data.id}/confirmacion`).send(ack(e.arranque, { codigo_motivo: 'SIN_CAMBIO' }))).status).toBe(200)
  })

  it('encendido-habilitado-simulado: encendido-habilitado-simulado: B-2/B-3/B-4: APAGAR cancela encendidos pendientes; encender con apagado pendiente → 409; sólo se entrega el apagado', async () => {
    permitirEncendido(true)
    const e = await escenario()
    const tw = await sesion(e.propietario)
    await prepararManual(e, tw)
    const on = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    const off = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    expect(off.body.data.canceladas).toEqual([on.body.data.id])
    expect((await web(tw, 'get', `/ordenes/${on.body.data.id}`)).body.data).toMatchObject({ estado: 'CANCELADA', motivo_cierre: 'REEMPLAZADA_POR_APAGAR' })
    const otra = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    expect(otra.status).toBe(409)
    expect(otra.body.error.codigo).toBe('APAGADO_PENDIENTE')
    const g = await iot(e, 'get', '/ordenes')
    expect(g.body.data.ordenes.map((o: { id: number }) => o.id)).toEqual([off.body.data.id])
  })

  it('encendido-habilitado-simulado: encendido-habilitado-simulado: B-5: reinicio del ESP32 → ENTREGADA pasa a SIN_CONFIRMAR, no se reentrega, y el ACK tardío se acepta', async () => {
    permitirEncendido(true)
    const e = await escenario()
    const tw = await sesion(e.propietario)
    await prepararManual(e, tw)
    const c = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    await iot(e, 'get', '/ordenes') // entregada al arranque a1b2c3d4
    const g = await iot(e, 'get', '/ordenes', '0badc0de') // nuevo arranque
    expect(g.body.data.ordenes).toEqual([])
    expect((await web(tw, 'get', `/ordenes/${c.body.data.id}`)).body.data).toMatchObject({ estado: 'SIN_CONFIRMAR', motivo_cierre: 'REINICIO_DISPOSITIVO' })
    // B-17: ACK reenviado tras el reinicio (origen antiguo, cabecera nueva) → tardío; no toca el snapshot
    const r = await iot(e, 'post', `/ordenes/${c.body.data.id}/confirmacion`, '0badc0de').send(
      ack(e.arranque, { resultado: 'FALLIDA', codigo_motivo: 'RESULTADO_INCIERTO_REINICIO', estado_actuador: estadoActuador({ estado_bomba: 'RIEGO_MANUAL', uptime_ms: 999_999 }) }),
    )
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ estado: 'FALLIDA', confirmacion_tardia: true })
    const a = await fila(bd(), 'SELECT estado_bomba FROM actuadores WHERE id = ?', [e.actuadorId])
    expect(a!.estado_bomba).not.toBe('RIEGO_MANUAL')
  })

  it('B-8: caducidad sin entrega → EXPIRADA; un ACK posterior → 409 ORDEN_NO_ENTREGADA', async () => {
    const e = await escenario()
    const r = await ejecutar(bd(), sqlPorMotor({ mysql: "INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en) VALUES (?, ?, 'BOMBA_APAGAR', '{}', 30, NOW(3) - INTERVAL 1 SECOND) RETURNING id", postgres: `INSERT INTO ordenes_riego (dispositivo_id, actuador_id, tipo, parametros, ttl_s, expira_en) VALUES (?, ?, 'BOMBA_APAGAR', '{}', 30, now() - (1 * interval '1 second')) RETURNING id` }), [e.dispositivoId, e.actuadorId])
    await caducarOrdenes()
    expect((await fila(bd(), 'SELECT estado FROM ordenes_riego WHERE id = ?', [r.insertId]))!.estado).toBe('EXPIRADA')
    const a = await iot(e, 'post', `/ordenes/${r.insertId}/confirmacion`).send(ack(e.arranque))
    expect(a.status).toBe(409)
    expect(a.body.error.codigo).toBe('ORDEN_NO_ENTREGADA')
    const alerta = await fila(bd(), "SELECT COUNT(*) AS n FROM alertas WHERE orden_id = ? AND tipo = 'ACK_INCOHERENTE'", [r.insertId])
    expect(Number(alerta!.n)).toBe(1) // la alerta se confirma aunque la respuesta sea 409
  })

  it('P-3: un dispositivo no puede confirmar órdenes de otro (404)', async () => {
    const a = await escenario()
    const b = await escenario()
    const tw = await sesion(a.propietario)
    const c = await web(tw, 'post', `/dispositivos/${a.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    const r = await iot(b, 'post', `/ordenes/${c.body.data.id}/confirmacion`).send(ack(b.arranque))
    expect(r.status).toBe(404)
    expect(r.body.error.codigo).toBe('ORDEN_NO_ENCONTRADA')
  })

  it('eventos: deduplicados y RIEGO_INICIADO/FINALIZADO forman un ciclo', async () => {
    const e = await escenario()
    const ev = (seq: number, tipo: string, datos: Record<string, unknown>) => ({ seq, tipo, actuador: 'BOMBA1', ts: new Date().toISOString(), uptime_ms: 1000 + seq, datos })
    const cuerpo = { id_arranque: e.arranque, uptime_ms: 5000, eventos: [ev(1, 'RIEGO_INICIADO', { origen: 'MANUAL', humedad_pct: 30 }), ev(2, 'RIEGO_FINALIZADO', { motivo_fin: 'DURACION_CUMPLIDA', duracion_s: 10, humedad_fin_pct: 45 }), ev(3, 'TIPO_FUTURO', {})] }
    expect((await iot(e, 'post', '/eventos').send(cuerpo)).body.data).toMatchObject({ recibidos: 3, duplicados: 0 })
    expect((await iot(e, 'post', '/eventos').send(cuerpo)).body.data).toMatchObject({ recibidos: 0, duplicados: 3 })
    const c = await fila(bd(), 'SELECT origen, motivo_fin, duracion_s FROM ciclos_riego WHERE actuador_id = ?', [e.actuadorId])
    expect(c).toMatchObject({ origen: 'MANUAL', motivo_fin: 'DURACION_CUMPLIDA', duracion_s: 10 })
  })
})

describe('prueba de comunicación de la web (APAGAR inocuo, sin cambio de contrato)', () => {
  it('con PERMITIR_ENCENDIDO=false y bloqueo crítico: APAGAR ttl 30 + clave diag- → entregado → ACK EJECUTADA/SIN_CAMBIO; el bloqueo sigue', async () => {
    const e = await escenario()
    const bloqueo = { id_bloqueo: 4, tipo: 'CRITICO', causa: 'FALLA_SENSOR', liberable_remotamente: false }
    await iot(e, 'post', '/telemetria').send(telemetria(e, { actuadores: [estadoActuador({ bloqueo })] }))
    const tw = await sesion(e.propietario)
    const on = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    expect(on.body.error.codigo).toBe('ENCENDIDO_DESHABILITADO')
    const clave = `diag-${crypto.randomUUID()}`
    const c = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).set('Idempotency-Key', clave).send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1', parametros: {}, ttl_s: 30 })
    expect(c.status).toBe(201)
    expect(c.body.data).toMatchObject({ tipo: 'BOMBA_APAGAR', estado: 'PENDIENTE', canceladas: [] })
    const g = await iot(e, 'get', '/ordenes')
    expect(g.body.data.ordenes.map((o: { id: number }) => o.id)).toEqual([c.body.data.id])
    const a = await iot(e, 'post', `/ordenes/${c.body.data.id}/confirmacion`).send(ack(e.arranque, { codigo_motivo: 'SIN_CAMBIO', estado_actuador: estadoActuador({ bloqueo }) }))
    expect(a.status).toBe(200)
    const o = (await web(tw, 'get', `/ordenes/${c.body.data.id}`)).body.data
    expect(o).toMatchObject({ estado: 'EJECUTADA', codigo_motivo: 'SIN_CAMBIO' })
    expect(o.entregada_en && o.confirmada_en).toBeTruthy()
    const fila1 = await fila(bd(), 'SELECT idempotency_key, ttl_s, origen FROM ordenes_riego WHERE id = ?', [c.body.data.id])
    expect(fila1).toMatchObject({ idempotency_key: clave, ttl_s: 30, origen: 'WEB' })
    const act = await fila(bd(), 'SELECT bloqueo_tipo FROM actuadores WHERE id = ?', [e.actuadorId])
    expect(act!.bloqueo_tipo).toBe('CRITICO')
  })
})

describe('primera prueba de la bomba: tope de 5 s y apagado de seguridad del servidor', () => {
  it('encendido-habilitado-simulado: encendido-habilitado-simulado: con el permiso activo, 6 s → 422 DURACION_EXCEDE_MAXIMO aunque riego_max_s sea 15; 5 s → 201', async () => {
    permitirEncendido(true)
    const e = await escenario()
    const tw = await sesion(e.propietario)
    await prepararManual(e, tw)
    const larga = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 6 } })
    expect(larga.status).toBe(422)
    expect(larga.body.error.codigo).toBe('DURACION_EXCEDE_MAXIMO')
    const ok = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    expect(ok.status).toBe(201)
    const est = await web(tw, 'get', `/dispositivos/${e.dispositivoId}/estado`)
    expect(est.body.data.servidor).toEqual({ permitir_encendido: true, encendido_max_s: 5 })
  })

  it('bomba informada encendida > 5 + 3 s → el servidor ordena APAGAR (SISTEMA), alerta crítica, sin duplicar; con 8 s no actúa', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    const encendida = (s: number, up: number) => telemetria(e, { uptime_ms: up, actuadores: [estadoActuador({ modo: 'MANUAL', estado_bomba: 'RIEGO_MANUAL', riego_transcurrido_s: s, uptime_ms: up })] })
    await iot(e, 'post', '/telemetria').send(encendida(8, 61_000))
    expect(await fila(bd(), "SELECT id FROM ordenes_riego WHERE dispositivo_id = ? AND tipo = 'BOMBA_APAGAR'", [e.dispositivoId])).toBeNull()

    await iot(e, 'post', '/telemetria').send(encendida(9, 62_000))
    await iot(e, 'post', '/telemetria').send(encendida(10, 63_000))
    const apagados = await filas(bd(), "SELECT id, origen, solicitada_por, estado FROM ordenes_riego WHERE dispositivo_id = ? AND tipo = 'BOMBA_APAGAR'", [e.dispositivoId])
    const filasApagado = apagados as { id: number; origen: string; solicitada_por: number | null; estado: string }[]
    expect(filasApagado).toHaveLength(1)
    expect(filasApagado[0]).toMatchObject({ origen: 'SISTEMA', solicitada_por: null, estado: 'PENDIENTE' })
    const g = await iot(e, 'get', '/ordenes')
    expect(g.body.data.ordenes).toEqual([expect.objectContaining({ id: filasApagado[0].id, tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })])
    const alerta = await fila(bd(), "SELECT severidad, mensaje FROM alertas WHERE dispositivo_id = ? AND clave_dedup = ?", [e.dispositivoId, `APAGADO_SEGURIDAD:${filasApagado[0].id}`])
    expect(alerta).toMatchObject({ severidad: 'CRITICA' })
    const audit = await fila(bd(), "SELECT actor FROM auditoria WHERE accion = 'APAGADO_SEGURIDAD' AND entidad_id = ?", [String(filasApagado[0].id)])
    expect(audit).toMatchObject({ actor: 'SISTEMA' })
    void tw
  })

  it('RIEGO_INICIADO con los nombres del firmware 0.3.0-trial (duracion_s, humedad_inicio_pct) también abre el ciclo', async () => {
    const e = await escenario()
    const ev = { seq: 1, tipo: 'RIEGO_INICIADO', ts: new Date().toISOString(), uptime_ms: 4000, actuador: 'BOMBA1', datos: { origen: 'MANUAL', duracion_s: 5, humedad_inicio_pct: 31.5 } }
    expect((await iot(e, 'post', '/eventos').send({ id_arranque: e.arranque, uptime_ms: 5000, eventos: [ev] })).status).toBe(200)
    const c = await fila(bd(), 'SELECT origen, duracion_programada_s, humedad_inicio_pct FROM ciclos_riego WHERE actuador_id = ?', [e.actuadorId])
    expect(c).toMatchObject({ origen: 'MANUAL', duracion_programada_s: 5 })
    expect(Number(c!.humedad_inicio_pct)).toBe(31.5)
  })
})
