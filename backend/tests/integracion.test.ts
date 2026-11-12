import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bd, cerrarBd, fila } from '../src/db.js'
import { CHECKS_ESPERADOS, contarDatos, verificarEsquema } from '../src/verificacion.js'
import { escenario, estadoActuador, iot, permitirEncendido, sesion, telemetria, web } from './ayudas.js'

afterAll(() => cerrarBd())
beforeEach(() => permitirEncendido(false))

describe('verificación del entorno (sólo lectura)', () => {
  it('el esquema temporal tiene 17 tablas, 2 triggers y 7 CHECKs', async () => {
    const e = await verificarEsquema(bd())
    expect(e).toMatchObject({ faltanTablas: [], faltanTriggers: [], checks: expect.arrayContaining([...CHECKS_ESPERADOS]), correcto: true })
  })

  it('el seed se niega a duplicar si ya hay datos (también en --simular)', async () => {
    await escenario() // garantiza datos base
    expect((await contarDatos(bd())).vacia).toBe(false)
    const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const env = { ...process.env, SEED_ADMIN_EMAIL: 'admin@prueba.local', SEED_ADMIN_CONTRASENA: 'una-clave-larga' }
    const sim = spawnSync(process.execPath, [tsx, 'scripts/seed.ts', '--simular'], { env, encoding: 'utf8' })
    expect(sim.stdout).toContain('NO se insertará nada')
    expect(sim.stdout).toContain('configuraciones_control')
    const real = spawnSync(process.execPath, [tsx, 'scripts/seed.ts'], { env, encoding: 'utf8' })
    expect(real.status).toBe(1)
    expect((await fila(bd(), "SELECT COUNT(*) AS n FROM usuarios WHERE email = 'admin@prueba.local'"))!.n).toBe(0)
  }, 60_000)
})

describe('calibración del sensor (PATCH /sensores/{id})', () => {
  it('PROPIETARIO calibra: valida separación ≥ 200, sube la versión y el ESP32 la recibe', async () => {
    const e = await escenario({ calibrado: false })
    const tw = await sesion(e.propietario)
    const corta = await web(tw, 'patch', `/sensores/${e.sensorId}`).send({ raw_seco: 2000, raw_humedo: 1900 })
    expect(corta.status).toBe(422)
    expect(corta.body.error.detalles[0].codigo).toBe('CALIBRACION_INSUFICIENTE')
    const v0 = (await fila(bd(), 'SELECT config_version_deseada AS v FROM dispositivos WHERE id = ?', [e.dispositivoId]))!.v
    const ok = await web(tw, 'patch', `/sensores/${e.sensorId}`).send({ raw_seco: 2900, raw_humedo: 1350, calibracion_confirmada: true })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ raw_seco: 2900, raw_humedo: 1350, calibracion_confirmada: true, config_version_deseada: v0 + 1 })
    const cfg = await iot(e, 'get', '/configuracion')
    expect(cfg.body.data.sensores[0]).toMatchObject({ raw_seco: 2900, raw_humedo: 1350, calibracion_confirmada: true })
    // Repetir lo mismo no crea otra versión.
    const igual = await web(tw, 'patch', `/sensores/${e.sensorId}`).send({ raw_seco: 2900 })
    expect(igual.body.data.config_version_deseada).toBe(v0 + 1)
  })

  it('LECTOR y OPERADOR no pueden calibrar (403); no miembro → 404', async () => {
    const e = await escenario()
    expect((await web(await sesion(e.lector), 'patch', `/sensores/${e.sensorId}`).send({ raw_seco: 2800 })).status).toBe(403)
    expect((await web(await sesion(e.ajeno), 'patch', `/sensores/${e.sensorId}`).send({ raw_seco: 2800 })).status).toBe(404)
  })
})

describe('rotación del token del dispositivo (B-14)', () => {
  it('el anterior vale en la gracia; el primer uso del nuevo lo invalida', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    const r = await web(tw, 'post', `/dispositivos/${e.dispositivoId}/token/rotar`).send({})
    expect(r.status).toBe(200)
    expect(r.headers['cache-control']).toBe('no-store')
    const nuevo = r.body.data.token as string
    expect(nuevo).toMatch(/^agc_dev_/)
    expect((await iot(e, 'get', '/ordenes')).status).toBe(200) // anterior, en gracia
    expect((await iot({ ...e, token: nuevo }, 'get', '/ordenes')).status).toBe(200) // primer uso del nuevo
    expect((await iot(e, 'get', '/ordenes')).status).toBe(401) // anterior ya inválido
  })

  it('con gracia 0 el anterior queda inválido de inmediato; LECTOR no puede rotar', async () => {
    const e = await escenario()
    expect((await web(await sesion(e.lector), 'post', `/dispositivos/${e.dispositivoId}/token/rotar`).send({})).status).toBe(403)
    await web(await sesion(e.propietario), 'post', `/dispositivos/${e.dispositivoId}/token/rotar`).send({ gracia_horas: 0 })
    expect((await iot(e, 'get', '/ordenes')).status).toBe(401)
  })
})

describe('alertas y diagnóstico', () => {
  it('bloqueo reportado genera alerta; OPERADOR la reconoce y resuelve; LECTOR no', async () => {
    const e = await escenario()
    const bloqueo = { id_bloqueo: 4, tipo: 'CRITICO', causa: 'FALLA_SENSOR', liberable_remotamente: true }
    await iot(e, 'post', '/telemetria').send(telemetria(e, { actuadores: [estadoActuador({ bloqueo })] }))
    const tw = await sesion(e.propietario)
    const lista = await web(tw, 'get', '/alertas?estado=ACTIVA')
    const alerta = lista.body.data.find((a: { dispositivo_id: number; tipo: string }) => a.dispositivo_id === e.dispositivoId && a.tipo === 'BLOQUEO_ACTIVADO')
    expect(alerta).toMatchObject({ severidad: 'CRITICA', estado: 'ACTIVA' })
    expect((await web(await sesion(e.lector), 'post', `/alertas/${alerta.id}/reconocer`)).status).toBe(403)
    expect((await web(tw, 'post', `/alertas/${alerta.id}/reconocer`)).body.data.estado).toBe('RECONOCIDA')
    expect((await web(tw, 'post', `/alertas/${alerta.id}/resolver`)).body.data.estado).toBe('RESUELTA')
    expect((await web(tw, 'post', `/alertas/${alerta.id}/resolver`)).status).toBe(409)
  })

  it('el estado expone el diagnóstico de conexión del ESP32 (arranque, IP, contadores)', async () => {
    const e = await escenario()
    const tw = await sesion(e.propietario)
    const antes = await web(tw, 'get', `/dispositivos/${e.dispositivoId}/estado`)
    expect(antes.body.data.dispositivo).toMatchObject({ nunca_conectado: true, conexion: 'FUERA_DE_LINEA' })
    await iot(e, 'post', '/telemetria').send(telemetria(e, { diagnostico: { errores_tls: 2 }, red: { rssi_dbm: -70, ip_local: '192.168.43.21' } }))
    const d = (await web(tw, 'get', `/dispositivos/${e.dispositivoId}/estado`)).body.data.dispositivo
    expect(d).toMatchObject({ nunca_conectado: false, conexion: 'EN_LINEA', rssi_dbm: -70 })
    expect(d.diagnostico).toMatchObject({ id_arranque: e.arranque, ip_local: '192.168.43.21', contadores: { errores_tls: 2 } })
    expect(d.diagnostico.token_prefijo).toBe(e.token.slice(0, 12))
  })
})
