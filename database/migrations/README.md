# Migraciones

## Línea base

| Versión | Archivo | Contenido |
|---|---|---|
| **001** (base) | [`../schema.sql`](../schema.sql) | Esquema del contrato 1.0.2: 17 tablas, 2 triggers, 7 CHECKs. Es el esquema importado en `agrocontrol` (2026-10-15). |

No hay migraciones posteriores: el backend actual funciona sobre la línea base **sin cambios de esquema**.

- La agregación del historial, la calibración, las alertas y la rotación de tokens usan columnas que ya existen.
- `npm run verificar` (en `backend/`) comprueba que la base coincide con la línea base: tablas, triggers y CHECKs por nombre. También audita la consistencia de los datos en modo de **sólo lectura**.

## Reglas para futuras migraciones

1. Un archivo por cambio: `002_descripcion.sql`, `003_…`. Nunca se edita uno ya aplicado.
2. **Sólo cambios aditivos o con copia previa.**
   - `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, índices nuevos.
   - Prohibidos `DROP` y `TRUNCATE` sobre datos, y renombrados destructivos sin autorización expresa.
3. Cada migración se prueba primero con `npm test`, que usa una MySQL temporal aislada, y se documenta en [`../../documentacion/MODELO_DATOS.md`](../../documentacion/MODELO_DATOS.md).
4. Antes de aplicarla en `agrocontrol`, hacer una copia de seguridad:
   `mysqldump --single-transaction --routines --triggers -u <usuario> -p agrocontrol > agrocontrol-AAAAMMDD.sql`
5. Los cambios que afecten al contrato API (§7 a §11) se coordinan antes con Codex (firmware).
6. Cuando exista la primera migración, se añadirá una tabla de control `migraciones_aplicadas` mediante su propia migración aditiva.
