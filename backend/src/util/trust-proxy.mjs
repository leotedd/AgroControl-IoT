import { isIP } from 'node:net'

// Función pura, sin dotenv, conexión a BD ni cambios en el proceso del servidor.
export function validarTrustProxy(valor = 'loopback') {
  if (typeof valor !== 'string') throw new Error('TRUST_PROXY debe ser una lista de alias, IP o CIDR.')
  if (/^saltos:[1-3]$/.test(valor)) return Number(valor.slice(-1))
  const entradas = valor.split(',').map((v) => v.trim())
  const aliases = new Set(['loopback', 'linklocal', 'uniquelocal'])
  for (const entrada of entradas) {
    if (aliases.has(entrada)) continue
    const partes = entrada.split('/')
    const version = isIP(partes[0])
    if (!version || partes.length > 2) throw new Error('TRUST_PROXY contiene un alias, IP o CIDR inválido.')
    if (partes.length === 2) {
      const prefijo = partes[1]
      // Rechazar /0 también en IPv6: no confiar en Internet completo.
      if (!/^(?:[1-9]\d*)$/.test(prefijo) || Number(prefijo) > (version === 4 ? 32 : 128)) {
        throw new Error('TRUST_PROXY contiene un prefijo CIDR inválido o universal (/0).')
      }
    }
  }
  return entradas
}
