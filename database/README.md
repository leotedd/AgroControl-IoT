# Base de datos

- `schema.sql`: esquema completo (contrato 1.0.2). Revisado para MySQL 26.7; requiere MySQL 8.0.16+ por los `CHECK`. Documentado en [`../documentacion/MODELO_DATOS.md`](../documentacion/MODELO_DATOS.md).
- `importar-esquema.ps1`: importa el esquema **sólo** en la base `agrocontrol`.
- `migrations/`: (fase 2) migraciones numeradas.

## Importar el esquema (Windows)

Requisitos: la base `agrocontrol` ya existe y está **vacía**.

```powershell
# 1) Sólo comprobaciones (no importa nada)
powershell -ExecutionPolicy Bypass -File database\importar-esquema.ps1 -SoloComprobar
# 2) Importación
powershell -ExecutionPolicy Bypass -File database\importar-esquema.ps1
# opcional: -Usuario root -Servidor 127.0.0.1 -Puerto 3306
```

El script:
1. Analiza `schema.sql` antes de conectar. Aborta si encuentra `DROP`, `TRUNCATE`, `DELETE FROM`, `GRANT`, un `USE` o `CREATE DATABASE` de otra base, o referencias `otra_base.tabla`.
2. Pide la contraseña sin mostrarla. La pasa a `mysql.exe` mediante un archivo de opciones temporal, de acceso restringido, que se borra al terminar. Nunca va en la línea de comandos ni en el repositorio.
3. Aborta si `agrocontrol` no existe o si ya tiene tablas. No sobrescribe nada.
4. Envía el SQL por la entrada estándar con `--database=agrocontrol --commands`.
5. Si MySQL falla, muestra su mensaje con el número de línea y las tablas creadas parcialmente, sin borrar nada.
6. Verifica por nombre las 17 tablas y los 2 triggers, y comprueba que la huella de las demás bases (por ejemplo `parroquiasdb`) es idéntica antes y después.

> **Nota sobre MySQL 26.7:** el cliente `mysql` tiene `commands = FALSE` por defecto en modo no interactivo. Sin `--commands`, `source`, `USE` y `DELIMITER` no se procesan. Por eso el importador anterior, que usaba `-e "source …"` y `--one-database`, terminaba sin error y con 0 tablas. No se usa `--one-database`, porque en esta versión su filtro es poco fiable.

El esquema no contiene `DROP`, `TRUNCATE` ni `DELETE`, ni crea bases. Los `CREATE USER` y `GRANT` de la sección 8 son sólo una referencia comentada.
