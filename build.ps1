# MetroFlow - compilación con g++ (sin CMake).
#
# Uso:
#   ./build.ps1            # compila CLI y pruebas
#   ./build.ps1 -Run       # compila y ejecuta las pruebas
#   ./build.ps1 -Api       # compila además el servidor API
#   ./build.ps1 -Serve     # compila el API y lo deja corriendo
#   ./build.ps1 -All       # CLI + pruebas + API
#
# Requiere g++ (MSYS2/UCRT64) en el PATH.

param(
    [switch]$Run,
    [switch]$Api,
    [switch]$Serve,
    [switch]$All
)

if ($All) { $Api = $true }

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$buildDir = Join-Path $root "build"
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$cxx = "g++"
$opt = "-O2"
$std = "-std=c++17"
$includes = @("-I", (Join-Path $backend "include"), "-I", (Join-Path $backend "third_party"))

$engineSources = @(
    "Graph.cpp",
    "Dijkstra.cpp",
    "Bfs.cpp",
    "RoutePlanner.cpp",
    "DataLoader.cpp",
    "Serialize.cpp"
) | ForEach-Object { Join-Path $backend "src" $_ }

$commonArgs = @($std, $opt, "-Wall", "-Wextra") + $includes

Write-Host "== Compilando CLI ==" -ForegroundColor Cyan
$cliSources = $engineSources + (Join-Path $backend "src" "cli_main.cpp")
& $cxx @commonArgs @cliSources "-o" (Join-Path $buildDir "metroflow_cli.exe")
if ($LASTEXITCODE -ne 0) { throw "Falló la compilación del CLI" }

Write-Host "== Compilando pruebas ==" -ForegroundColor Cyan
$testSources = $engineSources + @(
    (Join-Path $root "tests" "test_main.cpp"),
    (Join-Path $root "tests" "graph_tests.cpp"),
    (Join-Path $root "tests" "route_tests.cpp"),
    (Join-Path $root "tests" "trace_tests.cpp")
)
& $cxx @commonArgs @testSources "-o" (Join-Path $buildDir "metroflow_tests.exe")
if ($LASTEXITCODE -ne 0) { throw "Falló la compilación de las pruebas" }

Write-Host "OK -> build/metroflow_cli.exe, build/metroflow_tests.exe" -ForegroundColor Green

if ($Api -or $Serve) {
    Write-Host "== Compilando API ==" -ForegroundColor Cyan
    $apiIncludes = $includes + @(
        "-I", (Join-Path $backend "third_party" "crow"),
        "-I", (Join-Path $backend "third_party" "asio" "include")
    )
    $apiArgs = @($std, $opt, "-Wall", "-Wextra") + $apiIncludes
    $apiSources = $engineSources + (Join-Path $backend "src" "api_main.cpp")
    $apiExe = Join-Path $buildDir "metroflow_api.exe"
    & $cxx @apiArgs @apiSources "-lws2_32" "-lwsock32" "-o" $apiExe
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación del API" }
    Write-Host "OK -> build/metroflow_api.exe" -ForegroundColor Green
}

if ($Run) {
    Write-Host "== Ejecutando pruebas ==" -ForegroundColor Cyan
    & (Join-Path $buildDir "metroflow_tests.exe")
}

if ($Serve) {
    Write-Host "== Iniciando API en http://localhost:18080 ==" -ForegroundColor Cyan
    & (Join-Path $buildDir "metroflow_api.exe")
}
