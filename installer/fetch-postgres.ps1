#Requires -Version 5.1
<#
  Kuruluma gömülecek PostgreSQL ikili dosyalarını EnterpriseDB'den indirir, SHA-256 ile doğrular ve installer\vendor\pgsql altına açar.
  vendor klasörü repoya konmaz (.gitignore).
#>
$ErrorActionPreference = "Stop"
$version = "17.7-1"
$url = "https://get.enterprisedb.com/postgresql/postgresql-$version-windows-x64-binaries.zip"
$sha256 = "2AACC055D9BAC49763AC0164759C13866BC0235123D7FFDBB6A6AAA20DC25D9A"
$vendor = Join-Path $PSScriptRoot "vendor"
$zip = Join-Path $vendor "postgresql-$version-windows-x64-binaries.zip"

New-Item -ItemType Directory -Force -Path $vendor | Out-Null
if (-not (Test-Path $zip)) {
  Write-Host "İndiriliyor: $url"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
if ($hash -ne $sha256) { Remove-Item $zip -Force; throw "PostgreSQL arşivinin SHA-256 özeti beklenenle eşleşmiyor. Dosya silindi." }

$dest = Join-Path $vendor "pgsql"
if (Test-Path (Join-Path $dest "bin\initdb.exe")) { Write-Host "Zaten hazır: $dest"; exit 0 }
Write-Host "Açılıyor…"
Expand-Archive -Path $zip -DestinationPath $vendor -Force
Write-Host "Hazır: $dest" -ForegroundColor Green
