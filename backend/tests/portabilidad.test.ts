import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { bd, bloquearDispositivo, cerrarBd, ejecutar, fila, filas, sqlPorMotor, transaccion } from '../src/db.js'
import { config } from '../src/config.js'
import { CHECKS_ESPERADOS, verificarEsquema, tamanoBase } from '../src/verificacion.js'
import { escenario, iot, sesion, web, ack } from './ayudas.js'
import { sembrarDemo } from '../src/demo.js'

afterAll(() => cerrarBd())
const ahoraMas = () => sqlPorMotor({ mysql: 'NOW(3) + INTERVAL 30 SECOND', postgres: "now() + interval '30 seconds'" })
async function orden() {
  const e = await escenario()
  const r = await ejecutar(bd(), `INSERT INTO ordenes_riego (dispositivo_id,actuador_id,tipo,parametros,ttl_s,expira_en,solicitada_por) VALUES (?,?,'BOMBA_APAGAR','{}',30,${ahoraMas()},(SELECT id FROM usuarios WHERE email=?)) RETURNING id`, [e.dispositivoId,e.actuadorId,e.propietario])
  return { e, id: r.insertId }
}

describe('V-DDL y equivalencia de resultados', () => {
  it('verifica las 17 tablas, todos los triggers y los siete CHECK por nombre', async () => {
    const r = await verificarEsquema(bd())
    expect(r.correcto).toBe(true); expect(r.checks.sort()).toEqual([...CHECKS_ESPERADOS].sort())
    expect(r.triggers).toHaveLength(config().DB_MOTOR === 'postgres' ? 10 : 2)
  })
  it('RETURNING mantiene insertId, numeric y UTC con milisegundos', async () => {
    const e = await escenario()
    const t = new Date('2026-01-01T12:00:00.123Z')
    const r = await ejecutar(bd(), "INSERT INTO mediciones (sensor_id,valor,estado,medido_en,id_arranque,seq,uptime_ms) VALUES (?,55.5,'OK',?,'de000002',1,12345) RETURNING id", [e.sensorId,t])
    const row = await fila(bd(), 'SELECT * FROM mediciones WHERE id=?',[r.insertId])
    expect(typeof r.insertId).toBe('number'); expect(row!.valor).toBe(55.5); expect(row!.medido_en.toISOString()).toBe(t.toISOString()); expect(typeof row!.uptime_ms).toBe('number')
  })
  it('el seed demo rechaza una base con fixtures sin escribir ni alterar el origen', async () => {
    await escenario()
    const antes = await fila(bd(), 'SELECT COUNT(*) AS n FROM usuarios')
    await expect(sembrarDemo('clave-sintetica-demostracion')).rejects.toThrow()
    expect((await fila(bd(),'SELECT COUNT(*) AS n FROM usuarios'))!.n).toBe(antes!.n)
  })
  it('C-9.6 informa tamaño sin escritura y mantiene MySQL independiente', async () => {
    const r=await tamanoBase(bd(),500)
    if(config().DB_MOTOR==='postgres') {expect(r!.mb).toBeGreaterThan(0);expect(r!.nivel).toBe('OK')}
    else expect(r).toBeNull()
  })
})

describe('V-TRG inmutabilidad cláusula por cláusula', () => {
  it.each(['id', 'dispositivo_id', 'actuador_id', 'tipo', 'parametros', 'ttl_s', 'origen', 'solicitada_por', 'idempotency_key', 'creada_en', 'expira_en'])('no permite alterar identidad/contenido: %s', async (campo) => {
    const { id } = await orden()
    const valor = { id: 'id+10000', dispositivo_id:'dispositivo_id+10000', actuador_id:'actuador_id+10000', solicitada_por:'NULL', idempotency_key: "'otra'", creada_en: ahoraMas(), tipo: "'RESTABLECER_BLOQUEO'", parametros: "'{\"otro\":1}'", ttl_s:'ttl_s+1', origen:"'SISTEMA'", expira_en: ahoraMas() + sqlPorMotor({ mysql: ' + INTERVAL 1 SECOND', postgres: " + interval '1 second'" }) }[campo]!
    await expect(ejecutar(bd(), `UPDATE ordenes_riego SET ${campo}=${valor} WHERE id=?`,[id])).rejects.toThrow(/inmutable/)
  })
  it.each(['entregada_en','id_arranque_entrega','cancelada_en','motivo_cierre'])('campo de escritura única: %s', async (campo) => {
    const { id } = await orden()
    const fecha = campo.endsWith('_en'); const a = fecha ? new Date('2026-01-01T00:00:00Z') : 'aabbccdd'; const b = fecha ? new Date('2026-01-02T00:00:00Z') : 'eeff0011'
    await ejecutar(bd(),`UPDATE ordenes_riego SET ${campo}=? WHERE id=?`,[a,id])
    await ejecutar(bd(),`UPDATE ordenes_riego SET ${campo}=? WHERE id=?`,[a,id])
    await expect(ejecutar(bd(),`UPDATE ordenes_riego SET ${campo}=? WHERE id=?`,[b,id])).rejects.toThrow(/escritura unica/)
  })
  it.each(['EJECUTADA','RECHAZADA','FALLIDA','EXPIRADA','CANCELADA'])('estado terminal %s', async (estado) => {
    const { id } = await orden()
    await ejecutar(bd(),'UPDATE ordenes_riego SET estado=? WHERE id=?',[estado,id])
    await expect(ejecutar(bd(),"UPDATE ordenes_riego SET estado='PENDIENTE' WHERE id=?",[id])).rejects.toThrow(/final inmutable/)
  })
  it('SIN_CONFIRMAR admite ACK final; resultado, cuerpo y hora quedan inmutables', async () => {
    const { id } = await orden()
    await ejecutar(bd(),"UPDATE ordenes_riego SET estado='SIN_CONFIRMAR' WHERE id=?",[id])
    await ejecutar(bd(),"UPDATE ordenes_riego SET estado='EJECUTADA', resultado='EJECUTADA', ack_cuerpo='{}', confirmada_en=? WHERE id=?",[new Date('2026-01-01T00:00:00Z'),id])
    for (const [col,v] of [['resultado','FALLIDA'],['ack_cuerpo','{"otro":1}'],['confirmada_en',new Date('2026-01-02T00:00:00Z')]]) await expect(ejecutar(bd(),`UPDATE ordenes_riego SET ${col}=? WHERE id=?`,[v,id])).rejects.toThrow(/ACK inmutable/)
  })
  it('rechaza contadores decrecientes y DELETE directo', async () => {
    const { id } = await orden()
    for (const campo of ['ack_conflictos','intentos_entrega']) {
      await ejecutar(bd(),`UPDATE ordenes_riego SET ${campo}=2 WHERE id=?`,[id])
      await expect(ejecutar(bd(),`UPDATE ordenes_riego SET ${campo}=1 WHERE id=?`,[id])).rejects.toThrow(/contador decreciente/)
    }
    await expect(ejecutar(bd(),'DELETE FROM ordenes_riego WHERE id=?',[id])).rejects.toThrow(/borrado directo/)
  })
  it('PostgreSQL protege ante cascadas; MySQL mantiene su SET NULL', async () => {
    const { id, e } = await orden()
    const u = await fila(bd(),'SELECT id FROM usuarios WHERE email=?',[e.propietario])
    if (config().DB_MOTOR === 'postgres') {
      await expect(ejecutar(bd(),'DELETE FROM usuarios WHERE id=?',[u!.id])).rejects.toThrow(/inmutable/)
      await expect(ejecutar(bd(),'DELETE FROM dispositivos WHERE id=?',[e.dispositivoId])).rejects.toThrow()
      await ejecutar(bd(),'UPDATE usuarios SET activo=0 WHERE id=?',[u!.id])
    } else {
      await ejecutar(bd(),'DELETE FROM usuarios WHERE id=?',[u!.id])
      expect((await fila(bd(),'SELECT solicitada_por FROM ordenes_riego WHERE id=?',[id]))!.solicitada_por).toBeNull()
    }
  })
})

describe('V-TX concurrencia, permisos y rollback', () => {
  it('misma clave en cinco solicitudes produce una sola orden', async () => {
    const e = await escenario(); const token=await sesion(e.propietario); const key=randomUUID()
    const rr=await Promise.all(Array.from({length:5},()=>web(token,'post',`/dispositivos/${e.dispositivoId}/ordenes`).set('Idempotency-Key',key).send({tipo:'BOMBA_APAGAR',actuador:'BOMBA1'})))
    expect(rr.every(r=>[200,201].includes(r.status))).toBe(true)
    expect(new Set(rr.map(r=>r.body.data.id)).size).toBe(1)
    expect(Number((await fila(bd(),'SELECT COUNT(*) AS n FROM ordenes_riego WHERE idempotency_key=?',[key]))!.n)).toBe(1)
  })
  it('diez creaciones serializadas tienen IDs únicos crecientes y referencias coherentes', async () => {
    const e=await escenario(); const token=await sesion(e.propietario)
    const rr=await Promise.all(Array.from({length:10},()=>web(token,'post',`/dispositivos/${e.dispositivoId}/ordenes`).set('Idempotency-Key',randomUUID()).send({tipo:'BOMBA_APAGAR',actuador:'BOMBA1'})))
    expect(rr.every(r=>r.status===201)).toBe(true)
    const ids=rr.map(r=>r.body.data.id).sort((a,b)=>a-b)
    expect(new Set(ids).size).toBe(10)
    const rows=await filas(bd(),'SELECT id,cerrada_por_orden_id FROM ordenes_riego WHERE dispositivo_id=? ORDER BY id',[e.dispositivoId])
    expect(rows.map(r=>r.id)).toEqual(ids)
    expect(rows.every(r=>r.cerrada_por_orden_id===null || r.cerrada_por_orden_id>r.id)).toBe(true)
  })
  it('ACK equivalentes concurrentes no cambian el primer resultado', async () => {
    const e=await escenario(); const token=await sesion(e.propietario)
    const r=await web(token,'post',`/dispositivos/${e.dispositivoId}/ordenes`).send({tipo:'BOMBA_APAGAR',actuador:'BOMBA1'})
    await iot(e,'get','/ordenes'); const cuerpo=ack(e.arranque,{codigo_motivo:'SIN_CAMBIO'})
    const rr=await Promise.all(Array.from({length:3},()=>iot(e,'post',`/ordenes/${r.body.data.id}/confirmacion`).send(cuerpo)))
    expect(rr.map(r=>r.status)).toEqual([200,200,200])
  })
  it('veinte errores hacen rollback completo y liberan el pool', async () => {
    const e=await escenario()
    for(let i=0;i<20;i++) await expect(transaccion(async con=>{
      await bloquearDispositivo(con,e.dispositivoId)
      await ejecutar(con,'UPDATE dispositivos SET nombre=? WHERE id=?',['NO_PERSISTIR',e.dispositivoId])
      await ejecutar(con,'SELECT * FROM tabla_que_no_existe')
    })).rejects.toThrow()
    expect((await fila(bd(),'SELECT nombre FROM dispositivos WHERE id=?',[e.dispositivoId]))!.nombre).toBe('Prueba')
  })
  it('LEFT JOIN con sensor NULL permite actualizar sin bloqueo del lado nullable', async () => {
    const e=await escenario(); await ejecutar(bd(),'UPDATE configuraciones_control SET sensor_id=NULL WHERE actuador_id=?',[e.actuadorId])
    const r=await web(await sesion(e.propietario),'patch',`/actuadores/${e.actuadorId}/control`).send({modo:'DESHABILITADO'})
    expect(r.status).toBe(200)
  })
  it('V-TX-06 PostgreSQL devuelve 503 por lock_timeout sin reintentar; MySQL libera el bloqueo', async () => {
    const e=await escenario(); const token=await sesion(e.propietario)
    let listo!:()=>void, liberar!:()=>void
    const preparado=new Promise<void>(r=>{listo=r}); const espera=new Promise<void>(r=>{liberar=r})
    const bloqueo=transaccion(async con=>{await bloquearDispositivo(con,e.dispositivoId); listo(); await espera})
    await preparado
    if(config().DB_MOTOR==='postgres') {
      try {
        const inicio=Date.now()
        const r=await web(token,'patch',`/actuadores/${e.actuadorId}/control`).send({modo:'DESHABILITADO'})
        expect(r.status).toBe(503); expect(r.body.error.codigo).toBe('SERVICIO_NO_DISPONIBLE')
        expect(Date.now()-inicio).toBeLessThan(8000)
      } finally { liberar(); await bloqueo }
    } else { liberar(); await bloqueo; expect((await iot(e,'get','/ordenes')).status).toBe(200) }
  })
  it('V-TX-04 crear y consultar concurrentemente entrega como máximo en el siguiente sondeo', async () => {
    const e=await escenario(); const token=await sesion(e.propietario)
    const [creada,consulta]=await Promise.all([
      web(token,'post',`/dispositivos/${e.dispositivoId}/ordenes`).send({tipo:'BOMBA_APAGAR',actuador:'BOMBA1'}),
      iot(e,'get','/ordenes'),
    ])
    expect(creada.status).toBe(201); expect(consulta.status).toBe(200)
    const siguiente=await iot(e,'get','/ordenes')
    expect(siguiente.body.data.ordenes.map((o:{id:number})=>o.id)).toContain(creada.body.data.id)
  })
  it('reintenta la transacción completa; los IDs consumidos por rollback no se reutilizan', async () => {
    const e=await escenario();const ids:number[]=[];let veces=0
    await transaccion(async con=>{
      await bloquearDispositivo(con,e.dispositivoId)
      const r=await ejecutar(con,`INSERT INTO ordenes_riego (dispositivo_id,actuador_id,tipo,parametros,ttl_s,expira_en) VALUES (?,?,'BOMBA_APAGAR','{}',30,${ahoraMas()}) RETURNING id`,[e.dispositivoId,e.actuadorId])
      ids.push(r.insertId)
      if(++veces<3) throw Object.assign(new Error('deadlock simulado'),{code:config().DB_MOTOR==='postgres'?'40P01':'ER_LOCK_DEADLOCK'})
    })
    expect(veces).toBe(3);expect(ids[0]).toBeLessThan(ids[1]);expect(ids[1]).toBeLessThan(ids[2])
    expect(Number((await fila(bd(),'SELECT COUNT(*) AS n FROM ordenes_riego WHERE dispositivo_id=?',[e.dispositivoId]))!.n)).toBe(1)
  })
  it('email insensible a mayúsculas; login normalizado y logout conserva atributos de cookie', async () => {
    const e=await escenario()
    expect(await sesion(e.propietario.toUpperCase())).toBeTruthy()
    const u=await fila(bd(),'SELECT password_hash FROM usuarios WHERE email=?',[e.propietario])
    await expect(ejecutar(bd(),"INSERT INTO usuarios (nombre,email,password_hash) VALUES ('Duplicado',?,?)",[e.propietario.toUpperCase(),u!.password_hash])).rejects.toThrow()
    const r=await web(await sesion(e.propietario),'post','/auth/logout')
    expect(r.status).toBe(200)
    const cookie=String(r.headers['set-cookie'])
    for(const atributo of ['Path=/api/v1/auth','HttpOnly','Secure','SameSite=Strict']) expect(cookie).toContain(atributo)
  })
})
