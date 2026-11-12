import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
/** Sólo la llaman arneses que poseen la base temporal; nunca acepta URLs externas. */
export async function humoTemporal(env) {
  if (env.NODE_ENV !== 'test' || env.DB_HOST !== '127.0.0.1') throw new Error('Humo reservado a loopback temporal')
  const puerto=await new Promise(r=>{const s=createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})})
  const child=spawn(process.execPath,[fileURLToPath(new URL('../dist/src/server.js',import.meta.url))], {
    cwd:fileURLToPath(new URL('../',import.meta.url)),
    env:{...env, HOST:'127.0.0.1',PORT:String(puerto),SERVIR_FRONTEND:fileURLToPath(new URL('../../frontend/dist-real/',import.meta.url))}, stdio:'ignore',
  })
  const salida=new Promise(r=>{child.once('exit',r);child.once('error',()=>r(1))})
  const base=`http://127.0.0.1:${puerto}`
  try {
    let listo=false
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null) throw new Error('El servidor compilado no arrancó')
      try { const r=await fetch(base+'/api/v1/salud'); if(r.status===200) {listo=true;break} } catch {}
      await new Promise(r=>setTimeout(r,100))
    }
    assert.ok(listo,'Salud no alcanzada')
    assert.equal((await fetch(base+'/',{headers:{Accept:'text/html'}})).status,200)
    const api=await fetch(base+'/api/x');assert.equal(api.status,404);assert.ok(api.headers.get('content-type').includes('application/json'))
    assert.equal((await fetch(base+'/api/v1/iot/ordenes',{headers:{'X-Forwarded-Proto':'https'}})).status,401)
    console.log('PASS: arranque compilado, salud BD, SPA real, 404 JSON y autenticación IoT; sin MySQL local para PostgreSQL.')
  } finally { child.kill('SIGTERM'); await salida }
}
