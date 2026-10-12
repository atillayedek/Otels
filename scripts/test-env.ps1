<#
.SYNOPSIS
  İzole test ortamı: ayrı veri kökü, ayrı PostgreSQL kümesi (54339) ve ayrı portlar (18443/18080).
  Otelin gerçek PMS verisine (%ProgramData%\HotelPMS) asla dokunmaz.
.PARAMETER Root      Test veri kökü (varsayılan: %TEMP%\HotelPMS-Test). Yol ASCII olmalıdır.
.PARAMETER PgBin     PostgreSQL bin klasörü (ASCII yol). Varsayılan: <Root>\pgsql\bin (installer\vendor'dan kopyalanır).
.PARAMETER Reset     Test veri kökünü silip sıfırdan kurar.
.PARAMETER Stop      Test sunucusunu ve test PostgreSQL'i durdurur.
#>
param(
    [string]$Root = (Join-Path $env:TEMP 'HotelPMS-Test'),
    [string]$PgBin,
    [switch]$Reset,
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if ($Root -match '[^\x00-\x7F]') { throw "Test kökü ASCII olmalı (PostgreSQL initdb kısıtı): $Root" }
$data = Join-Path $Root 'data'
if (-not $PgBin) { $PgBin = Join-Path $Root 'pgsql\bin' }
$server = Join-Path $repo 'build\server-dev\HotelPms.Server.exe'
$pidFile = Join-Path $Root 'server.pid'

function Stop-TestEnv {
    Get-Process HotelPms.Server -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $server } | Stop-Process -Force
    if (Test-Path $pidFile) { Stop-Process -Id (Get-Content $pidFile) -Force -ErrorAction SilentlyContinue; Remove-Item $pidFile }
    if (Test-Path (Join-Path $data 'pgdata\postmaster.pid')) {
        try { & (Join-Path $PgBin 'pg_ctl.exe') stop -D (Join-Path $data 'pgdata') -m fast 2>$null | Out-Null } catch { }
        Remove-Item (Join-Path $data 'pgdata\postmaster.pid') -ErrorAction SilentlyContinue
    }
}

if ($Stop) { Stop-TestEnv; return }

if (-not (Test-Path (Join-Path $PgBin 'initdb.exe'))) {
    $vendor = Join-Path $repo 'installer\vendor\pgsql'
    if (-not (Test-Path $vendor)) { throw "PostgreSQL binary'leri yok. installer\fetch-postgres.ps1 çalıştırın." }
    foreach ($d in 'bin', 'lib', 'share') { robocopy (Join-Path $vendor $d) (Join-Path (Split-Path $PgBin) $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null }
}

Stop-TestEnv
if ($Reset -and (Test-Path $data)) { Remove-Item $data -Recurse -Force }

dotnet build (Join-Path $repo 'src\HotelPms.Server\HotelPms.Server.csproj') -c Debug -o (Join-Path $repo 'build\server-dev') -v q -nologo | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Sunucu derlenemedi' }

$env:HOTELPMS_DATA_ROOT = $data
$env:HOTELPMS_PG_BIN = $PgBin
& $server provision --start-postgres --db-port 54339 --https-port 18443 --http-port 18080 | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Provision başarısız' }

$p = Start-Process -FilePath $server -RedirectStandardOutput (Join-Path $Root 'server.out') -RedirectStandardError (Join-Path $Root 'server.err') -PassThru -WindowStyle Hidden
$p.Id | Out-File $pidFile
for ($i = 0; $i -lt 60; $i++) {
    try { $h = Invoke-RestMethod -Uri 'http://127.0.0.1:18080/api/v1/system/health' -TimeoutSec 2; if ($h.database) { break } } catch { }
    Start-Sleep -Milliseconds 500
}
Write-Host "Test sunucusu: https://127.0.0.1:18443  (veri: $data)"
Write-Host "CA: $(Join-Path $data 'certs\hotelpms-local-ca.crt')"
Write-Host "Kurulum kodu dosyası: $(Join-Path $data 'config\setup-token.txt')"
