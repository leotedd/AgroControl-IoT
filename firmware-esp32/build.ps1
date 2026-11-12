param([switch]$ElfOnly,[switch]$Provisioning,[switch]$Wokwi,[switch]$TrialChecks)
$ErrorActionPreference = "Stop"
$cli = Join-Path $env:LOCALAPPDATA 'Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe'
if (!(Test-Path -LiteralPath $cli)) { throw "Arduino CLI not found; use Arduino IDE 2 Verify." }
if (([int]$Provisioning.IsPresent + [int]$Wokwi.IsPresent + [int]$TrialChecks.IsPresent) -gt 1) { throw 'Choose a single profile.' }
$name = if ($Provisioning) { 'ProvisionWifi' } elseif ($Wokwi) { 'WokwiSim' } elseif ($TrialChecks) { 'TrialChecks' } else { 'AgroControl' }
$buildPath = Join-Path $PSScriptRoot "build/$name"
New-Item -ItemType Directory -Force -Path $buildPath | Out-Null
$arguments = @('compile','--fqbn','esp32:esp32:esp32','--build-path',$buildPath)
$cliConfig = Join-Path $env:USERPROFILE '.arduinoIDE/arduino-cli.yaml'
if (Test-Path -LiteralPath $cliConfig) { $arguments += @('--config-file',$cliConfig) }
if ($ElfOnly) {
    Write-Output 'ELF ONLY: compiles/links real ESP32 code. Skips flash-image packaging; cannot upload ELF with Arduino IDE.'
    foreach ($recipe in @('recipe.hooks.prebuild.4.pattern','recipe.hooks.prebuild.4.pattern.windows',
        'recipe.objcopy.partitions.bin.pattern','recipe.objcopy.bin.pattern',
        'recipe.hooks.objcopy.postobjcopy.3.pattern','recipe.hooks.objcopy.postobjcopy.4.pattern',
        'recipe.hooks.objcopy.postobjcopy.4.pattern.windows')) {
        $arguments += @('--build-property',"$recipe=cmd /c exit 0")
    }
}
if ($TrialChecks) {
    $arguments += @('--build-property', ('compiler.cpp.extra_flags=-I"' + (Join-Path $PSScriptRoot 'AgroControl') + '"'))
    $arguments += Join-Path $PSScriptRoot 'verification/TrialChecks'
} else { $arguments += Join-Path $PSScriptRoot $name }
& $cli @arguments 2>&1 | Tee-Object -FilePath (Join-Path $buildPath 'compile.log')
if ($LASTEXITCODE -ne 0) { throw "Arduino build failed; inspect compile.log" }
Write-Output $(if ($ElfOnly) { 'ELF_COMPILE_LINK_PASS (no upload image)' } else { 'FULL_BUILD_PASS' })
