# LIREP | Actualizar el MISMO Worker existente. PowerShell 5.1, cualquier carpeta.
$ErrorActionPreference = 'Stop'
$branch = 'feature/lirep-auto-onboarding-layout-20261114'
$root = Join-Path $env:TEMP ('LIREP-UPDATE-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$zip = Join-Path $root 'source.zip'
Invoke-WebRequest -Uri ('https://github.com/vidadecanesperu-max/lirep/archive/refs/heads/' + $branch + '.zip') -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $root -Force
$cfg = Get-ChildItem $root -Recurse -Filter wrangler.jsonc -File | Where-Object { $_.FullName -match '[\\/]worker[\\/]wrangler\.jsonc$' } | Select-Object -First 1
if (-not $cfg) { throw 'Falta configuracion Worker' }
$dir = Split-Path $cfg.FullName -Parent
$js = Join-Path $dir 'src\index.js'
$src = [IO.File]::ReadAllText($js)
if (-not $src.Contains('notificaciones@360insol.com') -or -not $src.Contains('displayComplaintCode')) { throw 'Version de codigo incorrecta' }
& node --check $js
if ($LASTEXITCODE -ne 0) { throw 'Fallo sintaxis. Sin despliegue.' }
Push-Location $dir
try {
  Write-Host 'Actualizando SOLO el Worker lirep-public-api existente...' -ForegroundColor Cyan
  & npx --yes wrangler@4.158.0 deploy --config wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw 'Despliegue fallido' }
} finally { Pop-Location }
Write-Host 'LIREP | Actualizacion enviada. Verificar correo pendiente despues del siguiente cron.' -ForegroundColor Green
