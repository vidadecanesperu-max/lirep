# ============================================================
# LIREP | QA305 | PUBLICACION DEL PANEL EXISTENTE
# PowerShell 5.1 | Cloudflare Pages Free | SIN SQL
# Usa el paquete QA303 ya validado. No crea proyectos.
# ============================================================

$ErrorActionPreference = "Stop"
$Project = "lirep-admin-360"
$Branch = "main"
$PreviewBranch = "qa305-release"
$Root = "C:\Users\Smerling\Documents\LIREP-QA295-20261105-225109\QA303-RELEASE-20261106-141015"
$Site = Join-Path $Root "site"
$ManifestPath = Join-Path $Root "manifest.json"
$IndexPath = Join-Path $Site "index.html"
$ConfigPath = Join-Path $Site "config.js"
$ProductionUrl = "https://lirep-admin-360.pages.dev/"
$PreviewUrl = "https://qa305-release.lirep-admin-360.pages.dev/"

Write-Host "============================================"
Write-Host " LIREP | QA305 | CIERRE CLOUDFLARE PAGES"
Write-Host "============================================"

foreach ($File in @($ManifestPath, $IndexPath, $ConfigPath)) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
        throw "Archivo QA303 no encontrado: $File"
    }
}

$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Manifest.application -cne "LIREP ADMIN" -or
    $Manifest.qa -cne "QA303" -or
    $Manifest.project -cne $Project -or
    $Manifest.environment -cne "production") {
    throw "El manifiesto no corresponde al paquete QA303 de LIREP ADMIN."
}

$IndexHash = (Get-FileHash -LiteralPath $IndexPath -Algorithm SHA256).Hash
$ConfigHash = (Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash
if ($IndexHash -cne $Manifest.index_sha256 -or
    $ConfigHash -cne $Manifest.config_sha256 -or
    $ConfigHash -cne "36F32C63A1D72144D6406FD05CF8BD058E998508CC34C0AD2D01291EACB34E6A") {
    throw "El contenido QA303 cambio desde el preflight. Publicacion bloqueada."
}

$Index = Get-Content -LiteralPath $IndexPath -Raw -Encoding UTF8
$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
if (-not $Index.Contains("lirep-login-shell") -or
    -not $Index.Contains("lirep-login-card") -or
    -not $Config.Contains("hiidqmrgrioidvemixfe.supabase.co") -or
    -not $Config.Contains("sb_publishable_") -or
    $Index -match "(?i)QA299|QA297|SUPABASE STAGING|jitcayjaztceglqlmwvl" -or
    $Config -match "(?i)jitcayjaztceglqlmwvl|sb_secret_|service_role") {
    throw "El paquete no cumple el contrato de publicacion segura."
}

$Files = @(Get-ChildItem -LiteralPath $Site -File)
if ($Files.Count -ne 2) {
    throw "El directorio debe contener solo index.html y config.js."
}

Write-Host "PASS | Manifiesto QA303 e integridad SHA256"
Write-Host "PASS | Login moderno y configuracion productiva"
Write-Host "PASS | Sin conexiones staging ni secretos"

$Npx = (Get-Command npx.cmd -ErrorAction Stop).Source

Write-Host ""
Write-Host "Verificando proyecto Cloudflare existente..."
& $Npx --yes wrangler@4 pages deployment list --project-name $Project
if ($LASTEXITCODE -ne 0) {
    throw "El proyecto Pages no es accesible. No se crea otro."
}
Write-Host "PASS | Proyecto Pages existente accesible"

function Test-LirepPages {
    param([Parameter(Mandatory=$true)][string]$Url)
    try {
        $Html = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
        $Cfg = Invoke-WebRequest -Uri ($Url + "config.js") -UseBasicParsing -TimeoutSec 20
        return ($Html.StatusCode -eq 200 -and
            $Cfg.StatusCode -eq 200 -and
            $Html.Content.Contains("lirep-login-shell") -and
            $Html.Content.Contains("lirep-login-card") -and
            $Cfg.Content.Contains("hiidqmrgrioidvemixfe.supabase.co") -and
            $Cfg.Content.Contains("sb_publishable_") -and
            -not $Html.Content.Contains("SUPABASE STAGING"))
    } catch {
        return $false
    }
}

Write-Host ""
Write-Host "Publicando vista previa aislada..."
& $Npx --yes wrangler@4 pages deploy $Site --project-name $Project --branch $PreviewBranch
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo desplegar la vista previa. Produccion intacta."
}

$PreviewPass = $false
for ($Attempt = 1; $Attempt -le 20; $Attempt++) {
    if (Test-LirepPages -Url $PreviewUrl) {
        $PreviewPass = $true
        break
    }
    Start-Sleep -Seconds 5
}
if (-not $PreviewPass) {
    throw "La vista previa no paso el smoke HTTP. Produccion intacta."
}
Write-Host "PASS | Vista previa HTTP 200 con login LIREP y configuracion productiva"
Write-Host "PREVIEW: $PreviewUrl"

Write-Host ""
Write-Host "Publicando version validada en main..."
& $Npx --yes wrangler@4 pages deploy $Site --project-name $Project --branch $Branch
if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare rechazo la publicacion principal."
}

$ProductionPass = $false
for ($Attempt = 1; $Attempt -le 20; $Attempt++) {
    if (Test-LirepPages -Url $ProductionUrl) {
        $ProductionPass = $true
        break
    }
    Start-Sleep -Seconds 5
}
if (-not $ProductionPass) {
    throw "La URL principal no paso la verificacion. Revisar despliegue en Cloudflare."
}

Write-Host "PASS | Login actualizado en dominio principal"
Write-Host ""
Write-Host "Comprobando API publica y Supabase de produccion..."

$Health = Invoke-RestMethod -Uri "https://lirep-public-api.vidadecanes-peru.workers.dev/health" -TimeoutSec 20
$Backend = Invoke-RestMethod -Uri "https://lirep-public-api.vidadecanes-peru.workers.dev/health/backend" -TimeoutSec 20

if ($Health.ok -ne $true -or $Backend.connected -ne $true) {
    throw "Panel publicado, pero el Worker o Supabase requiere revision."
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " LIREP | QA305 | PUBLICACION VERIFICADA" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host "PASS | Proyecto Pages correcto"
Write-Host "PASS | Vista previa"
Write-Host "PASS | Panel administrativo publicado"
Write-Host "PASS | Configuracion de produccion"
Write-Host "PASS | Worker y Supabase operativos"
Write-Host "URL: $ProductionUrl"
Write-Host "SIN CAMBIOS SQL"
Write-Host "SIN MODIFICAR STAGING"
Write-Host "============================================"
