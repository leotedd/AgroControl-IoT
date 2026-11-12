<#
.SYNOPSIS
  Importa database/schema.sql EXCLUSIVAMENTE en la base `agrocontrol`.

.DESCRIPTION
  Causa del fallo anterior (0 tablas sin error visible), reproducida en una instancia de prueba:
  el cliente mysql 26.7 tiene `commands = FALSE` por defecto en modo no interactivo. Así,
  `source`, `USE` y `DELIMITER` no se procesan como comandos del cliente, y con `--one-database`
  todas las sentencias se descartaban en silencio (código de salida 0). Este script:

  - Pasa `--commands` explícitamente y envía el SQL por la entrada estándar (UTF-8), sin `source`
    (que además fallaría con rutas que contienen espacios).
  - Protege la contraseña: la pide oculta (o la recibe como SecureString) y la entrega a mysql
    en un archivo de opciones temporal de acceso restringido, que se borra al terminar.
  - Antes de importar analiza schema.sql y aborta si contiene DROP/TRUNCATE/DELETE FROM/GRANT,
    otro USE/CREATE DATABASE distinto de `agrocontrol` o referencias a otras bases.
  - Aborta si `agrocontrol` no existe o ya tiene tablas (nunca borra ni sobrescribe).
  - No usa `--one-database`: en mysql 26.7 su filtro es poco fiable (descartaba todo en silencio
    sin `--commands` y, con él, emite diagnósticos 1064 espurios). La protección de otras bases se
    basa en el análisis estático, en `--database=agrocontrol` + `USE agrocontrol` del esquema, y en
    una huella de las demás bases comparada antes y después.
  - Muestra el error de MySQL (con número de línea) si algo falla, y verifica por nombre
    las 17 tablas y los 2 triggers esperados.

.PARAMETER SoloComprobar
  Hace todas las comprobaciones previas (conexión, base vacía, análisis del esquema) sin importar.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File database\importar-esquema.ps1 -SoloComprobar
  powershell -ExecutionPolicy Bypass -File database\importar-esquema.ps1
#>
param(
  [string]$Usuario  = "root",
  [string]$Servidor = "127.0.0.1",
  [int]   $Puerto   = 3306,
  [System.Security.SecureString]$Contrasena,
  [switch]$SoloComprobar
)

$ErrorActionPreference = "Stop"
$BaseDatos = "agrocontrol"   # fijo a propósito: este script no admite otra base
$Esquema   = Join-Path $PSScriptRoot "schema.sql"

$TablasEsperadas = @(
  'actuadores','alertas','arranques_dispositivo','auditoria','ciclos_riego','configuraciones_control',
  'cultivos','dispositivos','eventos_dispositivo','mediciones','ordenes_riego','sensores',
  'terrenos','tokens_refresco','usuario_terreno','usuarios','zonas'
)
$TriggersEsperados = @('trg_ordenes_inmutables','trg_ordenes_sin_borrado')

function Fallar([string]$mensaje) {
  Write-Host ""
  Write-Host "ERROR: $mensaje" -ForegroundColor Red
  throw $mensaje
}

# ---------------------------------------------------------------- 1. Cliente y esquema
$mysql = Get-ChildItem "C:\Program Files\MySQL\*\bin\mysql.exe" -ErrorAction SilentlyContinue |
         Sort-Object FullName -Descending | Select-Object -First 1
if (-not $mysql) { Fallar "No se encontró mysql.exe en C:\Program Files\MySQL\*\bin" }
if (-not (Test-Path $Esquema)) { Fallar "No se encontró $Esquema" }

$sqlTexto = [IO.File]::ReadAllText($Esquema, [Text.Encoding]::UTF8)

# ---------------------------------------------------------------- 2. Análisis estático del esquema
# Se eliminan comentarios para no dar falsos positivos con el texto explicativo.
$sinComentarios = [regex]::Replace($sqlTexto, '/\*.*?\*/', ' ', 'Singleline')
$sinComentarios = [regex]::Replace($sinComentarios, '(?m)--[^\r\n]*', ' ')
$sinComentarios = [regex]::Replace($sinComentarios, "'(?:[^'\\]|\\.)*'", "''")   # literales de texto

$problemas = @()
$prohibidas = @{
  'DROP'                         = '\bDROP\s+(TABLE|DATABASE|SCHEMA|TRIGGER|VIEW|USER|INDEX|PROCEDURE|FUNCTION)\b'
  'TRUNCATE'                     = '\bTRUNCATE\b'
  'DELETE FROM'                  = '\bDELETE\s+FROM\b'
  'ALTER DATABASE/USER'          = '\bALTER\s+(DATABASE|SCHEMA|USER)\b'
  'GRANT/REVOKE'                 = '\b(GRANT|REVOKE)\b'
  'CREATE/RENAME USER'           = '\b(CREATE|RENAME)\s+USER\b'
  'RENAME TABLE'                 = '\bRENAME\s+TABLE\b'
  'LOAD DATA / SYSTEM / SOURCE'  = '(?im)^\s*(LOAD\s+DATA|SYSTEM|\\!|SOURCE|\\\.)\b'
}
foreach ($nombre in $prohibidas.Keys) {
  if ([regex]::IsMatch($sinComentarios, $prohibidas[$nombre], 'IgnoreCase')) { $problemas += "contiene $nombre" }
}
foreach ($m in [regex]::Matches($sinComentarios, '(?im)^\s*USE\s+`?(\w+)`?')) {
  if ($m.Groups[1].Value -ne $BaseDatos) { $problemas += "USE de otra base: $($m.Groups[1].Value)" }
}
foreach ($m in [regex]::Matches($sinComentarios, '(?i)\bCREATE\s+(DATABASE|SCHEMA)\s+(IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?')) {
  if ($m.Groups[3].Value -ne $BaseDatos) { $problemas += "CREATE DATABASE de otra base: $($m.Groups[3].Value)" }
}
# Referencias calificadas base.tabla (se ignoran OLD./NEW. de los triggers y números).
foreach ($m in [regex]::Matches($sinComentarios, '(?i)\b([a-z_]\w*)\s*\.\s*`?[a-z_]\w*')) {
  $prefijo = $m.Groups[1].Value
  if ($prefijo -notin @('OLD','NEW') -and $prefijo -ne $BaseDatos) { $problemas += "referencia a otra base: $($m.Value)" }
}
if ($problemas.Count -gt 0) {
  Fallar ("schema.sql no supera el análisis de seguridad:`n  - " + (($problemas | Select-Object -Unique) -join "`n  - "))
}
Write-Host "Análisis de schema.sql: sin sentencias destructivas ni referencias a otras bases." -ForegroundColor Green

# ---------------------------------------------------------------- 3. Credenciales
Write-Host "Cliente:  $($mysql.FullName)"
Write-Host "Destino:  ${Usuario}@${Servidor}:${Puerto} / base '$BaseDatos'"
if (-not $Contrasena) { $Contrasena = Read-Host "Contraseña de MySQL para '$Usuario'" -AsSecureString }

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Contrasena)
$opciones = Join-Path $env:TEMP ("agro-mysql-" + [guid]::NewGuid().ToString("N") + ".cnf")
try {
  $plano = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  # En archivos de opciones de MySQL, dentro de comillas dobles, '\' y '"' se escapan con '\'.
  $escapada = $plano.Replace('\', '\\').Replace('"', '\"')
  $plano = $null
  # Se crea vacío, se restringe el acceso y sólo entonces se escribe la contraseña.
  New-Item -ItemType File -Path $opciones -Force | Out-Null
  icacls $opciones /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
  [IO.File]::WriteAllText($opciones,
    "[client]`r`nuser=$Usuario`r`npassword=`"$escapada`"`r`nhost=$Servidor`r`nport=$Puerto`r`n",
    (New-Object Text.UTF8Encoding $false))
  $escapada = $null
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

function Invoke-MySql {
  param([string[]]$Argumentos, [string]$Entrada = $null)
  $todos = @("--defaults-extra-file=$opciones", "--default-character-set=utf8mb4") + $Argumentos
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $mysql.FullName
  $psi.Arguments = ($todos | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput  = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding  = [Text.Encoding]::UTF8
  $p = [Diagnostics.Process]::Start($psi)
  $tOut = $p.StandardOutput.ReadToEndAsync()
  $tErr = $p.StandardError.ReadToEndAsync()
  if ($Entrada) {
    $bytes = (New-Object Text.UTF8Encoding $false).GetBytes($Entrada)
    $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  }
  $p.StandardInput.Close()
  $p.WaitForExit()
  [pscustomobject]@{ Codigo = $p.ExitCode; Salida = $tOut.Result.Trim(); Error = $tErr.Result.Trim() }
}

function Consultar([string]$sql) {
  $r = Invoke-MySql -Argumentos @('--batch', '--skip-column-names', '-e', $sql)
  if ($r.Codigo -ne 0) { Fallar "MySQL devolvió un error (código $($r.Codigo)):`n$($r.Error)" }
  return $r.Salida
}

# Huella de las demás bases (tablas, columnas, filas estimadas y última actualización).
$sqlHuella = @"
SELECT CONCAT_WS('|', t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_TYPE, IFNULL(t.TABLE_ROWS,''), IFNULL(t.UPDATE_TIME,''),
       (SELECT COUNT(*) FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME))
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA NOT IN ('$BaseDatos','mysql','information_schema','performance_schema','sys')
ORDER BY 1;
"@

try {
  # ------------------------------------------------------------ 4. Comprobaciones previas
  Write-Host "Servidor: MySQL $(Consultar 'SELECT VERSION();')"
  if ((Consultar "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$BaseDatos';") -ne '1') {
    Fallar "La base '$BaseDatos' no existe. Créala primero; este script no la crea."
  }
  $tablasPrevias = [int](Consultar "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$BaseDatos';")
  if ($tablasPrevias -ne 0) {
    Fallar "La base '$BaseDatos' ya contiene $tablasPrevias tabla(s). Importación cancelada para no sobrescribir datos."
  }
  Write-Host "Base '$BaseDatos': existe y está vacía."
  $otrasBases = Consultar "SELECT IFNULL(GROUP_CONCAT(SCHEMA_NAME ORDER BY SCHEMA_NAME SEPARATOR ', '),'(ninguna)') FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('$BaseDatos','mysql','information_schema','performance_schema','sys');"
  Write-Host "Otras bases (no se tocarán): $otrasBases"
  $huellaAntes = Consultar $sqlHuella

  if ($SoloComprobar) {
    Write-Host ""
    Write-Host "Comprobación terminada: todo listo. No se importó nada (-SoloComprobar)." -ForegroundColor Green
    return
  }

  # ------------------------------------------------------------ 5. Importación
  # --commands: imprescindible en mysql 26.7 para procesar USE y DELIMITER (por defecto está desactivado
  # en modo no interactivo, y entonces los triggers fallan o, con --one-database, todo se omite).
  Write-Host "Importando $Esquema ..."
  $r = Invoke-MySql -Argumentos @("--database=$BaseDatos", '--commands', '--show-warnings') -Entrada $sqlTexto
  if ($r.Salida) { Write-Host $r.Salida }
  if ($r.Codigo -ne 0 -or $r.Error -match 'ERROR \d+') {
    $parciales = Consultar "SELECT IFNULL(GROUP_CONCAT(TABLE_NAME ORDER BY TABLE_NAME),'(ninguna)') FROM information_schema.TABLES WHERE TABLE_SCHEMA='$BaseDatos';"
    Fallar ("La importación falló (código $($r.Codigo)). Mensaje de MySQL:`n$($r.Error)`n" +
            "Tablas creadas parcialmente en '$BaseDatos': $parciales`n" +
            "No se borró nada automáticamente.")
  }
  if ($r.Error) { Write-Host "Avisos de MySQL:`n$($r.Error)" -ForegroundColor Yellow }

  # ------------------------------------------------------------ 6. Verificación
  $tablas   = @((Consultar "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$BaseDatos' ORDER BY 1;") -split "`r?`n" | Where-Object { $_ })
  $triggers = @((Consultar "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='$BaseDatos' ORDER BY 1;") -split "`r?`n" | Where-Object { $_ })
  $checks   = Consultar "SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='$BaseDatos';"
  $faltanT  = $TablasEsperadas   | Where-Object { $_ -notin $tablas }
  $faltanTr = $TriggersEsperados | Where-Object { $_ -notin $triggers }

  Write-Host ""
  Write-Host "Tablas:   $($tablas.Count) de $($TablasEsperadas.Count) esperadas"
  Write-Host "Triggers: $($triggers.Count) de $($TriggersEsperados.Count) esperados ($($triggers -join ', '))"
  Write-Host "CHECKs:   $checks"
  if ($faltanT -or $faltanTr -or $tablas.Count -ne $TablasEsperadas.Count -or $triggers.Count -ne $TriggersEsperados.Count) {
    Fallar "El resultado no coincide. Faltan tablas: $($faltanT -join ', ')  Faltan triggers: $($faltanTr -join ', ')"
  }

  $huellaDespues = Consultar $sqlHuella
  if ($huellaDespues -ne $huellaAntes) {
    Fallar "La huella de otras bases cambió durante la importación. Revise manualmente."
  }
  Write-Host "Otras bases: sin cambios (huella idéntica antes y después)."
  Write-Host ""
  Write-Host "Importación completada en '$BaseDatos'." -ForegroundColor Green
}
finally {
  if (Test-Path $opciones) { Remove-Item $opciones -Force }
}
