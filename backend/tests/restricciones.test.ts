import { afterAll, describe, expect, it } from 'vitest'
import { bd, cerrarBd, ejecutar, fila, sqlPorMotor } from '../src/db.js'
import { escenario } from './ayudas.js'
afterAll(() => cerrarBd())

describe('V-CHK fronteras de las siete restricciones de negocio en ambos motores', () => {
  it.each([5,3600])('acepta intervalo de telemetría %i', async n => {
    const e=await escenario(); await ejecutar(bd(),'UPDATE dispositivos SET intervalo_telemetria_s=? WHERE id=?',[n,e.dispositivoId])
  })
  it.each([4,3601])('rechaza intervalo de telemetría %i', async n => {
    const e=await escenario(); await expect(ejecutar(bd(),'UPDATE dispositivos SET intervalo_telemetria_s=? WHERE id=?',[n,e.dispositivoId])).rejects.toThrow()
  })
  it.each([2,60])('preserva CHECK de órdenes %i (no es permiso para cambiar firmware)', async n => {
    const e=await escenario(); await ejecutar(bd(),'UPDATE dispositivos SET intervalo_ordenes_s=? WHERE id=?',[n,e.dispositivoId])
  })
  it.each([1,61])('rechaza intervalo de órdenes %i', async n => {
    const e=await escenario(); await expect(ejecutar(bd(),'UPDATE dispositivos SET intervalo_ordenes_s=? WHERE id=?',[n,e.dispositivoId])).rejects.toThrow()
  })
  it.each([null,1,600])('acepta tope %s', async n => {
    const e=await escenario(); await ejecutar(bd(),'UPDATE dispositivos SET tope_riego_s=? WHERE id=?',[n,e.dispositivoId])
  })
  it.each([0,601])('rechaza tope %i', async n => {
    const e=await escenario(); await expect(ejecutar(bd(),'UPDATE dispositivos SET tope_riego_s=? WHERE id=?',[n,e.dispositivoId])).rejects.toThrow()
  })
  it.each([[3000,1300],[21,221],[4074,3874]])('acepta calibración %i/%i', async (a,b) => {
    const e=await escenario(); await ejecutar(bd(),'UPDATE sensores SET raw_seco=?,raw_humedo=? WHERE id=?',[a,b,e.sensorId])
  })
  it.each([[20,1300],[3000,4075],[1500,1400],[1300,1499]])('rechaza calibración %i/%i', async (a,b) => {
    const e=await escenario(); await expect(ejecutar(bd(),'UPDATE sensores SET raw_seco=?,raw_humedo=? WHERE id=?',[a,b,e.sensorId])).rejects.toThrow()
  })
  it('histéresis de 5 acepta; de 4,9 rechaza', async () => {
    const e=await escenario(); await ejecutar(bd(),'UPDATE configuraciones_control SET umbral_inicio_pct=30,umbral_parada_pct=35 WHERE actuador_id=?',[e.actuadorId])
    await expect(ejecutar(bd(),'UPDATE configuraciones_control SET umbral_parada_pct=34.9 WHERE actuador_id=?',[e.actuadorId])).rejects.toThrow()
  })
  it.each([['umbral_inicio_pct',95.1],['umbral_parada_pct',4.9],['riego_max_s',4],['riego_max_s',601],['descanso_min_s',4],['descanso_min_s',86401]])('rechaza rango %s=%s', async (col,v) => {
    const e=await escenario(); await expect(ejecutar(bd(),`UPDATE configuraciones_control SET ${col}=? WHERE actuador_id=?`,[v,e.actuadorId])).rejects.toThrow()
  })
  it.each([[0,5,5,5],[95,100,600,86400]])('acepta extremos de control %i/%i/%i/%i', async (a,b,c,d) => {
    const e=await escenario(); await ejecutar(bd(),'UPDATE configuraciones_control SET umbral_inicio_pct=?,umbral_parada_pct=?,riego_max_s=?,descanso_min_s=? WHERE actuador_id=?',[a,b,c,d,e.actuadorId])
  })
  it.each([9,901])('rechaza TTL %i al insertar', async ttl => {
    const e=await escenario()
    await expect(ejecutar(bd(),sqlPorMotor({ mysql:"INSERT INTO ordenes_riego (dispositivo_id,actuador_id,tipo,parametros,ttl_s,expira_en) VALUES (?,?,'BOMBA_APAGAR','{}',?,NOW(3))",postgres:"INSERT INTO ordenes_riego (dispositivo_id,actuador_id,tipo,parametros,ttl_s,expira_en) VALUES (?,?,'BOMBA_APAGAR','{}',?,now())" }),[e.dispositivoId,e.actuadorId,ttl])).rejects.toThrow()
  })
  it.each([10,900])('acepta TTL %i, duración NULL/1/600 y rechaza 0/601', async ttl => {
    const e=await escenario()
    const r=await ejecutar(bd(),sqlPorMotor({ mysql:"INSERT INTO ordenes_riego (dispositivo_id,actuador_id,tipo,parametros,ttl_s,expira_en) VALUES (?,?,'BOMBA_APAGAR','{}',?,NOW(3)) RETURNING id",postgres:"INSERT INTO ordenes_riego (dispositivo_id,actuador_id,tipo,parametros,ttl_s,expira_en) VALUES (?,?,'BOMBA_APAGAR','{}',?,now()) RETURNING id" }),[e.dispositivoId,e.actuadorId,ttl])
    for(const n of [null,1,600]) await ejecutar(bd(),'UPDATE ordenes_riego SET duracion_aplicada_s=? WHERE id=?',[n,r.insertId])
    for(const n of [0,601]) await expect(ejecutar(bd(),'UPDATE ordenes_riego SET duracion_aplicada_s=? WHERE id=?',[n,r.insertId])).rejects.toThrow()
    expect(typeof (await fila(bd(),'SELECT id FROM ordenes_riego WHERE id=?',[r.insertId]))!.id).toBe('number')
  })
})
