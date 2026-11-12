import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../src/db.js', () => ({ bd: vi.fn(() => ({})), ejecutar: vi.fn(async () => ({ affectedRows: 1, insertId: 0 })), sqlPorMotor: (sql: { mysql: string }) => sql.mysql }))
import { ejecutar } from '../../src/db.js'
import { actualizarPresencia, reiniciarPresencia } from '../../src/presencia.js'

beforeEach(() => { vi.clearAllMocks(); reiniciarPresencia() })
describe('V-IOT-02 presencia sin cachear autenticación', () => {
  it('tres solicitudes en menos de dos segundos producen una escritura', async () => {
    await actualizarPresencia(1, '127.0.0.1', 'aabbccdd', false)
    await actualizarPresencia(1, '127.0.0.1', 'aabbccdd', false)
    await actualizarPresencia(1, '127.0.0.1', 'aabbccdd', false)
    expect(ejecutar).toHaveBeenCalledTimes(1)
  })
  it('cambio de IP o arranque fuerza persistencia', async () => {
    await actualizarPresencia(1, '127.0.0.1', 'aabbccdd', false)
    await actualizarPresencia(1, '127.0.0.2', 'aabbccdd', false)
    await actualizarPresencia(1, '127.0.0.2', 'eeff0011', true)
    expect(ejecutar).toHaveBeenCalledTimes(3)
  })
  it('un error no envenena la caché y una petición posterior reintenta', async () => {
    vi.mocked(ejecutar).mockRejectedValueOnce(new Error('fallo simulado'))
    await expect(actualizarPresencia(1, null, 'aabbccdd', false)).rejects.toThrow()
    await actualizarPresencia(1, null, 'aabbccdd', false)
    expect(ejecutar).toHaveBeenCalledTimes(2)
  })
})
