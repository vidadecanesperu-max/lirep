# LIREP | Upload seguro de diagnostico Turnstile (sin promocion automatica)
# Ejecutar desde cualquier carpeta en PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$branch = 'feature/lirep-auto-onboarding-layout-20261114'
$root = Join-Path $env:TEMP ('LIREP-TURNSTILE-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$zip = Join-Path $root 'lirep.zip'
$repoUrl = 'https://github.com/vidadecanesperu-max/lirep/archive/refs/heads/' + $branch + '.zip'
Write-Host 'LIREP | Descargando rama QA...'
Invoke-WebRequest -Uri $repoUrl -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $root -Force
$workerConfig = Get-ChildItem -Path $root -Filter 'wrangler.jsonc' -Recurse -File | Where-Object { $_.FullName -match '[\\/]worker[\\/]wrangler\.jsonc$' } | Select-Object -First 1
if (-not $workerConfig) { throw 'No se encontro worker/wrangler.jsonc en el paquete' }
$workerDir = Split-Path $workerConfig.FullName -Parent
$workerJs = Join-Path $workerDir 'src\index.js'
if (-not (Test-Path $workerJs)) { throw 'Falta worker/src/index.js' }
$source = [IO.File]::ReadAllText($workerJs)
if (-not $source.Contains('LIREP_TURNSTILE') -or -not $source.Contains('SITEVERIFY_REJECTED')) {
  throw 'El codigo descargado no contiene la instrumentacion de diagnostico'
}
Write-Host 'LIREP | Validando sintaxis...'
& node --check $workerJs
if ($LASTEXITCODE -ne 0) { throw 'Fallo node --check; no se publicara' }
Push-Location $workerDir
try {
  Write-Host 'LIREP | Subiendo nueva version SIN activarla...'
  & npx --yes wrangler@4.158.0 versions upload --config wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw 'Wrangler no pudo subir la version' }
  Write-Host 'LIREP | VERSION SUBIDA, NO PROMOCIONADA'
  Write-Host 'Cloudflare > Workers & Pages > lirep-public-api > Deployments/Versions > Promote la nueva version a 100%'
  Write-Host 'Despues de promocionar, no reenvies la reclamacion hasta revisar el diagnostico.'
} finally { Pop-Location }
