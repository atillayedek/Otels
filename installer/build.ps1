#Requires -Version 5.1
<#
  HotelPMS-Setup.exe derlemesi.
    1) Sunucu ve Server Manager'ı self-contained (win-x64) yayınlar
    2) PostgreSQL ikili dosyalarının yalnız gerekli klasörlerini (bin, lib, share) hazırlar
    3) PMS Client kurulum dosyasını (Tauri/NSIS) alır
    4) Inno Setup ile kurulum dosyasını derler -> build\installer\HotelPMS-Setup-<sürüm>.exe

  Gereksinimler: .NET 10 SDK, Inno Setup 6, installer\vendor\pgsql (fetch-postgres.ps1), PMS Client derlemesi.
  -ClientSetup: PMS Client NSIS kurulum dosyasının yolu (varsayılan: CARGO_TARGET_DIR veya desktop-client\src-tauri\target altındaki son derleme).
#>
param(
  [string]$Version = "1.0.0",
  [string]$ClientSetup = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root "build\installer-stage"

function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Step "Sunucu yayınlanıyor"
dotnet publish (Join-Path $root "src\HotelPms.Server\HotelPms.Server.csproj") -c Release -r win-x64 --self-contained true -p:Version=$Version -o (Join-Path $stage "server")
if ($LASTEXITCODE -ne 0) { throw "Sunucu yayınlanamadı." }

Step "Server Manager yayınlanıyor"
dotnet publish (Join-Path $root "src\HotelPms.Manager\HotelPms.Manager.csproj") -c Release -r win-x64 --self-contained true -p:Version=$Version -o (Join-Path $stage "manager")
if ($LASTEXITCODE -ne 0) { throw "Server Manager yayınlanamadı." }

Step "PostgreSQL ikili dosyaları hazırlanıyor"
$pg = Join-Path $PSScriptRoot "vendor\pgsql"
if (-not (Test-Path (Join-Path $pg "bin\initdb.exe"))) { throw "installer\vendor\pgsql bulunamadı. Önce installer\fetch-postgres.ps1 çalıştırın." }
foreach ($d in "bin", "lib", "share") {
  robocopy (Join-Path $pg $d) (Join-Path $stage "pgsql\$d") /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "PostgreSQL kopyalanamadı ($d)." }
}
$global:LASTEXITCODE = 0

Step "PMS Client kurulum dosyası alınıyor"
if (-not $ClientSetup) {
  $targets = @()
  if ($env:CARGO_TARGET_DIR) { $targets += Join-Path $env:CARGO_TARGET_DIR "release\bundle\nsis" }
  $targets += Join-Path $root "desktop-client\src-tauri\target\release\bundle\nsis"
  $found = $targets | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Filter "*-setup.exe" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $found) { throw "PMS Client kurulum dosyası bulunamadı. desktop-client klasöründe 'npx tauri build' çalıştırın veya -ClientSetup verin." }
  $ClientSetup = $found.FullName
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage "client") | Out-Null
Copy-Item $ClientSetup (Join-Path $stage "client\PMS-Client-Setup.exe")

Step "Android uygulaması alınıyor"
$apk = Join-Path $root "build\android\TSDMR-Otel-PMS-Android.apk"
if (Test-Path $apk) { Copy-Item $apk (Join-Path $stage "client\TSDMR-Otel-PMS-Android.apk") }
else { Write-Host "  Android APK bulunamadı (build\android); kurulum paketine eklenmeyecek." -ForegroundColor Yellow }
$rapk = Join-Path $root "build\android\TSDMR-Restoran-Android.apk"
if (Test-Path $rapk) { Copy-Item $rapk (Join-Path $stage "client\TSDMR-Restoran-Android.apk") }
else { Write-Host "  Restoran APK bulunamadı (build\android); kurulum paketine eklenmeyecek." -ForegroundColor Yellow }

Step "Inno Setup derleniyor"
$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 (ISCC.exe) bulunamadı." }
& $iscc "/DAppVersion=$Version" "/DStage=$stage" (Join-Path $PSScriptRoot "HotelPMS.iss")
if ($LASTEXITCODE -ne 0) { throw "Kurulum dosyası derlenemedi." }

$out = Join-Path $root "build\installer\HotelPMS-Setup-$Version.exe"
Get-FileHash $out -Algorithm SHA256 | ForEach-Object { "$($_.Hash)  HotelPMS-Setup-$Version.exe" } | Set-Content -Encoding ascii "$out.sha256"
Write-Host "Hazır: $out" -ForegroundColor Green
