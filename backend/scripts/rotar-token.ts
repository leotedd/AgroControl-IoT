// Rota el token de un dispositivo desde la consola local (contrato §5.1).
//   npm run token:rotar -- AGC-ESP32-0001            (gracia de 24 h para el token anterior)
//   npm run token:rotar -- AGC-ESP32-0001 --gracia 0 (invalida el anterior de inmediato)
// Muestra el token nuevo UNA sola vez. Sólo modifica la fila de ese dispositivo.
import 'dotenv/config'
import { bd, cerrarBd, fila, transaccion } from '../src/db.js'
import { rotarToken } from '../src/modulos/servicio.js'

async function principal() {
  const uid = process.argv[2]
  const i = process.argv.indexOf('--gracia')
  const gracia = i > 0 ? Number(process.argv[i + 1]) : 24
  if (!uid || !/^[A-Z0-9-]{3,40}$/.test(uid)) throw new Error('Uso: npm run token:rotar -- <UID> [--gracia horas]')
  if (!Number.isInteger(gracia) || gracia < 0 || gracia > 72) throw new Error('--gracia debe ser un entero entre 0 y 72')
  const d = await fila(bd(), 'SELECT id FROM dispositivos WHERE uid = ?', [uid])
  if (!d) throw new Error(`No existe el dispositivo ${uid}`)
  const r = await transaccion((con) => rotarToken(con, { dispositivoId: d.id, usuarioId: null, graciaHoras: gracia }))
  console.log(`Token de ${r.uid} rotado. El anterior vale ${r.gracia_horas} h más.`)
  console.log('TOKEN NUEVO (se muestra UNA sola vez):')
  console.log(`  ${r.token}`)
}

principal()
  .catch((e) => {
    console.error('Error:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => cerrarBd())
