import { afterEach, describe, expect, it, vi } from 'vitest'
import { claveIdempotencia, FuenteApi } from './api'

// Respuestas mínimas con la forma del contrato §11.
const ESTADO = {
  dispositivo: { id: 1, uid: 'AGC-ESP32-0001', nombre: 'ESP32 Banco', conexion: 'EN_LINEA', ultima_conexion_en: '2026-10-15T12:00:00.000Z', segundos_desde_conexion: 2, rssi_dbm: -60, version_firmware: '0.2.0', version_contrato: '1.0.2', hardware_confirmado: true, tope_riego_s: 600, reloj_confiable: true, persistencia_ok: true, tls_vigencia: 'VERIFICADOR', config_version_deseada: 3, config_version_aplicada: 3 },
  sensores: [{ id: 5, codigo: 'HUM1', tipo: 'HUMEDAD_SUELO', modelo: 'Capacitivo D43', zona: { id: 9, nombre: 'Cama 1' }, calibracion_confirmada: true, ultima_lectura: { valor_pct: 41.5, valor_raw: 2000, estado: 'OK', medido_en: '2026-10-15T12:00:00.000Z' } }],
  actuadores: [{ id: 7, codigo: 'BOMBA1', modo_configurado: 'MANUAL', reportado: { modo: 'MANUAL', estado_bomba: 'APAGADA', riego_transcurrido_s: 0, riego_restante_s: 0, descanso_restante_s: 0, bloqueo: null, rearmes_remotos_episodio: 0, id_orden_activa: null, reportado_en: '2026-10-15T12:00:00.000Z', antiguedad_s: 2, fiable: true }, control: { umbral_inicio_pct: 30, umbral_parada_pct: 55, riego_max_s: 15, descanso_min_s: 60, valores_de_banco: true }, acciones_permitidas: { encender: false, apagar: true, rearmar: false, motivo_encender_no_permitido: 'ENCENDIDO_DESHABILITADO' } }],
}

function servidorFalso(opciones: { sesionValida: boolean }) {
  const llamadas: { url: string; init?: RequestInit }[] = []
  const json = (estado: number, data: unknown) => Promise.resolve(new Response(JSON.stringify(estado < 400 ? { data } : { error: data }), { status: estado }))
  const fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    llamadas.push({ url, init })
    if (url.endsWith('/auth/refresh'))
      return opciones.sesionValida ? json(200, { token_acceso: 'jwt-1', usuario: { nombre: 'Admin', email: 'a@b', rol: 'ADMIN' } }) : json(401, { codigo: 'NO_AUTENTICADO', mensaje: 'x' })
    if (url.endsWith('/auth/login')) return json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Email o contraseña incorrectos.' })
    if (url.endsWith('/terrenos')) return json(200, [{ id: 1 }])
    if (url.endsWith('/terrenos/1/dispositivos')) return json(200, [{ id: 1 }])
    if (url.endsWith('/dispositivos/1/estado')) return json(200, ESTADO)
    if (url.includes('/sensores/5/mediciones')) return json(200, [{ medido_en: '2026-10-15T11:59:00.000Z', valor_pct: 40, valor_raw: 2010, estado: 'OK' }])
    if (url.includes('/dispositivos/1/ordenes') && init?.method === 'POST') return json(409, { codigo: 'ENCENDIDO_DESHABILITADO', mensaje: 'Encendido deshabilitado.' })
    if (url.includes('/dispositivos/1/ordenes')) return json(200, [])
    if (url.includes('/dispositivos/1/eventos')) return json(200, [{ id: 1, tipo: 'RIEGO_FINALIZADO', datos: { motivo_fin: 'UMBRAL_ALCANZADO' }, ocurrido_en: '2026-10-15T11:58:00.000Z' }])
    if (url.includes('/zonas/9/riegos')) return json(200, [])
    if (url.endsWith('/alertas')) return json(200, [{ id: 3, dispositivo_id: 1, tipo: 'BLOQUEO_ACTIVADO', severidad: 'CRITICA', mensaje: 'Bloqueo', estado: 'ACTIVA', creada_en: '2026-10-15T11:57:00.000Z' }, { id: 4, dispositivo_id: 1, tipo: 'X', severidad: 'INFO', mensaje: 'Vieja', estado: 'RESUELTA', creada_en: '2026-10-15T11:00:00.000Z' }])
    return json(404, { codigo: 'RECURSO_NO_ENCONTRADO', mensaje: url })
  })
  vi.stubGlobal('fetch', fetchFalso)
  return llamadas
}

const esperar = async (fuente: FuenteApi, cond: () => boolean) => {
  for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
  return fuente.estado()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FuenteApi (modo REAL)', () => {
  it('sin sesión válida queda anónimo y no consulta datos', async () => {
    const llamadas = servidorFalso({ sesionValida: false })
    const f = new FuenteApi()
    const e = await esperar(f, () => f.estado().sesion.tipo !== 'verificando')
    expect(e.sesion.tipo).toBe('anonimo')
    expect(llamadas.some((l) => l.url.includes('/estado'))).toBe(false)
  })

  it('login fallido muestra el mensaje del backend', async () => {
    servidorFalso({ sesionValida: false })
    const f = new FuenteApi()
    await esperar(f, () => f.estado().sesion.tipo !== 'verificando')
    await f.iniciarSesion('a@b.c', 'mala')
    const s = f.estado().sesion
    expect(s.tipo === 'anonimo' && s.error).toBe('Email o contraseña incorrectos.')
  })

  it('con sesión: construye la vista del panel desde el contrato §11.3', async () => {
    servidorFalso({ sesionValida: true })
    const f = new FuenteApi()
    const e = await esperar(f, () => f.estado().vista !== null)
    const v = e.vista!
    expect(f.esDemo).toBe(false)
    expect(v.dispositivo).toMatchObject({ uid: 'AGC-ESP32-0001', conexion: 'EN_LINEA', config_version_aplicada: 3 })
    expect(v.sensor.valor_pct).toBe(41.5)
    expect(v.actuador.reportado).toMatchObject({ modo: 'MANUAL', estado_bomba: 'APAGADA', fiable: true })
    expect(v.actuador.acciones.motivo_encender_no_permitido).toBe('ENCENDIDO_DESHABILITADO')
    expect(v.historial).toEqual([{ t: Date.parse('2026-10-15T11:59:00.000Z'), pct: 40, bomba: false }])
    expect(v.eventos[0].detalle).toBe('Riego finalizado: Humedad objetivo alcanzada')
  })

  it('sólo muestra alertas abiertas del dispositivo', async () => {
    servidorFalso({ sesionValida: true })
    const f = new FuenteApi()
    const v = (await esperar(f, () => f.estado().vista !== null)).vista!
    expect(v.alertas!.map((a) => a.id)).toEqual([3])
    await f.cerrarSesion()
  })

  it('backend caído: conserva datos como NO fiables, deshabilita acciones y se recupera', async () => {
    servidorFalso({ sesionValida: true })
    const f = new FuenteApi()
    await esperar(f, () => f.estado().vista !== null)
    // El backend deja de responder (fetch rechaza, como con el servidor apagado).
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await f.recargar()
    let v = f.estado().vista!
    expect(v.enlace).toMatchObject({ ok: false, fallos_consecutivos: 1 })
    expect(v.actuador.reportado.fiable).toBe(false)
    expect(v.actuador.acciones).toMatchObject({ encender: false, apagar: false, rearmar: false, motivo_encender_no_permitido: 'BACKEND_NO_DISPONIBLE' })
    expect(v.sensor.valor_pct).toBe(41.5) // último dato conservado, marcado como no actual
    expect((await f.enviarOrden('BOMBA_APAGAR', {})).ok).toBe(false)
    // Vuelve el backend.
    servidorFalso({ sesionValida: true })
    await f.recargar()
    v = f.estado().vista!
    expect(v.enlace).toMatchObject({ ok: true, fallos_consecutivos: 0 })
    expect(v.actuador.acciones.apagar).toBe(true)
    await f.cerrarSesion()
  })

  it('enviarOrden manda Idempotency-Key y propaga el rechazo del servidor', async () => {
    const llamadas = servidorFalso({ sesionValida: true })
    const f = new FuenteApi()
    await esperar(f, () => f.estado().vista !== null)
    const r = await f.enviarOrden('BOMBA_ENCENDER', { duracion_s: 5 })
    expect(r).toMatchObject({ ok: false, codigo: 'ENCENDIDO_DESHABILITADO' })
    const post = llamadas.find((l) => l.init?.method === 'POST' && l.url.includes('/ordenes'))!
    expect((post.init!.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.parse(String(post.init!.body))).toEqual({ tipo: 'BOMBA_ENCENDER', actuador: 'BOMBA1', parametros: { duracion_s: 5 } })
    await f.cerrarSesion()
  })

  it('dos peticiones con el token caducado comparten UN refresco (evita revocar la sesión por reutilización)', async () => {
    const llamadas = servidorFalso({ sesionValida: true })
    const f = new FuenteApi()
    await esperar(f, () => f.estado().vista !== null)
    const antes = llamadas.filter((l) => l.url.endsWith('/auth/refresh')).length
    const original = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    let caducado = true
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (caducado && !url.includes('/auth/')) return Promise.resolve(new Response(JSON.stringify({ error: { codigo: 'TOKEN_EXPIRADO' } }), { status: 401 }))
      if (url.endsWith('/auth/refresh')) caducado = false
      return original(url, init)
    })
    await Promise.all([f.alertasDetalle(), f.historial('1h')])
    expect(llamadas.filter((l) => l.url.endsWith('/auth/refresh')).length - antes).toBe(1)
    f.cerrarSesion()
  })
})

describe('claveIdempotencia', () => {
  it('genera un UUID v4 sin crypto.randomUUID (celular por http://<IP-LAN>, contexto no seguro)', () => {
    const original = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: (b: Uint8Array) => original.getRandomValues(b) })
    const claves = new Set(Array.from({ length: 50 }, () => claveIdempotencia()))
    expect(claves.size).toBe(50)
    for (const c of claves) expect(c).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
