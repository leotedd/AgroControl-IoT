import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
vi.mock('../../src/db.js', () => ({ bd: vi.fn(() => ({})), fila: vi.fn(), filas: vi.fn(async () => []), ejecutar: vi.fn(async () => ({ affectedRows: 1, insertId: 0 })), transaccion: vi.fn(), bloquearDispositivo: vi.fn(), sqlPorMotor: (s: {mysql:string}) => s.mysql }))
import { crearApp } from '../../src/app.js'
import { fila, transaccion, bloquearDispositivo, ejecutar, type ConTx } from '../../src/db.js'
import { reiniciarConfig } from '../../src/config.js'
import { reiniciarPresencia } from '../../src/presencia.js'
import { nuevoTokenDispositivo, sha256 } from '../../src/util/comun.js'
const original={...process.env}; const token=nuevoTokenDispositivo()
beforeEach(()=>{
  process.env={NODE_ENV:'test',DB_USUARIO:'sintetico',JWT_SECRETO:'prueba-fast-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',PERMITIR_ENCENDIDO:'false'}
  reiniciarConfig(); reiniciarPresencia(); vi.clearAllMocks()
})
afterAll(()=>{process.env=original;reiniciarConfig()})
describe('V-IOT-01 camino rápido conserva autenticación y cancelación',()=>{
  it('dos consultas sin órdenes no abren transacción ni cachean el token',async()=>{
    vi.mocked(fila).mockImplementation(async (_con,sql)=>sql.includes('WHERE token_hash') ? {id:1,uid:'FICTICIO',estado:'ACTIVO',terreno_id:1,token_hash:sha256(token),id_arranque_actual:'aabbccdd'} : sql.includes('config_version_deseada') ? {config_version_deseada:3} : null)
    const app=crearApp()
    for(let n=0;n<2;n++) {
      const r=await request(app).get('/api/v1/iot/ordenes').set({Authorization:`Bearer ${token}`,'X-Id-Arranque':'aabbccdd','X-Forwarded-Proto':'https'})
      expect(r.status).toBe(200);expect(r.body.data.ordenes).toEqual([]);expect(r.body.data.config_version).toBe(3)
    }
    expect(transaccion).not.toHaveBeenCalled();expect(bloquearDispositivo).not.toHaveBeenCalled()
    expect(vi.mocked(fila).mock.calls.filter(([,s])=>s.includes('WHERE token_hash'))).toHaveLength(2)
  })
  it('una orden pendiente entra al camino lento y conserva la cancelación de ENCENDER',async()=>{
    vi.mocked(fila).mockImplementation(async (_con,sql)=>sql.includes('WHERE token_hash') ? {id:2,uid:'FICTICIO',estado:'ACTIVO',terreno_id:1,token_hash:sha256(token),id_arranque_actual:'aabbccdd'} : {n:1})
    vi.mocked(bloquearDispositivo).mockResolvedValue({config_version_deseada:3})
    vi.mocked(transaccion).mockImplementation(async fn=>fn({} as ConTx))
    const r=await request(crearApp()).get('/api/v1/iot/ordenes').set({Authorization:`Bearer ${token}`,'X-Id-Arranque':'aabbccdd','X-Forwarded-Proto':'https'})
    expect(r.status).toBe(200); expect(transaccion).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ejecutar).mock.calls.some(([,s])=>s.includes('ENCENDIDO_DESHABILITADO'))).toBe(true)
  })
})
