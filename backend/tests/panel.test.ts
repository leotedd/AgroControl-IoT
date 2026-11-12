import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bd, cerrarBd, fila } from '../src/db.js'
import { app, escenario, estadoActuador, iot, permitirEncendido, prepararManual, sesion, telemetria, web } from './ayudas.js'

afterAll(() => cerrarBd())
beforeEach(() => permitirEncendido(false))

describe('sesión (§5.2)', () => {
  it('credenciales incorrectas → 401 genérico; correctas → token + cookie HttpOnly', async () => {
    const e = await escenario()
    const mal = await request(app).post('/api/v1/auth/login').send({ email: e.propietario, password: 'incorrecta' })
    expect(mal.status).toBe(401)
    expect(mal.body.error.codigo).toBe('CREDENCIALES_INVALIDAS')
    const ok = await request(app).post('/api/v1/auth/login').send({ email: e.propietario, password: 'clave-de-prueba-123' })
    expect(ok.status).toBe(200)
    const cookie = String(ok.headers['set-cookie'])
    expect(cookie).toMatch(/agc_refresh=.*HttpOnly.*Secure.*SameSite=Strict/i)
    const me = await web(ok.body.data.token_acceso, 'get', '/auth/me')
    expect(me.body.data.terrenos).toHaveLength(1)
  })

  it('refresh rota el token y la reutilización de uno ya usado revoca la familia', async () => {
    const e = await escenario()
    const ok = await request(app).post('/api/v1/auth/login').send({ email: e.propietario, password: 'clave-de-prueba-123' })
    const c1 = ok.headers['set-cookie']
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1)
    expect(r1.status).toBe(200)
    const reuso = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1)
    expect(reuso.status).toBe(401)
    const r2 = await request(app).post('/api/v1/auth/refresh').set('Cookie', r1.headers['set-cookie'])
    expect(r2.status).toBe(401) // familia revocada
  })

  it('sin token → 401 NO_AUTENTICADO', async () => {
    const r = await request(app).get('/api/v1/terrenos')
    expect(r.status).toBe(401)
  })
})

describe('pertenencia y límites (§13.1.1, §13.1.2)', () => {
  it('B-19: no miembro → 404; LECTOR que envía orden → 403', async () => {
    const e = await escenario()
    const ajeno = await sesion(e.ajeno)
    expect((await web(ajeno, 'get', `/dispositivos/${e.dispositivoId}/estado`)).status).toBe(404)
    const lector = await sesion(e.lector)
    expect((await web(lector, 'get', `/dispositivos/${e.dispositivoId}/estado`)).status).toBe(200)
    const r = await web(lector, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    expect(r.status).toBe(403)
    expect(r.body.error.codigo).toBe('PERMISO_DENEGADO')
  })

  it('B-20: id de ruta > 2^53−1, duración en texto o fraccionaria, fecha sin Z → 422', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    expect((await web(tw, 'get', '/ordenes/9007199254740992')).status).toBe(422)
    const s = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: '10' } })
    expect(s.status).toBe(422)
    const f = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 10.5 } })
    expect(f.status).toBe(422)
    expect((await web(tw, 'get', `/sensores/${e.sensorId}/mediciones?desde=2026-10-15T20:00:00`)).status).toBe(422)
  })
})

describe('bomba apagada por defecto y precondiciones (§10, §11.4, §11.5)', () => {
  it('con PERMITIR_ENCENDIDO=false: encender → 409 ENCENDIDO_DESHABILITADO; AUTOMATICO → 409; APAGAR sí', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    await iot(e, 'post', '/telemetria').send(telemetria(e))
    const on = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    expect(on.status).toBe(409)
    expect(on.body.error.codigo).toBe('ENCENDIDO_DESHABILITADO')
    const auto = await web(tw, 'patch', `/actuadores/${e.actuadorId}/control`).send({ modo: 'AUTOMATICO' })
    expect(auto.status).toBe(409)
    expect(auto.body.error.codigo).toBe('ENCENDIDO_DESHABILITADO')
    const off = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    expect(off.status).toBe(201)
    const est = await web(tw, 'get', `/dispositivos/${e.dispositivoId}/estado`)
    expect(est.body.data.actuadores[0].acciones_permitidas).toMatchObject({ encender: false, apagar: true, motivo_encender_no_permitido: 'ENCENDIDO_DESHABILITADO' })
  })

  it('encendido-habilitado-simulado: encendido-habilitado-simulado: encender en modo DESHABILITADO → MODO_NO_MANUAL; duración > riego_max → DURACION_EXCEDE_MAXIMO', async () => {
    permitirEncendido(true)
    const e = await escenario()
    const tw = await sesion(e.propietario)
    await iot(e, 'post', '/telemetria').send(telemetria(e))
    const r = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    expect(r.body.error.codigo).toBe('MODO_NO_MANUAL')
    await prepararManual(e, tw)
    const larga = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 60 } })
    expect(larga.status).toBe(422)
    expect(larga.body.error.codigo).toBe('DURACION_EXCEDE_MAXIMO')
  })

  it('encendido-habilitado-simulado: encendido-habilitado-simulado: encender con el ESP32 fuera de línea → 409 DISPOSITIVO_FUERA_DE_LINEA', async () => {
    permitirEncendido(true)
    const e = await escenario({ modo: 'MANUAL' })
    const tw = await sesion(e.propietario)
    const r = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    expect(r.body.error.codigo).toBe('DISPOSITIVO_FUERA_DE_LINEA')
  })

  it('encendido-habilitado-simulado: encendido-habilitado-simulado: B-12: habilitar modo sin calibración → 409; histéresis < 5 → 422', async () => {
    permitirEncendido(true)
    const e = await escenario({ calibrado: false })
    const tw = await sesion(e.propietario)
    await iot(e, 'post', '/telemetria').send(telemetria(e))
    const m = await web(tw, 'patch', `/actuadores/${e.actuadorId}/control`).send({ modo: 'MANUAL' })
    expect(m.body.error.codigo).toBe('CALIBRACION_NO_CONFIRMADA')
    // El estado del panel anuncia el mismo motivo, para que la web no envíe solicitudes destinadas al 409.
    const est = await web(tw, 'get', `/dispositivos/${e.dispositivoId}/estado`)
    expect(est.body.data.actuadores[0].modos_no_permitidos).toEqual({ DESHABILITADO: null, MANUAL: 'CALIBRACION_NO_CONFIRMADA', AUTOMATICO: 'CALIBRACION_NO_CONFIRMADA' })
    const h = await web(tw, 'patch', `/actuadores/${e.actuadorId}/control`).send({ umbral_inicio_pct: 50, umbral_parada_pct: 52 })
    expect(h.status).toBe(422)
    expect(h.body.error.detalles[0].codigo).toBe('HISTERESIS_INSUFICIENTE')
  })

  it('encendido-habilitado-simulado: encendido-habilitado-simulado: B-12: habilitar modo con bloqueo reportado → 409 BLOQUEO_ACTIVO', async () => {
    permitirEncendido(true)
    const e = await escenario()
    const tw = await sesion(e.propietario)
    const bloqueo = { id_bloqueo: 3, tipo: 'PREVENTIVO', causa: 'TIEMPO_MAXIMO', liberable_remotamente: true }
    await iot(e, 'post', '/telemetria').send(telemetria(e, { actuadores: [estadoActuador({ bloqueo })] }))
    const r = await web(tw, 'patch', `/actuadores/${e.actuadorId}/control`).send({ modo: 'MANUAL' })
    expect(r.body.error.codigo).toBe('BLOQUEO_ACTIVO')
  })

  it('B-16: rearme con id_bloqueo distinto → 409; preventivo sin inspección → 422; correcto → 201', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    const bloqueo = { id_bloqueo: 7, tipo: 'PREVENTIVO', causa: 'TIEMPO_MAXIMO', liberable_remotamente: true }
    await iot(e, 'post', '/telemetria').send(telemetria(e, { actuadores: [estadoActuador({ bloqueo })] }))
    const url = `/dispositivos/${e.dispositivoId}/ordenes`
    const otro = await web(tw, 'post', url).send({ tipo: 'RESTABLECER_BLOQUEO', actuador: 'BOMBA1', parametros: { id_bloqueo: 6, causa: 'TIEMPO_MAXIMO', inspeccion_confirmada: true } })
    expect(otro.body.error.codigo).toBe('BLOQUEO_NO_COINCIDE')
    const sin = await web(tw, 'post', url).send({ tipo: 'RESTABLECER_BLOQUEO', actuador: 'BOMBA1', parametros: { id_bloqueo: 7, causa: 'TIEMPO_MAXIMO', inspeccion_confirmada: false } })
    expect(sin.status).toBe(422)
    const ok = await web(tw, 'post', url).send({ tipo: 'RESTABLECER_BLOQUEO', actuador: 'BOMBA1', parametros: { id_bloqueo: 7, causa: 'TIEMPO_MAXIMO', inspeccion_confirmada: true } })
    expect(ok.status).toBe(201)
  })

  it('Idempotency-Key repetida devuelve la misma orden (B-1)', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    const r1 = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).set('Idempotency-Key', 'clic-1').send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    const r2 = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).set('Idempotency-Key', 'clic-1').send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(200)
    expect(r2.body.data.id).toBe(r1.body.data.id)
  })

  it('APAGAR en AUTOMATICO baja el modo configurado a MANUAL (F-2, lado servidor)', async () => {
    const e = await escenario({ modo: 'AUTOMATICO' })
    const tw = await sesion(e.propietario)
    const r = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/ordenes`).send({ tipo: 'BOMBA_APAGAR', actuador: 'BOMBA1' })
    expect(r.body.data.advertencias).toContain('MODO_CAMBIADO_A_MANUAL')
    expect((await fila(bd(), 'SELECT modo FROM configuraciones_control WHERE actuador_id = ?', [e.actuadorId]))!.modo).toBe('MANUAL')
  })

  it('estado del panel: forma del contrato §11.3 y mediciones', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    await iot(e, 'post', '/telemetria').send(telemetria(e, { lecturas: [{ seq: 1, sensor: 'HUM1', tipo: 'HUMEDAD_SUELO', valor_pct: 37.5, valor_raw: 2000, estado: 'OK', ts: new Date().toISOString(), uptime_ms: 59_000 }] }))
    const r = await web(tw, 'get', `/dispositivos/${e.dispositivoId}/estado`)
    expect(r.status).toBe(200)
    expect(r.body.data.dispositivo).toMatchObject({ conexion: 'EN_LINEA', version_contrato: '1.0.2', hardware_confirmado: true })
    expect(r.body.data.sensores[0].ultima_lectura.valor_pct).toBe(37.5)
    expect(r.body.data.actuadores[0]).toMatchObject({ codigo: 'BOMBA1', modo_configurado: 'DESHABILITADO', reportado: { estado_bomba: 'APAGADA', fiable: true } })
    // Calibrado y con hardware confirmado: MANUAL permitido; AUTOMATICO bloqueado por PERMITIR_ENCENDIDO=false.
    expect(r.body.data.actuadores[0].modos_no_permitidos).toEqual({ DESHABILITADO: null, MANUAL: null, AUTOMATICO: 'ENCENDIDO_DESHABILITADO' })
    const m = await web(tw, 'get', `/sensores/${e.sensorId}/mediciones`)
    expect(m.body.data).toHaveLength(1)
  })
})
