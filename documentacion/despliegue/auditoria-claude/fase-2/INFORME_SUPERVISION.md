# Informe de supervisión — Fase 2

- **Corte del informe:** 2026-11-09 ≈ 07:40 (hora local). **Documento vivo:** se actualiza en cada puerta de revisión.
- **Estado global:** 🔴 **NO APROBADO**. La implementación está en curso (bloques 1–2 parciales; bloques 3–6 sin empezar) y hay un bloqueo crítico abierto (H-06).

---

## 1. Método de supervisión independiente

| Principio | Aplicación |
|---|---|
| No interferir | No se editó ningún archivo de Codex. Las pruebas se ejecutaron en una **copia aislada** fuera del repositorio (`%TEMP%\…\scratchpad\validacion`), sin `backend/.env` (excluido explícitamente de la copia) y con `node_modules` enlazado en sólo lectura lógica (vitest con `--cache=false`; las builds se emiten dentro de la copia). |
| Evidencia propia | Cada resultado de esta tabla proviene de una ejecución de la revisión, no del informe de Codex. |
| Línea base | (a) SHA-256 de 339 archivos del árbol (sin `node_modules`, `dist`, `build`) a las 07:15; (b) huellas de **sólo lectura** de la MySQL `agrocontrol`: por tabla, `COUNT`, `MAX(id)` y SHA-256 de los CRC32 de cada fila, calculados en el servidor dentro de `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`. No se imprimen credenciales ni filas. |
| Archivos de evidencia (fuera del repositorio) | `scratchpad/arbol-linea-base.sha256`, `scratchpad/mysql-linea-base-1.json`, `scratchpad/mysql-linea-base-2.json`, `scratchpad/validacion/npm-test-mysql.log` |

## 2. Cambios de Codex detectados (respecto de la línea base)

| Archivo | Tipo | Revisión |
|---|---|---|
| `backend/src/config.ts` | Modificado | `TRUST_PROXY` validado con el validador compartido ✅; `SERVIR_FRONTEND` ✅. Falta `saltos:N` (C-2.1) ⚠ |
| `backend/src/util/trust-proxy.mjs` + `.d.mts` | Nuevo | Lógica correcta (rechaza universales, `/0`, números). **Rompe el build compilado (H-06)** 🔴 |
| `backend/scripts/validar-trust-proxy.mjs` | Modificado | Ahora reexporta la implementación compartida ✅ |
| `backend/src/frontend.ts` | Nuevo | `express.static` con `index:false`, `dotfiles:'deny'`, *assets* con hash inmutables, HTML `no-cache`, *fallback* que excluye `/assets/` y no-HTML ✅. Exige una ruta absoluta (más estricto que C-1.2; aceptable) |
| `backend/src/app.ts` | Modificado | Orden correcto: `/api` 404 JSON **antes** del frontend ✅. CSP por defecto de helmet: **H-01** ⚠ |
| `backend/scripts/build-cloud.mjs` | Nuevo | Compila el frontend (`npm run build`, modo production = REAL) y el backend. No instala dependencias: el comando de Render debe hacer `npm ci --include=dev` en ambas carpetas (documentar) ⚠ |
| `backend/scripts/start-cloud.mjs` | Nuevo | Fuerza `PERMITIR_ENCENDIDO=false` (falla si viene otro valor), `NODE_ENV=production`, `HOST=0.0.0.0` y `SERVIR_FRONTEND=frontend/dist` ✅ (refuerza C-8.2). Importa `dist/src/server.js`, por lo que hereda H-06 🔴 |
| `backend/tests/safe/*.test.ts` + `vitest.safe.config.ts` | Nuevo | 28 pruebas sin BD (BD simulada que lanza error si se usa): mismo origen, CORS, JWT HS384 rechazado, HTTPS IoT, suplantación de `X-Forwarded-Proto`, roles ✅ |
| `backend/tsconfig.build.json` | Modificado | `allowJs: true`, pero no consigue emitir `.mjs` (H-06) |
| `backend/package.json`, `frontend/package.json` (+ *locks*) | Modificado | `engines.node ">=22.12.0 <25"`, scripts `test:seguro`, `build:cloud`, `start:cloud`. **Sin dependencias nuevas** (no se añadió `pg` todavía) ✅ |
| `documentacion/despliegue/preparacion-codex/fase-2/linea-base-archivos.json` | Nuevo | Línea base propia de Codex ✅ |

**Archivos protegidos sin cambios** (SHA-256 igual a la línea base): `database/schema.sql`, `database/importar-esquema.ps1`, `firmware-esp32/**`, `tests/firmware/**`, documentos de la Fase 1 de ambas carpetas, `backend/src/modulos/**`, `backend/src/db.ts`, `frontend/src/**`. ✅

## 3. Resultados de validación independiente

| # | Comando (en la copia aislada) | Resultado | Criterio |
|---|---|---|---|
| E-1 | `backend: tsc --noEmit` | ✅ exit 0 | TypeScript compila |
| E-2 | `backend: vitest run --config vitest.safe.config.ts` | ✅ 28/28 | — |
| E-3 | `backend: node scripts/pruebas-con-bd-temporal.mjs` (MySQL **temporal**, puerto libre, carpeta temporal) | ✅ **81/81** (53 originales + 28 nuevas), exit 0 | Pruebas existentes |
| E-4 | `backend: node scripts/validar-trust-proxy.test.mjs` | ✅ 37 casos | — |
| E-5 | `backend: tsc -p tsconfig.build.json` y después `import('./dist/src/config.js')` con `NODE_ENV=production` | 🔴 **`ERR_MODULE_NOT_FOUND …/dist/src/util/trust-proxy.mjs`** | El backend compilado no arranca |
| E-6 | `frontend: tsc --noEmit` | ✅ exit 0 | — |
| E-7 | `frontend: vite build` (modo production) | ✅; 0 apariciones de `SimuladorDemo`; contiene «MODO REAL» | Build del frontend |
| E-8 | `frontend: vitest run` | ⚠ **83/83 pruebas OK, pero exit 1**: Vitest recoge `scripts/validar-despliegue.test.mjs` (un script de Node, no una suite) → «1 failed» (H-05). Preexistente desde el 2026-11-07 00:29, no lo introdujo esta fase | Pruebas existentes |
| E-9 | `frontend: node scripts/validar-despliegue.test.mjs` | ✅ 10 casos | — |
| E-10 | Build REAL servida por `crearApp()` (supertest) | ⚠ El `index.html` real tiene 1 script en línea cuyo hash no está en la CSP → **bloqueado** (H-01) | Sin regresiones de UI |
| E-11 | Huellas MySQL `agrocontrol` (sólo lectura), 07:15 frente a 07:35 | ✅ **17/17 tablas idénticas** (filas, `MAX(id)`, huella); 2 triggers y 7 CHECK iguales | MySQL intacta |
| E-12 | SHA-256 de los archivos protegidos | ✅ sin cambios | — |
| E-13 | `grep PERMITIR_ENCENDIDO=true` en archivos versionables | ✅ 0 (sólo pruebas que lo fijan en memoria) | La bomba no se puede activar |
| E-14 | `backend/.env`: sólo las claves no secretas | `PERMITIR_ENCENDIDO=false` ✅ | — |

## 4. Hallazgos abiertos

| ID | Severidad | Hallazgo | Acción requerida (Codex) | Bloque |
|---|---|---|---|---|
| **H-06** | 🔴 **Crítica** | `tsc -p tsconfig.build.json` no emite `src/util/trust-proxy.mjs`; `dist/src/config.js` lo importa → `start:compiled` y `start:cloud` fallan al arrancar. Las pruebas no lo detectan porque se ejecutan desde el código fuente | Convertir el validador a `trust-proxy.ts` (y que `scripts/validar-trust-proxy.mjs` importe de `dist` o se reescriba como `.ts`), **o** copiar el `.mjs` en el build. Añadir una prueba de humo del artefacto: `npm run build && node -e "import('./dist/src/app.js')"` con un entorno sintético, sin BD | 1 |
| H-01 | Media | La CSP de helmet bloquea el script en línea del tema del `index.html` real; la prueba usa un HTML sintético | C-7.6 rev. 2.1: mover el script a `/tema-inicial.js` (o usar un hash) y probar con el `index.html` real de la build | 2 |
| H-05 | Media | `npm test` del frontend termina con exit 1 por un script `.test.mjs` que no es suite de Vitest | `test.include: ['src/**/*.test.{ts,tsx}']` en la configuración de Vitest (o renombrar el script) | 2 |
| H-07 | Media | Falta `saltos:N` en `TRUST_PROXY` (C-2.1) y el diagnóstico de proxy (C-2.2). La prueba actual exige rechazar `'1'`, lo cual sigue siendo correcto: `saltos:N` es una forma distinta y explícita | Implementar C-2.1 y C-2.2 manteniendo el rechazo de números sueltos | 1 |
| H-02/03/04 | Baja | CSP genérica para Google Fonts; HSTS y `upgrade-insecure-requests` fuera de `production`; `frame-ancestors 'self'` | C-7.6 | 2 |
| H-08 | Baja | `build-cloud.mjs` presupone dependencias instaladas | Documentar el comando completo de Render en la guía (bloque 6) | 6 |
| — | Pendiente | C-7.2, C-7.4, C-9.1, C-9.2, C-9.7, C-10.7 (resto del bloque 1) | — | 1 |

## 5. Estado de los criterios de aprobación

| Criterio | Estado | Evidencia |
|---|---|---|
| TypeScript compila | ✅ (`--noEmit`) / 🔴 el artefacto compilado no arranca | E-1, E-5, E-6 |
| El frontend genera su build | ✅ | E-7 |
| Las pruebas existentes siguen funcionando | ✅ backend 81/81 · ⚠ frontend 83/83 con exit 1 preexistente | E-3, E-8 |
| Pruebas PostgreSQL sólo contra base temporal aislada | ⏳ no existen todavía (bloque 3) | — |
| Triggers y restricciones preservan las reglas | ⏳ (bloques 3–4; matriz V-DDL/V-CHK/V-TRG) | — |
| Sin regresiones de autenticación | ✅ parcial (pruebas existentes + suite segura); ⏳ V-AUTH-01…06 | E-2, E-3 |
| El ESP32 no puede activar la bomba en las pruebas | ✅ firmware sin cambios (compuertas en `false`); `start-cloud` fuerza `false`; ninguna plantilla con `true` | E-12, E-13 |
| La base MySQL original permanece intacta | ✅ | E-11 |
| Sin secretos en archivos destinados a Git | ⏳ falta el escáner C-10.7; revisión manual de los archivos nuevos: sin secretos (los JWT de prueba son literales sintéticos dentro de las pruebas) | Revisión |

## 6. Riesgos y bloqueos actuales

| ID | Tipo | Descripción | Impacto |
|---|---|---|---|
| B-01 | **Bloqueo** | H-06: el backend compilado no arranca | Impide cualquier despliegue en Render |
| B-02 | Bloqueo (planificado) | Sin capa PostgreSQL, esquema ni arnés (bloques 3–4) | La migración no se puede validar |
| B-03 | Decisión pendiente del usuario | Permiso `DELETE` en `mediciones` para la retención (AD-08 / C-9.4) | Bloque 5. No urgente: < 100 MB/año |
| B-04 | Decisión pendiente (D2-03) | RLS en Supabase para cerrar su API REST | Fase de despliegue |
| R-01 | Riesgo | Codex empezó antes de publicarse estos contratos: posibles desviaciones (p. ej. `saltos:N`) | Retrabajo menor; se registra en cada puerta |
| R-02 | Riesgo | `intervalo_ordenes_s` ≤ 3 fijado por el lease del firmware; el margen real con Render solo se medirá con hardware (fuera de alcance) | Cortes de riego por lease si la latencia supera ≈ 1 s (falla de forma segura: bomba apagada) |
| R-03 | Riesgo | `tests/firmware/test_artifacts.py` 12/13 (reportado por Codex en la Fase 1): expectativa textual `relay=UNTOUCHED` | Sin impacto en la seguridad física; no se toca en esta fase |

## 7. Próximas puertas de revisión

| Puerta | Condición de entrada | Verificación de la revisión |
|---|---|---|
| P1 (bloque 1) | Informe `RESULTADOS_BLOQUE_1.md` de Codex | E-1…E-5 en verde (**incluida la prueba del artefacto compilado**), V-IOT-01/02, V-AUTH-05, escáner de secretos, huellas MySQL |
| P2 (bloque 2) | `RESULTADOS_BLOQUE_2.md` | CSP con el `index.html` real (E-10 en verde), H-05 cerrado, V-API-02 |
| P3 (bloque 3) | Esquema + adaptador + arnés | V-DDL-01…11 con un comparador propio sobre los dos esquemas temporales; V-ISO-01/02 |
| P4 (bloque 4) | Suite completa en ambos motores | V-CHK, V-TRG, V-TX, V-SQL, V-TYPE, V-TIME; V-API-01 (equivalencia de respuestas entre motores) |
| P5 (bloque 5) | Retención | V-IOT-03/04 |
| Final | Todo lo anterior | Criterio global de la MATRIZ §10 |

**Conclusión:** la migración **no está aprobada**. El trabajo de Codex hasta ahora es de buena calidad en seguridad (validación de proxy, aislamiento de `/api`, forzado de `PERMITIR_ENCENDIDO=false`, pruebas sin BD), pero el artefacto de producción no arranca (H-06) y la portabilidad a PostgreSQL aún no ha comenzado.
