# ============================================================
# LIREP | QA303 | RELEASE GATE DEL PANEL ADMINISTRATIVO
# PowerShell 5.1 + Node.js + Cloudflare Pages Free
# FUENTE: QA299 validado con Supabase staging
# DESTINO: lirep-admin-360 (solo panel; Worker no se toca)
# ============================================================
$PreviewOnly = $false # Cambiar a $true solo para publicar la vista previa.

$ErrorActionPreference = "Stop"
$Work = "C:\Users\Smerling\Documents\LIREP-QA295-20261105-225109"
$OriginalIndex = Join-Path $Work "public\index.html"
$OriginalConfig = Join-Path $Work "public\config.js"
$ExpectedConfigHash = "36F32C63A1D72144D6406FD05CF8BD058E998508CC34C0AD2D01291EACB34E6A"
$Project = "lirep-admin-360"
$ProductionBranch = "main"
$PreviewBranch = "qa303-release"
$Utf8 = New-Object System.Text.UTF8Encoding($false)

Write-Host "============================================"
Write-Host " LIREP | QA303 | PREFLIGHT RELEASE"
Write-Host "============================================"

foreach ($Path in @($OriginalIndex, $OriginalConfig)) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Archivo original ausente: $Path"
    }
}

$Qa299 = Get-ChildItem -LiteralPath $Work -Directory -Filter "QA299-STAGING-*" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $Qa299) {
    throw "No se encontro la copia QA299 validada."
}

$Qa299Index = Join-Path $Qa299.FullName "index.html"
if (-not (Test-Path -LiteralPath $Qa299Index -PathType Leaf)) {
    throw "Falta el index.html de QA299."
}

$ConfigHash = (Get-FileHash -LiteralPath $OriginalConfig -Algorithm SHA256).Hash
if ($ConfigHash -cne $ExpectedConfigHash) {
    throw "config.js original cambio desde QA296. No publicar sin revalidar."
}

$ConfigText = [IO.File]::ReadAllText($OriginalConfig)
if ($ConfigText -notmatch "hiidqmrgrioidvemixfe[.]supabase[.]co" -or
    $ConfigText -notmatch "sb_publishable_" -or
    $ConfigText -match "jitcayjaztceglqlmwvl|sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY") {
    throw "Configuracion de produccion no valida o contiene secreto."
}

$QaHtml = [IO.File]::ReadAllText($Qa299Index)
$OriginalHtml = [IO.File]::ReadAllText($OriginalIndex)

$Banner = '(?is)<div style="padding:10px;text-align:center;background:#e7edf8;color:#15243b;font:600 12px system-ui">\s*LIREP\s*·\s*QA299\s*·\s*SUPABASE STAGING\s*·\s*NO PRODUCCION\s*</div>'
if ([regex]::Matches($QaHtml, $Banner).Count -ne 1) {
    throw "No se pudo identificar de forma univoca el banner de QA299."
}

$ReleaseHtml = [regex]::Replace($QaHtml, $Banner, "")
$Marker = '<script src="./config.js"></script>'
$Workspace = '<section id="workspace"'

foreach ($Required in @(
    'id="loginForm"',
    'id="workspace"',
    'lirep-login-shell',
    'lirep-login-card',
    'Powered by 360 Integral Solutions',
    $Marker
)) {
    if (-not $ReleaseHtml.Contains($Required)) {
        throw "Componente obligatorio ausente: $Required"
    }
}

if ($ReleaseHtml -match '(?i)QA299|QA297|SUPABASE STAGING|jitcayjaztceglqlmwvl|127[.]0[.]0[.]1') {
    throw "El HTML de publicacion contiene referencias QA."
}

$OStart = $OriginalHtml.IndexOf($Workspace)
$RStart = $ReleaseHtml.IndexOf($Workspace)
$OEnd = $OriginalHtml.IndexOf($Marker)
$REnd = $ReleaseHtml.IndexOf($Marker)

if ($OStart -lt 0 -or $RStart -lt 0 -or $OEnd -le $OStart -or $REnd -le $RStart) {
    throw "Estructura del panel no reconocida."
}

$OriginalPanel = $OriginalHtml.Substring($OStart, $OEnd - $OStart)
$ReleasePanel = $ReleaseHtml.Substring($RStart, $REnd - $RStart)
if (-not [string]::Equals($OriginalPanel, $ReleasePanel, [StringComparison]::Ordinal)) {
    throw "El panel administrativo difiere del original QA295."
}

$OriginalTail = $OriginalHtml.Substring($OEnd)
$ReleaseTail = $ReleaseHtml.Substring($REnd)
$OriginalTail = $OriginalTail.Replace('$("loginForm").querySelector("p")?.remove();', '')
if (-not [string]::Equals($OriginalTail, $ReleaseTail, [StringComparison]::Ordinal)) {
    throw "El JavaScript de QA299 contiene cambios inesperados."
}

$Scripts = @([regex]::Matches(
    $ReleaseHtml,
    '(?is)<script(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script>'
))
if ($Scripts.Count -ne 1) {
    throw "Se esperaba exactamente un script administrativo."
}

$Node = (Get-Command node -ErrorAction Stop).Source
$Npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$ReleaseRoot = Join-Path $Work ("QA303-RELEASE-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$Site = Join-Path $ReleaseRoot "site"
New-Item -ItemType Directory -Path $Site -Force | Out-Null

$CheckJs = Join-Path $ReleaseRoot "app-check.js"
[IO.File]::WriteAllText($CheckJs, $Scripts[0].Groups[1].Value, $Utf8)
& $Node --check $CheckJs
if ($LASTEXITCODE -ne 0) {
    throw "Error de sintaxis JavaScript."
}

$SiteIndex = Join-Path $Site "index.html"
$SiteConfig = Join-Path $Site "config.js"
[IO.File]::WriteAllText($SiteIndex, $ReleaseHtml, $Utf8)
[IO.File]::WriteAllText($SiteConfig, $ConfigText, $Utf8)

$Files = @(Get-ChildItem -LiteralPath $Site -File)
if ($Files.Count -ne 2) {
    throw "El paquete debe contener solo index.html y config.js."
}

$Manifest = [pscustomobject]@{
    application = "LIREP ADMIN"
    qa = "QA303"
    project = $Project
    environment = "production"
    source = $Qa299.FullName
    source_config_sha256 = $ConfigHash
    index_sha256 = (Get-FileHash -LiteralPath $SiteIndex -Algorithm SHA256).Hash
    config_sha256 = (Get-FileHash -LiteralPath $SiteConfig -Algorithm SHA256).Hash
    created_at = (Get-Date).ToString("o")
    files = @("index.html", "config.js")
}
$ManifestPath = Join-Path $ReleaseRoot "manifest.json"
[IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json -Depth 5), $Utf8)

Write-Host "PASS | Login QA299 preservado"
Write-Host "PASS | Panel y JavaScript conservados"
Write-Host "PASS | Correccion del formulario preservada"
Write-Host "PASS | Configuracion original de produccion verificada"
Write-Host "PASS | Sin secretos ni URLs staging en el paquete"
Write-Host "PASS | Solo dos archivos para Cloudflare Pages"
Write-Host "MANIFIESTO: $ManifestPath"

# No desplegar si Wrangler no puede identificar el proyecto existente.
Write-Host ""
Write-Host "Verificando cuenta y proyecto de Cloudflare..."
& $Npx --yes wrangler@4 whoami
if ($LASTEXITCODE -ne 0) {
    Write-Host "Es necesario iniciar sesion en Cloudflare."
    & $Npx --yes wrangler@4 login
    if ($LASTEXITCODE -ne 0) {
        throw "No se completo la autenticacion de Cloudflare."
    }
}

$ProjectJsonText = (& $Npx --yes wrangler@4 pages project list --json | Out-String)
if ($LASTEXITCODE -ne 0) {
    Write-Host "Se requiere autenticar Cloudflare para listar Pages."
    & $Npx --yes wrangler@4 login
    if ($LASTEXITCODE -ne 0) {
        throw "No se completo el acceso a Cloudflare."
    }
    $ProjectJsonText = (& $Npx --yes wrangler@4 pages project list --json | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo consultar el inventario de Cloudflare Pages."
    }
}
try {
    $ParsedProjects = $ProjectJsonText | ConvertFrom-Json
} catch {
    throw "La respuesta de Cloudflare Pages no es JSON valido."
}
if ($ParsedProjects -is [array]) {
    $Projects = $ParsedProjects
} elseif ($null -ne $ParsedProjects.result) {
    $Projects = @($ParsedProjects.result)
} else {
    $Projects = @($ParsedProjects)
}
$TargetProject = @($Projects | Where-Object { $_.name -ceq $Project })
if ($TargetProject.Count -ne 1) {
    throw "No se encontro exactamente un proyecto Pages con el nombre requerido."
}
if ($TargetProject[0].production_branch -cne $ProductionBranch) {
    throw "La rama de produccion no es main. No se realizara ningun despliegue."
}

Write-Host "PASS | Proyecto Pages existente y rama main verificados"

# Primera etapa: desplegar a rama de vista previa.
Write-Host ""
Write-Host "Publicando vista previa en $PreviewBranch..."
& $Npx --yes wrangler@4 pages deploy $Site --project-name $Project --branch $PreviewBranch
if ($LASTEXITCODE -ne 0) {
    throw "Fallo la publicacion de vista previa."
}

$PreviewUrl = "https://$PreviewBranch.$Project.pages.dev/"
$PreviewPassed = $false

for ($Attempt = 1; $Attempt -le 12; $Attempt++) {
    try {
        $Page = Invoke-WebRequest -Uri $PreviewUrl -UseBasicParsing -TimeoutSec 20
        $Cfg = Invoke-WebRequest -Uri ($PreviewUrl + "config.js") -UseBasicParsing -TimeoutSec 20
        if ($Page.StatusCode -eq 200 -and
            $Page.Content.Contains("lirep-login-shell") -and
            $Cfg.Content.Contains("hiidqmrgrioidvemixfe.supabase.co") -and
            $Cfg.Content.Contains("sb_publishable_")) {
            $PreviewPassed = $true
            break
        }
    } catch {
        Write-Host "Vista previa aun no disponible. Intento $Attempt/12"
    }
    Start-Sleep -Seconds 5
}

if (-not $PreviewPassed) {
    throw "Vista previa no verificada. Produccion no se modifica."
}

Write-Host "PASS | Vista previa HTTP 200 y configuracion validada"
Write-Host "VISTA PREVIA: $PreviewUrl"

if ($PreviewOnly) {
    Write-Host "QA303 PREVIEW ONLY: produccion intacta."
    return
}

# Segunda etapa: rama de produccion del proyecto Direct Upload.
Write-Host ""
Write-Host "Publicando LIREP ADMIN en rama $ProductionBranch..."
& $Npx --yes wrangler@4 pages deploy $Site --project-name $Project --branch $ProductionBranch
if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare no confirmo el despliegue de produccion."
}

$LiveUrl = "https://lirep-admin-360.pages.dev/"
$LivePassed = $false
for ($Attempt = 1; $Attempt -le 12; $Attempt++) {
    try {
        $Live = Invoke-WebRequest -Uri $LiveUrl -UseBasicParsing -TimeoutSec 20
        $LiveConfig = Invoke-WebRequest -Uri ($LiveUrl + "config.js") -UseBasicParsing -TimeoutSec 20
        if ($Live.StatusCode -eq 200 -and
            $Live.Content.Contains("lirep-login-shell") -and
            $LiveConfig.Content.Contains("hiidqmrgrioidvemixfe.supabase.co") -and
            $LiveConfig.Content.Contains("sb_publishable_")) {
            $LivePassed = $true
            break
        }
    } catch {
        Write-Host "Esperando propagacion de produccion: $Attempt/12"
    }
    Start-Sleep -Seconds 5
}

if (-not $LivePassed) {
    throw "No se confirmo el nuevo login en la URL principal. Revisar rama de produccion en Cloudflare."
}

$Health = Invoke-RestMethod -Uri "https://lirep-public-api.vidadecanes-peru.workers.dev/health" -TimeoutSec 20
$Backend = Invoke-RestMethod -Uri "https://lirep-public-api.vidadecanes-peru.workers.dev/health/backend" -TimeoutSec 20

if ($Health.ok -ne $true -or $Backend.connected -ne $true) {
    throw "El panel esta publicado pero la verificacion del Worker requiere revision."
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " LIREP | QA303 | CIERRE DE PUBLICACION PASS" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host "PASS | Login modernizado publicado"
Write-Host "PASS | Configuracion original de produccion"
Write-Host "PASS | Panel administrativo conservado"
Write-Host "PASS | Worker publico operativo"
Write-Host "PASS | Backend Supabase conectado"
Write-Host "PRODUCCION: $LiveUrl"
Write-Host "RESPALDO LOCAL: $ReleaseRoot"
Write-Host "SIN MODIFICACIONES SQL"
Write-Host "SIN CAMBIOS EN EL WORKER PUBLICO"
Write-Host "============================================"
