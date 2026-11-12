# Resultados de implementación — 7 de noviembre de 2026

Estado: preparación local parcial; NO certificado para producción ni desplegado.
No existía TAREAS_CODEX.md al iniciar. No se modificaron documentos de Claude.
No existe repositorio Git en la raíz. No se ejecutaron init, add, commit, push,
migraciones, seed, carga de firmware ni acciones físicas. La fecha límite no
constituye evidencia de validación ni de despliegue completado.

## Cambios implementados

- Backend: PORT del proveedor tiene prioridad sobre PUERTO; HOST admite
  0.0.0.0 y :: conservando loopback como valor local predeterminado.
- TRUST_PROXY configurable por lista de IP/CIDR. Predeterminado loopback;
  requiere configurar el proxy real del proveedor antes de publicar.
- MySQL: DB_SSL y DB_SSL_CA permiten TLS con verificación de certificado
  obligatoria cuando está habilitado. CA opcional si la cadena ya es pública.
  Tiempo de conexión limitado a 10 segundos. Sin conexión a la BD real.
- Producción fuerza IOT_PERMITIR_HTTP_LOCAL=false y LIMITES_DESACTIVADOS=false.
- Plantilla backend/.env.production.example sin secretos.
- frontend/vercel.json fuerza build:real y dist-real, reserva /api para proxy
  HTTPS y configura fallback SPA. El destino .example DEBE reemplazarse.
- Build predeterminado de Vite en modo production ahora selecciona REAL.
  Desarrollo DEMO sigue disponible; REAL no crea SimuladorDemo ni cambia a
  datos simulados ante errores. La exclusión completa del código demo del
  bundle no pudo medirse al estar bloqueado el build.
- .gitignore raíz excluye entornos, claves, builds, dependencias y reportes.
- Prueba ejecutable sin BD: backend/scripts/comprobar-config-produccion.mjs.
- Runner aislado fija DB_SSL=false y TRUST_PROXY=loopback y mejora el
  diagnóstico de errores al iniciar MySQL temporal.

## Auditoría de código

- Salud existente: GET /api/v1/salud consulta SELECT 1, responde 200 o 503,
  sin credenciales y con Cache-Control: no-store. No se consultó la BD real.
- Sesiones: JWT HS256 con algoritmos restringidos al verificar y expiración
  de acceso de 15 minutos; token de acceso en memoria del navegador.
  Refresh de 7 días, hash SHA-256 en BD, rotación y revocación por reutilización.
- Cookie de refresh HttpOnly, Secure, SameSite=Strict, sin Domain y restringida
  a /api/v1/auth. Se conserva: el navegador usa el proxy /api de Vercel y
  credentials=same-origin. No apuntar fetch directamente a otro dominio.
- CORS usa orígenes exactos y credenciales; especificar el origen público REAL.
  Panel requiere autenticación y permisos por terreno. IoT exige HTTPS,
  token de dispositivo y X-Id-Arranque.
- Firmware revisado: URL https://, CA obligatoria, setCACert, validación de
  fecha y sincronización de reloj, límites de espera y backoff/Retry-After.
  WiFi/API se aprovisionan en NVS, no en código. No se cambió el firmware.
  networkLost detiene el relé. Barreras hardwareConfirmed/manualBenchEnabled/
  relay3v3Compatible/relayBootOffVerified permanecen false. Esto bloquea la
  salida física; no acredita un estado eléctrico OFF durante reset.
- MySQL: schema.sql contiene 17 tablas InnoDB, utf8mb4_0900_ai_ci,
  CHECK y 2 triggers. Requiere MySQL >=8.0.16 y permisos para triggers;
  no asumir compatibilidad con MariaDB. USE agrocontrol está fijado en el SQL.
- UI: navegación por hash y layouts móvil/tableta; estados de carga, sesión,
  error y reconexión ya implementados. No se validó visualmente en navegador.

## Verificación de esta sesión

| Comprobación | Resultado |
| --- | --- |
| Backend npm run typecheck | APROBADO |
| Frontend npm run typecheck | APROBADO |
| Backend npm run build | APROBADO |
| Sintaxis de scripts Node y JSON de Vercel | APROBADO |
| node backend/scripts/comprobar-config-produccion.mjs (desde raíz) | APROBADO; PORT/PUERTO/HOST/TLS/proxy/barreras, sin BD |
| Backend npm test | BLOQUEADO al inicializar MySQL temporal; spawn restringido, no ejecutó Vitest |
| Frontend npm test | BLOQUEADO: esbuild spawn EPERM |
| Frontend npm run build:real | BLOQUEADO: esbuild spawn EPERM |
| Responsive 375/390/768 px | PENDIENTE; sin navegador disponible y sin build verificado |
| HTTPS público, cookies y ESP32 físico | PENDIENTE; no existe infraestructura pública verificada |

Las 136 pruebas aprobadas son un antecedente proporcionado por el usuario,
no un resultado reproducido en esta sesión. No se solicitó elevación porque
la política del entorno rechaza aprobaciones de sandbox. No se cambió la
seguridad del sistema para eludir el bloqueo.
Se confirmó sin imprimir secretos que backend/.env conserva
PERMITIR_ENCENDIDO=false. El diagnóstico final de MySQL fue
spawnSync mysqld.exe EPERM, consistente con la restricción de procesos hijos.

## Revisión antes de GitHub

Se buscaron patrones de token agc_dev_, claves privadas y asignaciones de
contraseñas/tokens en texto de código, omitiendo dependencias/builds/entornos.
Sin coincidencias. Existen backend/.env y claves/certificados del fixture en
tests/firmware/build/fixture; quedan excluidos por .gitignore. No se imprimió
su contenido ni se alteró backend/.env. Esta búsqueda no certifica archivos
binarios ni el contenido de capturas/documentación adjunta.

Antes del primer staging revisar también evidencias, archivos adjuntos y
datos identificables. Con autorización para Git: inicializar, comprobar
git check-ignore de entornos/claves y revisar git status --short --untracked-files=all.
No publicar dumps ni credenciales. Si se detecta un secreto ya compartido,
rotarlo en su proveedor antes de publicar.

## Pendientes P0 y orden de salida

1. Repetir pruebas y build REAL en una terminal que permita iniciar esbuild
   y MySQL temporal. No sustituir las pruebas aisladas por la BD real.
2. Claude audita cambios, contrato de proxy y variables de producción.
3. Elegir backend persistente y MySQL administrado; autorización del usuario
   para crear recursos/desplegar. Configurar TLS, proxy, secretos y backups.
4. Reemplazar dominio de API de ejemplo en frontend/vercel.json y origen en
   CORS_ORIGENES. Verificar que el proxy preserva Origin, Authorization,
   Set-Cookie y estado HTTP; no debe cachear respuestas de /api.
5. Inicializar exclusivamente la base nueva vacía según GUIA_PRODUCCION.md.
6. Publicar únicamente después de autorización y validaciones; comprobar
   salud, login/refresh/logout y recargas. Probar 375/390/768 px con API REAL,
   vacía/con datos y fuera de servicio. No usar las suites de DemoBlaze del
   directorio test2026 como prueba de AgroControl.
7. Aprovisionar URL HTTPS/CA/token del ESP32 solo con autorización; verificar
   telemetría y reconexión físicamente. Mantener PERMITIR_ENCENDIDO=false.
   La bomba no queda habilitada con este trabajo.

---

## Segunda validación solicitada — 2026-11-07

Esta sección actualiza el estado anterior. Único archivo editado deliberadamente
en esta segunda intervención: `documentacion/despliegue/RESULTADOS_CODEX.md`.
Los comandos de compilación regeneraron archivos ignorados de `backend/dist`.
No se modificó código ni documentos de Claude durante su auditoría. Se leyeron
TAREAS_CODEX.md, AUDITORIA_PRODUCCION.md y CHECKLIST_FINAL.md; la instrucción
actual del usuario de actualizar exclusivamente este informe prevalece sobre
la petición de crear evidencias T-XX.md. No se ejecutó git add, ni siquiera -n.

### Estado real de Git

Ahora existe `.git`, rama main SIN commits, índice con 0 archivos y remoto
origin configurado a `https://github.com/leotedd/AgroControl-IoT.git`.
No se accedió al remoto: su existencia, visibilidad pública y permisos no están
verificados. No se creó ni cambió Git en esta intervención.

`git check-ignore` confirmó exclusión de backend/.env, claves del fixture,
frontend/node_modules, frontend/dist-real, backend/dist y test2026.
Inventario orientativo mediante `git ls-files --others --exclude-standard`:
317 archivos candidatos, 20,206,790 bytes antes de actualizar este informe.
Todos están sin seguimiento; no hay base Git para atribuir diferencias a autores.

**Hallazgo pendiente:** `git check-ignore -v backend/.env.production.example`
devuelve `backend/.gitignore:4:.env.*`. La excepción del .gitignore raíz no gana
al archivo del subdirectorio. Añadir `!.env.production.example` en el ignore
del backend cuando se libere el código de la auditoría. No forzar staging de
entornos. El escaneo de candidatos solo mostró backend/.env.example como
archivo de entorno publicable; no mostró claves privadas ni dumps por extensión.
Revisión de binarios, capturas y datos personales sigue pendiente para GitHub público.

### Pruebas ejecutadas y diagnóstico

| Comando | Resultado de esta intervención |
| --- | --- |
| backend: npm run typecheck | APROBADO, código 0 |
| frontend: npm run typecheck | APROBADO, código 0 |
| backend: npm run build | APROBADO, código 0 |
| backend: node scripts/comprobar-config-produccion.mjs | APROBADO, sin BD |
| backend: npm test | BLOQUEADO antes de Vitest: spawnSync mysqld.exe EPERM; 0/53 ejecutadas |
| frontend: npm test | BLOQUEADO al cargar vite.config.ts: esbuild spawn EPERM; 0/83 ejecutadas |
| frontend: npm run build:real | BLOQUEADO al iniciar esbuild; no certificado |
| frontend: npm run build | BLOQUEADO al iniciar esbuild; no certificado |
| Playwright chromium.launch headless | BLOQUEADO: browserType.launch: spawn EPERM |

Diagnóstico independiente de la aplicación: `spawnSync(process.execPath,
['--version'])` desde Node devuelve status=null, error=EPERM. Ejecutados
directamente desde PowerShell, esbuild --version devuelve 0.25.12 y
mysqld --no-defaults --version devuelve 26.7.0. Los binarios existen y pueden
responder; el proceso hijo de Node está restringido en este entorno. Esto
acredita un bloqueo de ejecución, no una regresión del código. No determina
si el mecanismo exacto es sandbox, control del host o antivirus; no se alteró
ninguno. No se solicitó elevación, rechazada por la política de esta sesión.
No se emplearon mecanismos alternativos para eludir la restricción.

El runner usó un puerto libre 61739 y carpeta temporal agro-prueba-2x2HP9;
falló antes de importar el esquema y limpió su directorio temporal. Nunca se
ejecutó Vitest contra el servicio MySQL local ni se inició el backend contra él.
83/53 son cantidades esperadas, no resultados aprobados de esta intervención.
La auditoría de Claude documenta 83 aprobadas en otra ejecución; no se atribuyen
a esta sesión ni sustituyen la validación posterior a cambios.

### Bundle REAL y secretos

Vite define VITE_FUENTE='real' para real/movil/production; FuenteApi usa
/api/v1 relativo con credentials=same-origin. FuenteDatos instancia el
simulador solo en DEMO y no cambia a él ante fallo de API. Los valores por
defecto de configuración no son mediciones simuladas.

Se observaron cambios concurrentes en dist-real: inicialmente había archivos
del 26 de octubre; después assets desapareció y reapareció con fecha
2026-11-07 00:22:32. No se conoce su proceso productor. Mis dos comandos de
build fallaron; la aparición de esos artefactos NO permite declararlos aprobados.

En el snapshot final observado, 4 archivos JS/CSS: sin texto SimuladorDemo,
sin patrón de token de dispositivo ni de clave privada. Se compararon además
3 valores secretos locales de al menos 8 caracteres, leídos en memoria desde
backend/.env: 0 coincidencias; no se imprimieron nombres ni valores sensibles.
Esto es evidencia limitada al snapshot, no un análisis completo de secretos,
ni prueba de exclusión de toda función de simulación tras minificación.

SHA-256 del snapshot:

```text
graficas-CqEIJIEE.js 03992055529ffb34a06edb21737ba5de4d141de5affbed83c222ee4eaced3990
index-CpBt6bhV.js a48c6cc3d411a80d05207cf491e1130de2bf81ef305ccbf36efc58f971ce2da7
index-D8ER0cxy.css 27db71ccae2bc359f1c82c80de4fa5a052eafff6a00832abdff49370112c5ebb
react-DdN8dEqA.js 13e6cc921f7967b09e60d98e6fc02b07f0c21ab31e34e4787d9787300940d8bf
```

### Auditoría móvil estática, sin aprobación visual

| Área | Evidencia en código | Falta comprobar en navegador |
| --- | --- | --- |
| 375 px | Layout móvil, barra inferior de 5 secciones y espacio inferior; login a una columna | Scroll horizontal, teclado virtual, tooltips y safe area |
| 390 px | Mismo layout; navegación cambia a texto xs desde 390 | Ajuste de etiquetas, zoom y objetivos táctiles |
| 768 px | Pestañas md visibles, barra inferior oculta; tarjetas adaptan columnas | Encaje de gráficas/tarjetas y scroll de pestañas |
| Login | Labels, autocomplete, email inputMode, campos text-base/h-12, error role=alert, verificación role=status | Orden de foco, lectura del error y teclado móvil |
| Dashboard/tarjetas | min-w-0, columnas minmax(0,...), encabezados flex-wrap | Textos extensos, valores y listas con datos REAL |
| Gráficas/historial | ResponsiveContainer 100%, tablas overflow-auto, fechas a una columna en móvil | Alturas, datetime-local nativo, tooltips y ausencia de scroll global |
| Riego | Botones bloqueados por acciones/permisos/enviando, confirmación dialog, apagado separado | Foco del diálogo, cancelación por Escape y estado deshabilitado |
| Carga/error/desconexión | Esqueleto aria-busy, alerta de login, reintentos 3–15 s y degradación de acciones | Corte/restauración real del transporte y lectura por lector de pantalla |

CSS incluye foco visible y prefers-reduced-motion. Navegación usa aria-current,
botones de icono tienen etiquetas y hay alternativa de tabla a gráficas.
Los radiogroup implementados con botones requieren comprobar interacción por
teclado; no se certifica conformidad de accesibilidad a partir del marcado.
No se confirmó ningún desbordamiento mediante renderizado y no se cambió el
diseño por conjeturas. No se generaron capturas porque Chromium instalado
también está bloqueado al lanzarse desde Playwright.

### Configuración, seguridad y pendientes de auditoría

- frontend/vercel.json: JSON legible; buildCommand=npm run build:real,
  outputDirectory=dist-real, framework=vite. Rewrite /api/:path* primero hacia
  HTTPS; fallback excluye api. Validación del motor de rutas de Vercel pendiente.
- Sustituir api.agrocontrol.example en vercel.json, agrocontrol.example en
  CORS_ORIGENES y mysql.agrocontrol.example en DB_HOST de la plantilla. No
  sustituirlos por suposiciones ni publicar con esos marcadores.
- Comando real existente: npm run start:compiled → node dist/src/server.js.
  NO existe start:prod ni archivo railway.json. El comando compilado no depende
  de tsx; no se arrancó porque implicaría tareas y escrituras sobre la BD local.
- Mantener una réplica activa por las tareas en proceso. Build requiere
  devDependencies; inicio compilado usa dependencias de runtime.
- Runtime necesita NODE_ENV=production, HOST=0.0.0.0, PORT del proveedor,
  TRUST_PROXY con direcciones confiables, CORS_ORIGENES HTTPS exacto,
  DB_HOST/DB_PUERTO/DB_USUARIO/DB_CONTRASENA/DB_NOMBRE, DB_SSL/DB_SSL_CA,
  JWT_SECRETO y PERMITIR_ENCENDIDO=false. No usar variables VITE_* para secretos.
- Diferencias con TAREAS_CODEX: implementación usa TRUST_PROXY por CIDR, no
  CONFIAR_PROXY por saltos, y PORT tiene prioridad sobre PUERTO. Documentar la
  decisión con Claude antes de configurar el proveedor; CONFIAR_PROXY no es
  una variable reconocida actualmente. No copiar esa variable desde sus ejemplos.
- Producción aún admite CORS_ORIGENES http: por configuración. Configurar
  exclusivamente HTTPS y dejar pendiente la validación estricta solicitada
  por Claude. No hay guard de build que rechace dominios .example en Vercel.
- No están implementadas las salvaguardas remotas de T-07; no ejecutar seed,
  cambio de contraseña ni rotación sobre servicios remotos sin revisión explícita.
- Cookies conservan HttpOnly/Secure/Strict/Path=/api/v1/auth y sin Domain;
  JWT HS256 de 15 min verificado con algoritmo restringido. Probar propagación
  Set-Cookie/Origin/Authorization por Vercel y refresh tras recarga antes de salida.
- ESP32 conserva https://, setCACert, validación de fechas y hora; no hay
  setInsecure en el transporte revisado. Barreras físicas false sin cambios.
- Se confirmó PERMITIR_ENCENDIDO=false en backend/.env sin imprimir su contenido.
  Servidor rechaza BOMBA_ENCENDER, cancela ON pendientes y bloquea AUTOMATICO;
  se revisó código, no se enviaron órdenes. Hardware físico NO validado.

### Archivos de la preparación anterior, para el auditor

Inventario de los cambios efectuados en la intervención anterior (no diff Git):

1. .gitignore
2. backend/src/config.ts
3. backend/src/app.ts
4. backend/src/db.ts
5. backend/.env.production.example
6. backend/scripts/comprobar-config-produccion.mjs
7. backend/scripts/pruebas-con-bd-temporal.mjs
8. frontend/vite.config.ts
9. frontend/vercel.json
10. documentacion/despliegue/GUIA_PRODUCCION.md
11. documentacion/despliegue/RESULTADOS_CODEX.md

En esta segunda intervención: únicamente el archivo 11 como edición de fuente;
backend/dist fue regenerado por el build. Cambios concurrentes de otros procesos
no se atribuyen a Codex. Todos los documentos de Claude permanecieron intactos.

### Procedimiento de despliegue futuro, no ejecutado

Después de autorización del usuario y aprobación de Claude:

1. Completar validaciones locales en una terminal que permita procesos hijos.
2. Revisar archivos públicos, exclusiones y plantilla ignorada antes de staging.
3. Crear/elegir MySQL persistente compatible con 17 tablas, CHECK y 2 triggers.
   Crear únicamente una base NUEVA vacía agrocontrol; no copiar datos locales.
   schema.sql fija USE agrocontrol y no es una migración idempotente.
4. Importar con cliente mysql y verificación TLS/hostname, contraseña interactiva,
   permisos temporales de importación y soporte de DELIMITER. Revisar cualquier
   cambio de nombre de base antes de ejecutarlo. No poner contraseñas en comandos.
5. Backend Railway u otro proceso Node persistente: raíz backend; instalación
   npm ci con dependencias de desarrollo, build npm run build, inicio npm run
   start:compiled, healthcheck /api/v1/salud, una réplica. Configurar secretos
   desde el panel y usuario MySQL de runtime separado del importador.
6. Confirmar TLS de MySQL con DB_SSL=true y CA del proveedor; no usar false
   para ocultar errores de certificado. Medir cadena de proxies para tráfico
   web e IoT en ensayo; no confiar ciegamente en X-Forwarded-*.
7. Reemplazar dominios, configurar Vercel con raíz frontend y npm ci; verificar
   que se usa frontend/vercel.json y dist-real recién construido. No ejecutar
   publicación en esta sesión. Configurar CORS con el origen final exacto.
8. Validar salud, autenticación, cookies y móviles; finalmente aprovisionar y
   verificar ESP32 solo con autorización, manteniendo la bomba bloqueada.

Referencias oficiales consultadas para configuración manual:
[inicio de Railway](https://docs.railway.com/deployments/start-command),
[healthchecks de Railway](https://docs.railway.com/deployments/healthchecks) y
[rewrites de Vercel](https://vercel.com/docs/routing/rewrites).
No se verificaron precios ni se contrataron servicios.

### PowerShell: repetir validación local sin usar la BD real

Comandos preparados, no una aprobación para publicar. Usan dependencias ya
instaladas; npm ci se reserva para una instalación limpia cuando corresponda.
La función aborta en el primer comando fallido; evita confundir el último
exit code de una secuencia con el resultado de todas las pruebas.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\Users\i7del\OneDrive\Desktop\AgroControl-IoT'
function Invoke-AgroNative {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Falló $Program (código $LASTEXITCODE)" }
}
Push-Location backend
try {
    Invoke-AgroNative -Program npm.cmd -Arguments @('run','typecheck')
    Invoke-AgroNative -Program npm.cmd -Arguments @('run','build')
    Invoke-AgroNative -Program node -Arguments @('scripts/comprobar-config-produccion.mjs')
    Invoke-AgroNative -Program npm.cmd -Arguments @('test')
} finally { Pop-Location }
Push-Location frontend
try {
    Invoke-AgroNative -Program npm.cmd -Arguments @('run','typecheck')
    Invoke-AgroNative -Program npm.cmd -Arguments @('test')
    Invoke-AgroNative -Program npm.cmd -Arguments @('run','build:real')
    if (!(Test-Path -LiteralPath 'dist-real/index.html')) { throw 'Falta index REAL' }
    $assets = @(Get-ChildItem -LiteralPath 'dist-real/assets' -Filter '*.js')
    if (!$assets.Count) { throw 'Faltan assets REAL' }
    if ($assets | Select-String -Pattern 'SimuladorDemo' -Quiet) { throw 'Simulador en bundle' }
    Get-ChildItem -LiteralPath 'dist-real/assets' -File | Get-FileHash -Algorithm SHA256
} finally { Pop-Location }
git status --short
git check-ignore -v backend/.env backend/.env.production.example tests/firmware/build/fixture/key.pem
```

### PowerShell: humo público de solo lectura, después del despliegue autorizado

Sustituir ambos dominios. Este bloque no despliega, no importa SQL, no hace
login ni envía órdenes. El endpoint de telemetría se llama sin token y debe
rechazar antes de acceder a datos. No se imprimen cookies ni credenciales.
No desactiva la validación TLS ni sigue redirecciones silenciosamente.

```powershell
$ErrorActionPreference = 'Stop'
$apiPublica = 'https://api.agrocontrol.example'
$webPublica = 'https://agrocontrol.example'
foreach ($base in @($apiPublica, $webPublica)) {
    $uri = [uri]$base
    if ($uri.Scheme -ne 'https' -or $uri.Host.EndsWith('.example')) {
        throw 'Sustituya los dominios de ejemplo por dominios HTTPS autorizados'
    }
}
function Test-AgroHttp {
    param([string]$Uri, [string]$Method = 'GET', [int]$Expected = 200, [hashtable]$Headers = @{})
    $response = $null
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Method $Method -Headers $Headers -TimeoutSec 20 -MaximumRedirection 0
        $code = [int]$response.StatusCode
    } catch {
        if (!$_.Exception.Response) { throw }
        $code = [int]$_.Exception.Response.StatusCode
    }
    if ($code -ne $Expected) { throw "$Method $Uri devolvió $code; esperado $Expected" }
    Write-Host "PASS $Method $Uri ($code)"
    if ($Expected -eq 200 -and $Uri.EndsWith('/api/v1/salud')) {
        $data = ($response.Content | ConvertFrom-Json).data
        if ($data.estado -ne 'OK' -or $data.base_datos -ne 'OK') { throw 'Salud degradada' }
    }
}
Test-AgroHttp -Uri "$apiPublica/api/v1/salud"
Test-AgroHttp -Uri "$webPublica/api/v1/salud"
Test-AgroHttp -Uri "$webPublica/"
Test-AgroHttp -Uri "$webPublica/api/v1/terrenos" -Expected 401
Test-AgroHttp -Uri "$apiPublica/api/v1/iot/telemetria" -Method POST -Expected 401
Test-AgroHttp -Uri "$webPublica/api/v1/no-existe" -Expected 401
Test-AgroHttp -Uri "$apiPublica/api/v1/auth/login" -Method OPTIONS -Expected 403 -Headers @{
    Origin = 'https://origen-no-autorizado.example'
    'Access-Control-Request-Method' = 'POST'
}
```

Nota: rutas desconocidas dentro de /api/v1 atraviesan primero el router del
panel autenticado y pueden responder 401 sin JWT; la expectativa anterior
comprueba que no vuelvan como HTML/200 del frontend. Confirmar también en el
navegador login, refresh tras recargar #/historial, logout, cookies y cortes
de red. Esos comportamientos no se certifican solo con el humo HTTP.

### Bloqueos que requieren intervención

1. Terminal o runner permitido para procesos hijos Node: repetir 83+53 pruebas,
   builds del frontend y Chromium responsive. No deshabilitar controles del SO
   ni cambiar a la BD real para resolverlo.
2. Claude: cerrar diferencias de contrato y hallazgos (plantilla ignorada,
   CORS HTTPS estricto, guard de dominio pendiente, proxy y scripts remotos).
3. Usuario: autorizar publicación cuando corresponda, confirmar dominios y
   elegir/autorizar infraestructura. El remoto configurado no demuestra repo público.
4. Prueba física del ESP32 y seguridad eléctrica del relé pendientes; no
   habilitar bomba ni cambiar barreras como condición de cierre de software.

Conclusión de aceptación: **NO listo para declarar producción validada todavía**.
Preparación revisable y comandos disponibles; faltan ejecución de suites,
build REAL acreditado, QA móvil y configuración pública verificable.

---

## T-13 a T-16 — correcciones posteriores a AUDITORIA_FINAL.md

Leída la auditoría final de Claude: **53/53 backend + 83/83 frontend = 136/136**,
build REAL y typechecks aprobados por el auditor. Esos resultados actualizan
el bloqueo histórico anterior; no se atribuyen a una ejecución propia de Codex.
Esta intervención incorpora pruebas adicionales independientes de configuración.

Restricción activa del usuario: demostración mediante Quick Tunnel y Vite REAL
en 5174. No se pararon ni reiniciaron procesos, ni se cambiaron backend/.env,
Vite config, puerto, autorización CORS trycloudflare.com, MySQL o firmware.
No se ejecutaron builds que sustituyan artefactos ni se instaló software.
No hubo commits, staging, push, despliegues ni llamadas de control de riego.

### Resultado por tarea

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| T-13 guard de despliegue | CORREGIDO | frontend/vercel.json ejecuta validar-despliegue.mjs antes de build:real; con VERCEL=1 y el destino actual sale con código 1 |
| T-14 TRUST_PROXY | VALIDADOR PREPARADO Y PROBADO; integración PENDIENTE | 37 casos aprobados; no se editó config.ts para evitar reinicio de tsx watch |
| T-15 ignores | CORREGIDO | plantilla listada por git ls-files --others --exclude-standard; backend/.env sigue ignorado |
| T-16 documentación | README y guía CORREGIDOS; comentario fuente.ts PENDIENTE | build predeterminado REAL/dist, build:real REAL/dist-real; comentario diferido para evitar HMR |

T-13 se integra en el buildCommand de Vercel, no en package.json ni en
vite.config.ts, para no alterar los archivos que gobiernan la demo. Recorre
los valores de vercel.json y rechaza `.example` (también mayúsculas), dominios
example.com/org/net y BACKEND_DOMINIO_PENDIENTE. Solo actúa con VERCEL=1.
No rechaza trycloudflare.com ni toca la autorización exacta del backend.
El dominio de ejemplo se conserva en el rewrite como marcador deliberado:
el despliegue ahora falla antes de compilar hasta sustituirlo por el real.
El panel de Vercel debe conservar este buildCommand; un override que omita
el guard eludiría esa comprobación y debe rechazarse en la revisión de salida.
La ejecución local directa de npm run build:real sigue sin activar el guard.

T-14 acepta únicamente listas no vacías de alias loopback/linklocal/uniquelocal,
IPv4, IPv6 o CIDR verificados con node:net isIP y rango de prefijo. Rechaza
entradas vacías, nombres DNS, números y booleanos, IP inválidas, prefijos
malformados y cualquier /0 (incluido ::/0). Es una función pura en scripts,
sin importación por el servidor activo y sin lectura de secretos/BD.
**El servidor actual aún usa el parser anterior de config.ts. No se declara
resuelto el endurecimiento de runtime.** La validación sintáctica no sustituye
la revisión de las redes realmente confiables del proveedor.

T-15 añade `!.env.production.example` en backend/.gitignore, además de los
ignores raíz de coverage, sqlite, db, Thumbs.db, .DS_Store y tmp. La plantilla
queda visible sin forzar staging; archivos de secretos siguen excluidos.

T-16 elimina del README la afirmación incorrecta de compilación DEMO, actualiza
su estado desde Fase 0 a preparación de producción y aclara aprovisionamiento
NVS del firmware. La guía refleja el guard y el estado parcial de T-14.
Los documentos de auditoría y tareas de Claude no se reescribieron; sus
observaciones anteriores se conservan como evidencia histórica.

### Validación ejecutada en esta intervención

| Comando | Resultado |
| --- | --- |
| node frontend/scripts/validar-despliegue.test.mjs | PASS: 10 casos |
| node frontend/scripts/validar-despliegue.mjs, entorno local sin VERCEL=1 | PASS: omite bloqueo de marcadores |
| VERCEL=1 + node frontend/scripts/validar-despliegue.mjs | PASS de rechazo esperado: exit 1 por .example |
| node backend/scripts/validar-trust-proxy.test.mjs | PASS: 37 casos, incluidos IPv6 y CIDR inválidos |
| frontend: npm run typecheck | PASS |
| backend: npm run typecheck | PASS |
| git ls-files --others --exclude-standard backend/.env.production.example | Lista la plantilla |
| git check-ignore -v backend/.env | Sigue excluido por backend/.gitignore |
| Verificación acotada de backend/.env | PERMITIR_ENCENDIDO=false; no se imprimieron valores secretos |

Los 47 casos nuevos se ejecutan con Node directamente, sin procesos hijos,
sin MySQL y sin iniciar servidores. No se suman automáticamente al total de
Vitest 136 del auditor: son suites independientes, con comandos explícitos.
No se repitió la suite de integración de BD durante la demostración.

### Archivos modificados o añadidos en esta intervención

1. .gitignore
2. backend/.gitignore
3. backend/scripts/validar-trust-proxy.mjs (nuevo)
4. backend/scripts/validar-trust-proxy.test.mjs (nuevo)
5. frontend/vercel.json
6. frontend/scripts/validar-despliegue.mjs (nuevo)
7. frontend/scripts/validar-despliegue.test.mjs (nuevo)
8. README.md
9. documentacion/despliegue/GUIA_PRODUCCION.md
10. documentacion/despliegue/RESULTADOS_CODEX.md

### Ventana autorizada pendiente, sin infraestructura externa

1. Integrar la validación estricta en el esquema Zod TRUST_PROXY de config.ts,
   conservando valor por defecto loopback y mensajes sin eco de secretos;
   añadir pruebas que invoquen config() para entradas válidas/inválidas.
   La función ya probada sirve de referencia, pero no está conectada al runtime.
2. Añadir a fuente.ts el comentario: `npm run build → REAL (dist/)` y
   `npm run build:real → REAL (dist-real/)`. Se difiere incluso ese comentario
   porque modificar un módulo del frontend puede causar HMR/recarga.
3. Repetir typechecks, pruebas aisladas y build REAL tras la integración;
   comprobar la demo antes de reabrirla. No hacerlo durante la presentación.

T-07/T-08 e infraestructura externa siguen fuera de estas correcciones.
No se ha reemplazado el dominio final por el Quick Tunnel temporal ni se
ha quitado su autorización actual. PERMITIR_ENCENDIDO permanece false.
