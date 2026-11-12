import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { ErrorApi } from '../errores.js'

// ---------------------------------------------------------------- tiempo
export const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)
export const ahoraIso = () => new Date().toISOString()

// ---------------------------------------------------------------- tokens
export const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex')
export const tokenAleatorio = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const nuevoTokenDispositivo = () => `agc_dev_${tokenAleatorio(32)}` // 256 bits (contrato §5.1)
export const uuid = () => randomUUID()

export function igualesTiempoConstante(a: string, b: string) {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// ---------------------------------------------------------------- validación (contrato §13.1.2)
export const MAX_SEGURO = Number.MAX_SAFE_INTEGER
export const entero = z.number().int().safe()
export const enteroNoNeg = entero.min(0)
export const idEntero = entero.min(1).max(MAX_SEGURO)
export const idArranque = z.string().regex(/^[0-9a-f]{8}$/, 'Debe ser 8 caracteres hex en minúscula')
export const codigo = z.string().regex(/^[A-Z0-9_]{2,16}$/, 'Código inválido')
export const enumReportado = z.string().regex(/^[A-Z_]{2,40}$/, 'Enumeración inválida')
export const fechaUtc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'Debe ser ISO-8601 UTC con Z')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inexistente')

export const MODOS = ['DESHABILITADO', 'MANUAL', 'AUTOMATICO'] as const
export type Modo = (typeof MODOS)[number]
export const RANGO_MODO: Record<string, number> = { DESHABILITADO: 0, MANUAL: 1, AUTOMATICO: 2 }

/** Parámetro de ruta numérico estricto: ^[1-9][0-9]{0,15}$ y ≤ 2^53−1. */
export function idRuta(valor: string | undefined, nombre = 'id'): number {
  if (!valor || !/^[1-9][0-9]{0,15}$/.test(valor) || Number(valor) > MAX_SEGURO) {
    throw new ErrorApi(422, 'VALIDACION_FALLIDA', 'Identificador inválido.', [
      { campo: nombre, codigo: 'FORMATO_INVALIDO', mensaje: 'Debe ser un entero entre 1 y 2^53-1.' },
    ])
  }
  return Number(valor)
}

export const r1 = (n: number) => Math.round(n * 10) / 10
