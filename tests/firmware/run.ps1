param([string]$Compiler = "g++")
$ErrorActionPreference = "Stop"
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$build = Join-Path $PSScriptRoot "build"
New-Item -ItemType Directory -Force -Path $build | Out-Null
$include = Join-Path $workspace "firmware-esp32/AgroControl"
& $Compiler -std=c++17 -Wall -Wextra -Werror -pedantic "-I$include" (Join-Path $PSScriptRoot "test_control.cpp") -o (Join-Path $build "tests.exe")
if ($LASTEXITCODE -ne 0) { throw "C++ test compilation failed" }
& (Join-Path $build "tests.exe") | Tee-Object -FilePath (Join-Path $build "results.txt")
if ($LASTEXITCODE -ne 0) { throw "C++ test failure" }
& $Compiler -std=c++17 -Wall -Wextra -Werror -pedantic (Join-Path $workspace "firmware-esp32/simulator.cpp") -o (Join-Path $build "simulator.exe")
if ($LASTEXITCODE -ne 0) { throw "Simulator compilation failed" }
Get-Content (Join-Path $PSScriptRoot "scenario.txt") | & (Join-Path $build "simulator.exe") | Tee-Object -FilePath (Join-Path $build "simulation.txt")
if ($LASTEXITCODE -ne 0) { throw "Simulator failure" }
