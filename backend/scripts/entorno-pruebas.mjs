import { randomBytes } from 'node:crypto'
export function entornoPruebas(extra = {}) {
  const env = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return { ...env, NODE_ENV: 'test', DB_MOTOR: 'mysql', DB_HOST: '127.0.0.1', DB_USUARIO: 'root', DB_CONTRASENA: '', DB_NOMBRE: 'agrocontrol', DB_SSL: 'false', TRUST_PROXY: 'loopback', JWT_SECRETO: randomBytes(48).toString('base64url'), LIMITES_DESACTIVADOS: 'true', IOT_PERMITIR_HTTP_LOCAL: 'false', PERMITIR_ENCENDIDO: 'false', TZ: 'America/Guatemala', ...extra }
}
