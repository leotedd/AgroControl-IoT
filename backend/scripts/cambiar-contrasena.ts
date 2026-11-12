import { sqlPorMotor } from '../src/db.js'
// Cambia la contraseña de un usuario de la web desde la consola local.
//   npm run admin:contrasena -- correo@ejemplo.com
// La contraseña se escribe sin mostrarse (dos veces), se guarda sólo como hash bcrypt,
// desbloquea la cuenta y revoca todas sus sesiones abiertas. No toca otros usuarios.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { bd, cerrarBd, ejecutar, fila, transaccion } from '../src/db.js'

function leerOculto(pregunta: string): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const entrada = process.stdin
    if (!entrada.isTTY) return rechazar(new Error('Ejecútelo en una consola interactiva (no por tubería).'))
    process.stdout.write(pregunta)
    entrada.setRawMode(true)
    entrada.resume()
    entrada.setEncoding('utf8')
    let valor = ''
    const alPulsar = (s: string) => {
      for (const c of s) {
        if (c === '\r' || c === '\n') {
          entrada.setRawMode(false)
          entrada.pause()
          entrada.off('data', alPulsar)
          process.stdout.write('\n')
          return resolver(valor)
        }
        if (c === '\u0003') {
          entrada.setRawMode(false)
          process.stdout.write('\n')
          return rechazar(new Error('Cancelado.'))
        }
        if (c === '\u0008' || c === '\u007f') valor = valor.slice(0, -1)
        else if (c >= ' ') valor += c
      }
    }
    entrada.on('data', alPulsar)
  })
}

async function principal() {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Uso: npm run admin:contrasena -- <correo>')
  const u = await fila(bd(), 'SELECT id FROM usuarios WHERE email = ?', [email])
  if (!u) throw new Error(`No existe el usuario ${email}`)

  const nueva = await leerOculto('Contraseña nueva (mín. 12 caracteres): ')
  if (nueva.length < 12) throw new Error('Debe tener al menos 12 caracteres.')
  if (new Set(nueva).size < 6) throw new Error('Demasiado repetitiva; elija otra.')
  if ((await leerOculto('Repítala: ')) !== nueva) throw new Error('No coinciden; no se cambió nada.')

  const hash = await bcrypt.hash(nueva, 12)
  const revocadas = await transaccion(async (con) => {
    await ejecutar(con, 'UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [hash, u.id])
    const r = await ejecutar(con, sqlPorMotor({ mysql: 'UPDATE tokens_refresco SET revocado_en = NOW(3) WHERE usuario_id = ? AND revocado_en IS NULL', postgres: `UPDATE tokens_refresco SET revocado_en = now() WHERE usuario_id = ? AND revocado_en IS NULL` }), [u.id])
    await ejecutar(con, "INSERT INTO auditoria (usuario_id, actor, accion, entidad, entidad_id) VALUES (?, 'SISTEMA', 'CONTRASENA_CAMBIADA', 'usuarios', ?) RETURNING id", [u.id, String(u.id)])
    return r.affectedRows
  })
  console.log(`Contraseña de ${email} cambiada. Sesiones revocadas: ${revocadas}.`)
}

principal()
  .catch((e) => {
    console.error('Error:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => cerrarBd())
