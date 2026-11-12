import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db.js', () => ({
  bd: vi.fn(() => { throw new Error('BD no permitida en esta suite') }),
  fila: vi.fn(), filas: vi.fn(), ejecutar: vi.fn(), transaccion: vi.fn(), bloquearDispositivo: vi.fn(), sqlPorMotor: (sql: { mysql: string }) => sql.mysql,
}))
import { crearApp } from '../../src/app.js'
import { config, reiniciarConfig } from '../../src/config.js'
import { exigirRol } from '../../src/middlewares/seguridad.js'
import { bd, fila } from '../../src/db.js'
import type { Request } from 'express'

const original = { ...process.env }
const directorio = mkdtempSync(join(tmpdir(), 'agro-spa-segura-'))
mkdirSync(join(directorio, 'assets'))
writeFileSync(join(directorio, 'index.html'), '<!doctype html><html><body>SPA sintética</body></html>')
writeFileSync(join(directorio, 'assets', 'index-12345678.js'), 'console.log("fixture")')
afterAll(() => {
  process.env = original; reiniciarConfig()
  // Ruta creada arriba por mkdtemp, nunca un directorio suministrado por el usuario.
  rmSync(directorio, { recursive: true, force: true })
})
beforeEach(() => {
  process.env = { NODE_ENV: 'test', DB_USUARIO: 'sintetico', JWT_SECRETO: 'prueba-cloud-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', PERMITIR_ENCENDIDO: 'false', CORS_ORIGENES: 'https://panel.prueba.invalid', SERVIR_FRONTEND: directorio }
  reiniciarConfig(); vi.clearAllMocks()
  vi.mocked(bd).mockImplementation(() => { throw new Error('BD no permitida en esta suite') })
})

describe('mismo origen y aislamiento de API', () => {
  it.each(['/', '/ruta-spa'])('%s entrega HTML, CSP y revalidación', async (ruta) => {
    const r = await request(crearApp()).get(ruta).set('Accept', 'text/html')
    expect(r.status).toBe(200)
    expect(r.type).toBe('text/html')
    expect(r.text).toContain('SPA sintética')
    expect(r.headers['cache-control']).toBe('no-cache')
    expect(r.headers['content-security-policy']).toContain("script-src 'self'")
  })
  it('assets con hash son inmutables; assets ausentes no devuelven SPA', async () => {
    const app = crearApp()
    expect((await request(app).get('/assets/index-12345678.js')).headers['cache-control']).toContain('immutable')
    expect((await request(app).get('/assets/ausente.js')).status).toBe(404)
  })
  it.each(['/api/x', '/api/v1/x'])('API desconocida %s nunca responde HTML', async (ruta) => {
    const r = await request(crearApp()).get(ruta)
    expect([401, 404]).toContain(r.status)
    expect(r.type).toBe('application/json')
    expect(bd).not.toHaveBeenCalled()
  })
  it('salud degradada es JSON sin filtrar el error de conexión', async () => {
    const r = await request(crearApp()).get('/api/v1/salud')
    expect(r.status).toBe(503)
    expect(r.body.data.base_datos).toBe('NO_DISPONIBLE')
    expect(r.text).not.toContain('BD no permitida')
  })
  it('desactivado por defecto; falla si se configura un build ausente', async () => {
    delete process.env.SERVIR_FRONTEND; reiniciarConfig()
    expect((await request(crearApp()).get('/')).status).toBe(404)
    process.env.SERVIR_FRONTEND = join(directorio, 'ausente'); reiniciarConfig()
    expect(() => crearApp()).toThrow(/SERVIR_FRONTEND/)
  })
  it('V-AUTH CSP usa el HTML REAL de la build y permite el tema externo sin scripts inline', async () => {
    process.env.SERVIR_FRONTEND = resolve('../frontend/dist-real'); reiniciarConfig()
    const app = crearApp()
    const r = await request(app).get('/').set('Accept','text/html')
    expect(r.status).toBe(200)
    expect(r.text).toContain('/tema-inicial.js')
    expect(r.text).not.toMatch(/<script\b[^>]*>\s*[^<\s]/)
    expect(r.headers['content-security-policy']).toContain('https://fonts.googleapis.com')
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(r.headers['content-security-policy']).not.toContain('upgrade-insecure-requests')
    expect(r.headers['strict-transport-security']).toBeUndefined()
    const tema = await request(app).get('/tema-inicial.js')
    expect(tema.status).toBe(200)
    expect(tema.text).toContain('agc-tema')
  })
})

describe('seguridad sin conexión', () => {
  it('CORS rechaza otro origen antes de autenticar o consultar BD', async () => {
    const r = await request(crearApp()).post('/api/v1/auth/refresh').set('Origin', 'https://ajeno.invalid')
    expect(r.status).toBe(403)
    expect(r.body.error.codigo).toBe('ORIGEN_NO_PERMITIDO')
    expect(bd).not.toHaveBeenCalled()
  })
  it('preflight conserva credenciales sólo para origen permitido', async () => {
    const r = await request(crearApp()).options('/api/v1/auth/refresh').set({ Origin: 'https://panel.prueba.invalid', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' })
    expect(r.status).toBe(204)
    expect(r.headers['access-control-allow-credentials']).toBe('true')
  })
  it('diagnóstico está desactivado por defecto y sólo expone datos del solicitante al habilitarlo', async () => {
    expect((await request(crearApp()).get('/api/v1/diagnostico/proxy')).status).toBe(404)
    process.env.DIAGNOSTICO_PROXY = 'true'; reiniciarConfig()
    const r = await request(crearApp()).get('/api/v1/diagnostico/proxy')
    expect(r.status).toBe(200)
    expect(Object.keys(r.body).sort()).toEqual(['ip','ips','protocolo','saltos_xff','secure'])
  })
  it('JWT incorrecto o algoritmo distinto se rechazan sin consultar BD', async () => {
    const app = crearApp()
    const token = jwt.sign({ sub: 1 }, config().JWT_SECRETO, { algorithm: 'HS384' })
    for (const valor of ['invalido', token]) {
      expect((await request(app).get('/api/v1/terrenos').auth(valor, { type: 'bearer' })).status).toBe(401)
    }
    expect(bd).not.toHaveBeenCalled()
  })
  it('IoT rechaza HTTP y token ausente incluso con HTTPS simulado del proxy local', async () => {
    const app = crearApp()
    const plano = await request(app).get('/api/v1/iot/ordenes')
    expect(plano.body.error.codigo).toBe('HTTPS_REQUERIDO')
    const seguro = await request(app).get('/api/v1/iot/ordenes').set('X-Forwarded-Proto', 'https')
    expect(seguro.status).toBe(401)
    expect(bd).not.toHaveBeenCalled()
  })
  it('no confía en X-Forwarded-Proto enviado desde un cliente fuera de TRUST_PROXY', async () => {
    process.env.TRUST_PROXY = '192.0.2.1'; reiniciarConfig()
    const r = await request(crearApp()).get('/api/v1/iot/ordenes').set('X-Forwarded-Proto', 'https')
    expect(r.body.error.codigo).toBe('HTTPS_REQUERIDO')
  })
  it('rol LECTOR no puede operar y no miembro obtiene 404 sin revelar terreno', async () => {
    vi.mocked(bd).mockReturnValue({} as ReturnType<typeof bd>)
    const req = { usuario: { id: 1, rol: 'USUARIO', nombre: 'Sintético' } } as Request
    vi.mocked(fila).mockResolvedValueOnce({ rol: 'LECTOR' })
    await expect(exigirRol(req, 1, 'OPERADOR', 'RECURSO_NO_ENCONTRADO')).rejects.toMatchObject({ estado: 403 })
    vi.mocked(fila).mockResolvedValueOnce(null)
    await expect(exigirRol(req, 1, 'LECTOR', 'RECURSO_NO_ENCONTRADO')).rejects.toMatchObject({ estado: 404 })
  })
  it('V-AUTH-05 limita por IP+email; otro email no consume el mismo cubo', async () => {
    vi.mocked(bd).mockReturnValue({} as ReturnType<typeof bd>)
    vi.mocked(fila).mockResolvedValue(null)
    const app=crearApp()
    for(let i=0;i<5;i++) expect((await request(app).post('/api/v1/auth/login').send({email:'uno@prueba.invalid',password:'incorrecta'})).status).toBe(401)
    expect((await request(app).post('/api/v1/auth/login').send({email:'UNO@prueba.invalid',password:'incorrecta'})).status).toBe(429)
    expect((await request(app).post('/api/v1/auth/login').send({email:'otro@prueba.invalid',password:'incorrecta'})).status).toBe(401)
  }, 15000)
})
