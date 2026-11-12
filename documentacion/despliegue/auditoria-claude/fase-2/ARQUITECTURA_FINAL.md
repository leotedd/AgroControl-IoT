# Arquitectura final de despliegue — AgroControl-IoT

- **Fecha:** 2026-11-09 · **Estado:** aprobada a nivel de diseño. La implementación queda sujeta a las puertas de [INFORME_SUPERVISION.md](INFORME_SUPERVISION.md). Ningún recurso real está creado ni autorizado en esta fase.
- **Entradas:** `auditoria-claude/` (Fase 1, 6 documentos) y `preparacion-codex/` (Fase 1, 7 documentos).

---

## 1. Consolidación de las auditorías de la Fase 1

### 1.1 Coincidencias (hallazgos confirmados por ambas)

| Tema | Hallazgo común |
|---|---|
| Acoplamiento MySQL | Adaptador, SQL de módulos, scripts, pruebas y catálogos de arranque. Sin ORM. `DATABASE_URL` no existe. |
| Esquema | 17 tablas, 2 triggers, 7 CHECK, verificados en el DDL. |
| Triggers y FK | En PostgreSQL las cascadas FK disparan triggers: el diseño MySQL de «borrado administrativo posible» no se traslada tal cual. |
| `FOR UPDATE` + LEFT JOIN | `actualizarControl` falla en PostgreSQL; requiere `FOR UPDATE OF`. |
| Tipos | `bigint`/`numeric` llegan como texto con `pg`; UTC; JSON; colación de `email`. |
| Mismo origen | La cookie `Strict` y `credentials:'same-origin'` obligan a servir web y API desde el mismo origen. |
| `TRUST_PROXY` | El validador existe pero no está integrado. |
| Tareas escritoras | Se inician al arrancar: jamás apuntar un backend de ensayo a la MySQL real. |

### 1.2 Aportes exclusivos incorporados

| Origen | Aporte | Incorporación |
|---|---|---|
| Codex | **Aislamiento:** PostgreSQL usa READ COMMITTED y InnoDB REPEATABLE READ por defecto | Decisión §4.3 y pruebas V-TX |
| Codex | Una transacción PostgreSQL queda **abortada** tras un error: «capturar y seguir» no equivale a MySQL | Contrato C-6.1 (`ON CONFLICT` con objetivo exacto) y regla §4.4 |
| Codex | Hay 8 tablas con `ON UPDATE CURRENT_TIMESTAMP`, no 10 | **Corrige** la matriz de la Fase 1 (C-4.1) |
| Codex | Fallo textual en `tests/firmware/test_artifacts.py` (12/13): espera `relay=UNTOUCHED` literal y el código usa `relay=%s` | Riesgo RS2-07; no bloquea (no afecta a la seguridad física) |
| Codex | El *pooler* de Neon funciona por transacción y no admite `SET` de sesión | Con Supabase se usa el modo **sesión** (C-3.9) |
| Claude | **Neon Free no aguanta 24/7** (100 CU-h ≈ 16–17 días) | Base de demostración en **Supabase Free** (decisión aprobada) |
| Claude | `verificacion.ts` impide arrancar en PostgreSQL (el conteo de CHECK incluye NOT NULL) | C-5 (verificación por nombre) |
| Claude | Ancho de banda de 5 GB en Render Hobby; tráfico estimado del ESP32 | OPTIMIZACION_IOT |
| Claude (Fase 2) | **Lease de API de 4 s en el firmware**: subir el sondeo a 5 s apagaría todo riego manual a los 4 s | C-8.4: `intervalo_ordenes_s` ≤ 3; **anula D-6** |

### 1.3 Discrepancias resueltas

| Tema | Fase 1 Claude | Fase 1 Codex | Resolución |
|---|---|---|---|
| Booleanos `TINYINT` | `SMALLINT` 0/1 | `boolean` o `smallint` temporal | **`SMALLINT` + CHECK (0,1)**: cero cambios en las comparaciones del código ni en la serialización; reversible |
| `INT UNSIGNED` | Tipo un escalón mayor | `bigint` o rango explícito | PK/FK → `INTEGER` (2^31 suficiente); valores de contrato hasta 2^32−1 → `BIGINT` + CHECK de rango |
| ENUM | `TEXT` + CHECK | Pendiente | `TEXT` + `ck_enum_*` |
| Destino | Supabase | Neon (documento de configuración) | **Supabase** (aprobado). El documento `CONFIGURACION_RENDER_NEON.md` se usa como insumo, sustituyendo el *pooling* de Neon por el modo sesión de Supabase |
| Frontend | Static Site con reescritura o Express | Proxy o servidor aprobado | **Express sirve la SPA** (§3) |
| Migración de datos | Migrador con huellas | Respaldo y manifiesto | **No se migran datos**: la base de demostración es nueva (aprobado). El migrador queda diferido |

## 2. Diagrama

```
                   ┌──────────────────────── Render Free Web Service (1 instancia) ─────────────────────┐
Navegador / móvil  │  Node 22 · Express                                                                 │
 https://<svc>.onrender.com ──►  /api/v1/*   → API (auth, panel, iot, salud)                           │
                   │             /assets/*   → dist-real (inmutable)                                    │
                   │             /*          → index.html (SPA)                                         │
ESP32 ─HTTPS (CA LE+GTS)─► /api/v1/iot/*    · tareas internas: caducidad 15 s, presencia 30 s            │
                   └──────────────────────────────────┬──────────────────────────────────────────────────┘
                                                      │ TLS verify-full · pooler Supavisor modo SESIÓN (IPv4)
                                                      ▼
                                    Supabase Free · PostgreSQL 17 · base NUEVA de demostración
                                    17 tablas · 10 triggers (2 de negocio + 8 actualizado_en) · 7 CHECK de negocio

PC local (sin cambios): MySQL agrocontrol INTACTA · DB_MOTOR=mysql por defecto · vuelta atrás disponible
```

## 3. Mismo origen: el backend sirve el frontend compilado

**Decisión: sí.** Un único Web Service de Render entrega la API y `dist-real`.

| Criterio | Express sirve la SPA | Static Site + reescritura `/api` | Orígenes separados |
|---|---|---|---|
| Cookie `SameSite=Strict` | ✅ mismo origen garantizado | ⚠ depende de que la reescritura actúe como proxy (no verificado; Codex también lo marca como pendiente) | ❌ `onrender.com` está en la PSL; exigiría `SameSite=None`, `credentials:'include'`, CSRF y fallaría con el bloqueo de cookies de terceros (Safari/ITP) |
| Horas de instancia | 1 servicio (≤ 744 h/mes) | 1 + sitio estático (sin horas) | Igual |
| Arranque en frío | Afecta también a la carga de la web (30–60 s) | La web carga y la API espera | Igual que la reescritura |
| Ancho de banda | Todo cuenta para el espacio de trabajo (5 GB) | También cuenta (el Static Site está en el mismo espacio de trabajo) | Igual |
| Cambios de código | `express.static` + *fallback* (C-1) | Ninguno, pero con dependencia de una característica no verificada | Autenticación rediseñada |
| `req.ip` y límites | Directo (una cadena de proxy) | Puede quedar la IP del proxy de reescritura | — |

El único coste real es que el arranque en frío también retrasa la carga de la web. Se mitiga con la pantalla «servidor despertando» y no ocurre mientras el ESP32 esté en línea (sus peticiones mantienen el servicio despierto).

## 4. Base de datos

### 4.1 Supabase Free (demostración)

- PostgreSQL 17, región us-east (cercana a Render Ohio/Virginia y a Guatemala).
- Conexión por el *pooler* **Supavisor en modo sesión** (IPv4; la conexión directa es sólo IPv6 en Free). Pool de la aplicación ≤ 5.
- TLS `verify-full` con la CA de Supabase en `DB_SSL_CA`.
- Roles: `agro_owner` (DDL; sólo se usa al crear el esquema, fuera de esta fase) y `agro_app` (DML acotado, C-4.4).
- Límites: 500 MB y *egress* ≈ 5 GB/mes. Sin copias automáticas en Free: `pg_dump` externo diario cuando exista la base real (fase posterior).

### 4.2 Estrategia de adaptación de las 17 tablas, 2 triggers y 7 CHECK

1. **Esquema paralelo**, no transformado: `database/postgres/schema.sql` vive junto a `database/schema.sql` (intacto). Una revisión cruzada (V-DDL) compara tabla por tabla columnas, nulabilidad, valores por defecto, índices, FK y acciones.
2. **Nombres invariantes** (C-4.2): las herramientas de verificación y los mensajes de error siguen siendo los mismos.
3. **CHECK de negocio:** se trasladan 1:1. Las restricciones técnicas nuevas (`ck_enum_`, `ck_rango_`, `ck_bool_`) reemplazan garantías que en MySQL daban el tipo `ENUM` o `UNSIGNED`. Se enumeran y prueban por separado.
4. **Triggers de negocio:** traducción cláusula por cláusula, con la misma batería de pruebas en ambos motores (V-TRG). Los 8 triggers `actualizado_en` reemplazan `ON UPDATE CURRENT_TIMESTAMP`.
5. **Verificación de arranque por nombre** (C-5) y comprobación de que los triggers están habilitados.

### 4.3 Equivalencia transaccional

| Aspecto | MySQL (actual) | PostgreSQL (destino) | Equivalencia |
|---|---|---|---|
| Aislamiento | REPEATABLE READ | **READ COMMITTED** | Las transacciones críticas empiezan con `SELECT … FOR UPDATE` sobre `dispositivos` (bloqueo con lectura actual). En InnoDB, la vista de lectura se crea en la primera lectura **no** bloqueante, que ocurre *después* de obtener el bloqueo. En READ COMMITTED, cada sentencia ve lo confirmado, y con el dispositivo bloqueado ningún otro escritor de ese dispositivo avanza. **Resultado observable equivalente** para el flujo serializado por dispositivo. Se valida con V-TX-01…06. |
| Bloqueo de filas | `FOR UPDATE` bloquea las filas del JOIN | `FOR UPDATE OF <alias>` explícito | Se bloquean las mismas filas lógicas (órdenes / actuador + configuración) |
| Deadlock | `ER_LOCK_DEADLOCK`, reintento ×3 | `40P01`, reintento ×3 | Igual |
| Espera de bloqueo | `innodb_lock_wait_timeout` 50 s | `lock_timeout` 5 s → 503 | Más estricto: mejor para el ESP32 (timeout de 8 s) |
| Identificadores | `AUTO_INCREMENT` creciente; creación serializada por el bloqueo del dispositivo | `IDENTITY` (secuencia); creación serializada igual | Por dispositivo, el orden de los ids coincide con el orden de creación: la secuencia se consume dentro de la sección crítica. Puede haber huecos tras un ROLLBACK, como en MySQL. El contrato §8.2 se cumple (V-ID-01) |
| Deduplicación | `INSERT IGNORE` (silencia **todo** error) | `ON CONFLICT (cols) DO NOTHING` | Más estricto: los errores de FK y CHECK ya no se silencian (mejora) |
| `affectedRows` | Filas coincidentes (`CLIENT_FOUND_ROWS`) | `rowCount` (filas coincidentes) | Igual |
| Hora | `NOW(3)` por sentencia | `now()` por transacción | Diferencia de milisegundos dentro de transacciones cortas; sin efecto en reglas (verificado en V-TIME) |
| Inmutabilidad ante cascadas FK | No se dispara | **Se dispara** | Más estricto; aceptado (D-4: baja lógica) |

### 4.4 Regla de oro para errores dentro de transacciones

En PostgreSQL, tras cualquier error, la transacción sólo admite ROLLBACK. Ningún código puede capturar un error SQL dentro de `transaccion()` y continuar. Las inserciones deduplicadas se resuelven con `ON CONFLICT`, nunca con `try/catch`.

## 5. Decisiones de arquitectura (registro)

| ID | Decisión | Estado |
|---|---|---|
| AD-01 | Render Free (1 Web Service) + Supabase Free; base nueva de demostración | **Aprobada** por el usuario |
| AD-02 | Doble motor `DB_MOTOR` (MySQL por defecto) para conservar la vuelta atrás | **Aprobada** |
| AD-03 | El backend sirve la SPA (mismo origen) | Decidida (arquitectura) |
| AD-04 (D-4) | Inmutabilidad estricta ante cascadas FK; baja lógica | Decidida (arquitectura). Ninguna ruta actual borra usuarios ni dispositivos |
| AD-05 | Booleanos `SMALLINT` 0/1; ENUM como `TEXT` + CHECK; `JSONB`; `TIMESTAMPTZ(3)` | Decidida |
| AD-06 | READ COMMITTED + bloqueo inicial del dispositivo | Decidida |
| AD-07 | `intervalo_ordenes_s` ≤ 3 (lease del firmware) | Decidida; **anula D-6** |
| AD-08 | Retención de 30 días de datos crudos + agregados horarios | Decidida en el diseño; **el permiso DELETE en `mediciones` requiere confirmación** del usuario antes del bloque 5 |
| AD-09 | `TRUST_PROXY` admite `saltos:N` (1–3) además de alias y CIDR; valor medido en Render | Decidida |
| AD-10 | Sin migración de datos históricos en esta fase | **Aprobada** (base nueva) |

## 6. Control local del ESP32 cuando la nube no responde (verificado en el firmware)

| Mecanismo | Archivo | Comportamiento |
|---|---|---|
| Lease de API | `ManualSafety.h` (`ApiLeaseMs=4000`) | Un riego activo se detiene (`Stop::Api`) si pasan ≥ 4 s sin una respuesta correcta de la API, y queda **bloqueado** (`latched_`) |
| Tope absoluto | `ManualSafety.h` (`MaximumMs=5000`), `Settings.h` (`absoluteMaximumSeconds=5`) | Ningún riego supera 5 s |
| Temporizador de hardware | `ManualRelay.h` (`esp_timer` → `Stop::Backup`) | Corte independiente del bucle principal |
| Pérdida de Wi-Fi, reloj o sensor | `ManualSafety.h::tick` | Apaga y bloquea |
| Sin automático | `Settings.h` (`static_assert(!enableAutomaticAtBoot)`) | No hay riego autónomo |
| Relé sin tocar | `Settings.h` (`manualBenchEnabled=false`, `relay3v3Compatible=false`, `relayBootOffVerified=false`) | En esta compilación el GPIO del relé ni siquiera se configura (`relay=UNTOUCHED`) |

**Conclusión:** ante cualquier fallo de la nube (Render dormido o caído, Supabase en sólo lectura, TLS), el estado seguro es **bomba apagada** sin depender del servidor. La optimización **NO DEBE** alargar el intervalo de órdenes por encima de 3 s, porque eso convertiría el lease en un corte sistemático (C-8.4).

## 7. Límites operativos de la demostración

| Recurso | Límite | Presupuesto de diseño | Alarma |
|---|---|---|---|
| Render: horas | 750 h/espacio de trabajo | 1 servicio ≈ 744 h | — |
| Render: ancho de banda | 5 GB/mes | ≤ 2,5 GB (OPTIMIZACION_IOT) | 70 % |
| Supabase: almacenamiento | 500 MB | ≤ 150 MB en régimen (30 días de crudo + agregados) | 60 % / 80 % (C-9.6) |
| Supabase: *egress* | ≈ 5 GB/mes | ≤ 2 GB | 70 % |
| Supabase: inactividad | Pausa a los 7 días | El ESP32 o el uso lo evitan | — |

## 8. Vuelta atrás

- **Inmediata:** `DB_MOTOR=mysql` + entorno local (PC + Cloudflare Tunnel) con la MySQL intacta. El ESP32 se reaprovisiona a la URL anterior (fase futura, con autorización).
- **Sin pérdida de datos:** la base de Supabase es de demostración; no hay datos de producción que reconciliar.
