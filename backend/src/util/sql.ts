/** Marcadores de aplicación; los operadores JSONB ? se expresan con funciones explícitas. */
export function marcadoresPostgres(sql: string): string {
  let salida = '', n = 0
  for (let i = 0; i < sql.length;) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let fin = i + 1
      for (; fin < sql.length; fin++) {
        if (sql[fin] === '\\') { fin++; continue }
        if (sql[fin] === q) { if (sql[fin + 1] === q) { fin++; continue }; fin++; break }
      }
      salida += sql.slice(i, fin); i = fin; continue
    }
    if (sql.slice(i, i + 2) === '--' || sql.slice(i, i + 2) === '/*') {
      const bloque = sql[i + 1] === '*'
      const fin = bloque ? sql.indexOf('*/', i + 2) : sql.indexOf('\n', i + 2)
      const hasta = fin < 0 ? sql.length : fin + (bloque ? 2 : 1)
      salida += sql.slice(i, hasta); i = hasta; continue
    }
    if (c === '$' && /^\$(?:[A-Za-z_]\w*)?\$/.test(sql.slice(i))) {
      const etiqueta = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i))![0]
      const fin = sql.indexOf(etiqueta, i + etiqueta.length)
      if (fin < 0) throw new Error('Literal SQL sin cierre')
      salida += sql.slice(i, fin + etiqueta.length); i = fin + etiqueta.length; continue
    }
    if (c === '?') {
      if (/[|&]/.test(sql[i + 1] ?? '') || /[\w)\]"']\s*$/.test(salida) && /^\s*['"$]/.test(sql.slice(i + 1))) throw new Error('Operador JSONB ? prohibido; use una función explícita.')
      salida += '$' + ++n; i++; continue
    }
    salida += c; i++
  }
  return salida
}
export function quitarReturning(sql: string): string { return sql.replace(/\s+RETURNING\s+id\s*;?\s*$/i, '') }
export function enteroSeguro(valor: string): number {
  const n = Number(valor)
  if (!Number.isSafeInteger(n)) throw new Error('Entero de BD fuera del rango seguro')
  return n
}
