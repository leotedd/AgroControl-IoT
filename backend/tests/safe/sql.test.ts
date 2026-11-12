import { describe, expect, it } from 'vitest'
import { enteroSeguro, marcadoresPostgres, quitarReturning } from '../../src/util/sql.js'

describe('V-SQL-10 léxico SQL sin conexión', () => {
  it('sólo numera parámetros, no literales, identificadores ni comentarios', () => {
    expect(marcadoresPostgres(`SELECT '?', 'a''?b', "?", $$?$$, ? -- ?\n/* ? */ WHERE id = ?`))
      .toBe(`SELECT '?', 'a''?b', "?", $$?$$, $1 -- ?\n/* ? */ WHERE id = $2`)
  })
  it.each(["SELECT datos ? 'clave'", "SELECT datos ?| array['x']", "SELECT datos ?& array['x']"])('rechaza operador JSONB: %s', (sql) => {
    expect(() => marcadoresPostgres(sql)).toThrow(/Operador JSONB/)
  })
  it('MySQL sólo elimina el sufijo exacto RETURNING id', () => {
    expect(quitarReturning('INSERT INTO t (n) VALUES (?) RETURNING id')).toBe('INSERT INTO t (n) VALUES (?)')
    expect(quitarReturning("SELECT 'RETURNING id' AS texto")).toBe("SELECT 'RETURNING id' AS texto")
  })
  it('int8 valida precisión antes de llegar a JSON', () => {
    expect(enteroSeguro('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => enteroSeguro('9007199254740992')).toThrow(/rango seguro/)
  })
})
