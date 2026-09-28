#Requires -Version 5.1
<#
.SYNOPSIS
    Auditoria y descarga de imagenes para Presentacion Guerra de Vietnam.

.DESCRIPTION
    Verifica JSON, assets locales y API de Wikimedia. Descarga las imagenes
    confirmadas a assets/img/wm/ para que imagenes.js las use como fallback
    local. Genera assets/json/imagenes-local.json con el manifiesto de
    archivos disponibles offline.

    Fases:
      1 - Analisis estatico del JSON
      2 - Verificacion de assets locales del proyecto
      3 - Verificacion en la API de Wikimedia (paralelo)
      4 - Descarga de imagenes confirmadas (paralelo, skip si ya existe)
      5 - Manifiesto + reportes

.PARAMETER JsonPath
    Ruta a imagenes.json. Default: ..\assets\json\imagenes.json

.PARAMETER LocalDir
    Directorio destino de las imagenes. Default: ..\assets\img\wm

.PARAMETER ManifestPath
    Ruta del manifiesto. Default: ..\assets\json\imagenes-local.json

.PARAMETER OutputDir
    Directorio de reportes. Default: directorio del script.

.PARAMETER ThrottleLimit
    Peticiones HTTP simultaneas. Default: 5.

.PARAMETER TimeoutSec
    Timeout por peticion. Default: 20.

.PARAMETER Width
    Ancho de las miniaturas descargadas. Default: 800 (coincide con thumbWidth del JS).

.PARAMETER SkipApi
    Omite la consulta a la API.

.PARAMETER SkipDownload
    No descarga imagenes, solo verifica.

.PARAMETER Force
    Fuerza re-descarga aunque el archivo local ya exista.

.PARAMETER OnlyMissing
    Solo muestra problemas.

.PARAMETER Quick
    Modo rapido: 10 imagenes al azar.

.PARAMETER UserAgent
    User-Agent para peticiones a Wikimedia.

.EXAMPLE
    .\revision.ps1
    Auditoria completa + descarga de faltantes.

.EXAMPLE
    .\revision.ps1 -SkipApi -SkipDownload
    Solo verifica estructura del JSON y assets.

.EXAMPLE
    .\revision.ps1 -Force -ThrottleLimit 8
    Fuerza re-descarga con mas concurrencia.
#>

[CmdletBinding()]
param(
    [string]$JsonPath     = (Join-Path $PSScriptRoot '..\assets\json\imagenes.json'),
    [string]$LocalDir     = (Join-Path $PSScriptRoot '..\assets\img\wm'),
    [string]$ManifestPath = (Join-Path $PSScriptRoot '..\assets\json\imagenes-local.json'),
    [string]$OutputDir    = $PSScriptRoot,
    [int]$ThrottleLimit   = 5,
    [int]$TimeoutSec      = 20,
    [int]$Width           = 800,
    [switch]$SkipApi,
    [switch]$SkipDownload,
    [switch]$Force,
    [switch]$OnlyMissing,
    [switch]$Quick,
    [string]$UserAgent = 'VietnamAuditBot/1.0 (+https://example.com/contact)'
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
$script:StartTime      = Get-Date

Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue

$ProjectRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LocalDir     = [System.IO.Path]::GetFullPath($LocalDir)
$ManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)
$OutputDir    = [System.IO.Path]::GetFullPath($OutputDir)

$ApiBase  = 'https://commons.wikimedia.org/w/api.php'
$FilePath = 'https://commons.wikimedia.org/wiki/Special:FilePath/'

$ValidLicenses = @(
    'PD','CC0',
    'CC-BY','CC-BY-2.0','CC-BY-2.5','CC-BY-3.0','CC-BY-4.0',
    'CC-BY-SA','CC-BY-SA-2.0','CC-BY-SA-3.0','CC-BY-SA-4.0'
)

# ==================================================================
#   HELPERS
# ==================================================================
function Write-Banner {
    param([string]$Text, [ConsoleColor]$Color = 'Cyan')
    $line = '=' * 66
    Write-Host ""
    Write-Host $line -ForegroundColor $Color
    Write-Host "  $Text" -ForegroundColor $Color
    Write-Host $line -ForegroundColor $Color
}
function Write-Step { param([string]$T) Write-Host "  -> " -ForegroundColor DarkCyan -NoNewline; Write-Host $T -ForegroundColor White }
function Write-Ok   { param([string]$T) Write-Host "  [OK]  $T" -ForegroundColor Green }
function Write-Warn { param([string]$T) Write-Host "  [!!]  $T" -ForegroundColor Yellow }
function Write-Err  { param([string]$T) Write-Host "  [XX]  $T" -ForegroundColor Red }
function Write-Info { param([string]$T) Write-Host "  [i]   $T" -ForegroundColor Gray }

function Encode-Filename {
    param([string]$Name)
    $e = [uri]::EscapeDataString($Name)
    return $e -replace '%2C', ',' -replace '%28', '(' -replace '%29', ')'
}

function Get-Chunks {
    param([array]$Items, [int]$Size)
    if (-not $Items -or $Items.Count -eq 0) { return @() }
    $out = @()
    for ($i = 0; $i -lt $Items.Count; $i += $Size) {
        $end = [Math]::Min($i + $Size - 1, $Items.Count - 1)
        $out += ,@($Items[$i..$end])
    }
    return $out
}

function New-HttpClient {
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $true
    $handler.MaxAutomaticRedirections = 5
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd($UserAgent) | Out-Null
    return $client
}

function Wait-Tasks {
    param([array]$Tasks)
    if (-not $Tasks -or $Tasks.Count -eq 0) { return }
    try {
        [System.Threading.Tasks.Task]::WhenAll([System.Threading.Tasks.Task[]]$Tasks) | Out-Null
    } catch {}
    foreach ($t in $Tasks) {
        if ($t.IsFaulted) { $null = $t.Exception }
    }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ==================================================================
#   CABECERA
# ==================================================================
Write-Banner "AUDITORIA + DESCARGA - GUERRA DE VIETNAM"
Write-Info "Inicio:        $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Info "Proyecto:      $ProjectRoot"
Write-Info "JSON:          $JsonPath"
Write-Info "Destino:       $LocalDir"
Write-Info "Manifiesto:    $ManifestPath"
Write-Info "Throttle:      $ThrottleLimit"
Write-Info "Timeout:       ${TimeoutSec}s"
Write-Info "Width:         ${Width}px"
Write-Info "PSVersion:     $($PSVersionTable.PSVersion)"

if (-not (Test-Path $JsonPath)) { Write-Err "No existe JSON: $JsonPath"; exit 1 }
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }
if (-not (Test-Path $LocalDir)) { New-Item -ItemType Directory -Path $LocalDir -Force | Out-Null }

# ==================================================================
#   FASE 1 - JSON
# ==================================================================
Write-Banner "FASE 1 - Analisis del JSON"

try {
    $rawJson = Get-Content -Path $JsonPath -Raw -Encoding UTF8
    $data    = $rawJson | ConvertFrom-Json
} catch {
    Write-Err "JSON invalido: $($_.Exception.Message)"
    exit 2
}

$imagenes = @($data.imagenes)
Write-Step "Entradas: $($imagenes.Count)"

if ($data.meta) {
    Write-Info "meta.version:  $($data.meta.version)"
    Write-Info "meta.total:    $($data.meta.total)"
    if ($data.meta.total -ne $imagenes.Count) {
        Write-Warn "meta.total ($($data.meta.total)) != count real ($($imagenes.Count))"
    }
}

$fieldErrors = @(); $licenseFails = @(); $yearFails = @()
$idDuplicates = @{}; $fileDups = @{}; $byId = @{}

foreach ($img in $imagenes) {
    foreach ($f in @('id','titulo','archivo','anio','credito','licencia','pagina')) {
        if ([string]::IsNullOrWhiteSpace($img.$f)) {
            $fieldErrors += [PSCustomObject]@{ id = $img.id; campo = $f }
        }
    }
    if ($img.licencia -and ($ValidLicenses -notcontains $img.licencia)) {
        $licenseFails += [PSCustomObject]@{ id = $img.id; licencia = $img.licencia }
    }
    if ($img.anio) {
        $n = 0
        if (-not [int]::TryParse([string]$img.anio, [ref]$n)) {
            $yearFails += [PSCustomObject]@{ id = $img.id; anio = $img.anio; motivo = 'no numerico' }
        } elseif ($n -lt 1940 -or $n -gt 2026) {
            $yearFails += [PSCustomObject]@{ id = $img.id; anio = $img.anio; motivo = 'fuera de rango' }
        }
    }
    if ($img.id) {
        if ($byId.ContainsKey($img.id)) {
            if (-not $idDuplicates.ContainsKey($img.id)) { $idDuplicates[$img.id] = 0 }
            $idDuplicates[$img.id]++
        } else { $byId[$img.id] = $img }
    }
    if ($img.archivo) {
        if ($fileDups.ContainsKey($img.archivo)) { $fileDups[$img.archivo]++ }
        else { $fileDups[$img.archivo] = 1 }
    }
}
$fileDupsCount = (@($fileDups.GetEnumerator() | Where-Object { $_.Value -gt 1 })).Count

Write-Step "IDs unicos:          $($byId.Count) / $($imagenes.Count)"
Write-Step "Campos faltantes:    $($fieldErrors.Count)"
Write-Step "Licencias invalidas: $($licenseFails.Count)"
Write-Step "Anios invalidos:     $($yearFails.Count)"
Write-Step "IDs duplicados:      $($idDuplicates.Count)"
Write-Step "Archivos repetidos:  $fileDupsCount"

$byLicense = $imagenes | Group-Object licencia | Sort-Object Count -Descending
$allTags   = @()
foreach ($img in $imagenes) { if ($img.tags) { $allTags += $img.tags } }
$byTag = $allTags | Group-Object | Sort-Object Count -Descending

# ==================================================================
#   FASE 2 - ASSETS LOCALES
# ==================================================================
Write-Banner "FASE 2 - Assets locales del proyecto"

$localAssets = @(
    'index.html','creditos.html','.nojekyll',
    'assets/css/index.css','assets/css/sidebar.css','assets/css/contenido.css',
    'assets/css/imagenes.css','assets/css/footer.css','assets/css/creditos.css',
    'assets/js/utils.js','assets/js/imagenes.js','assets/js/animaciones.js',
    'assets/js/index.js','assets/js/creditos.js','assets/js/bootstrap.js',
    'assets/json/imagenes.json',
    'assets/img/logo.png','assets/img/favicon.png','assets/img/qr-subweb.png'
)
$localResults = @()
foreach ($rel in $localAssets) {
    $full   = Join-Path $ProjectRoot $rel
    $exists = Test-Path $full
    $size   = if ($exists) { (Get-Item $full).Length } else { 0 }
    $localResults += [PSCustomObject]@{ Asset=$rel; Exists=$exists; Size=$size }
    if ($exists) { Write-Ok "$rel ($([math]::Round($size/1KB,1)) KB)" }
    else { Write-Err "$rel - NO EXISTE" }
}
$missingLocal = @($localResults | Where-Object { -not $_.Exists })
Write-Step "Assets OK: $($localResults.Count - $missingLocal.Count) / $($localResults.Count)"

# ==================================================================
#   FASE 3 - API (paralelo)
# ==================================================================
Write-Banner "FASE 3 - Verificacion en la API de Wikimedia"

$apiByFile = @{}

if (-not $SkipApi) {
    $targets = $imagenes
    if ($Quick) {
        $targets = @($imagenes | Get-Random -Count ([Math]::Min(10, $imagenes.Count)))
        Write-Info "Quick: procesando $($targets.Count) imagenes al azar"
    }

    $batchSize = 20
    $batches = @()
    for ($i = 0; $i -lt $targets.Count; $i += $batchSize) {
        $end = [Math]::Min($i + $batchSize - 1, $targets.Count - 1)
        $batches += ,@($targets[$i..$end])
    }
    Write-Info "Consultando $($batches.Count) lotes de hasta $batchSize titulos..."

    $client = New-HttpClient
    $batchChunks = Get-Chunks -Items $batches -Size $ThrottleLimit
    $batchNum = 0

    foreach ($chunk in $batchChunks) {
        $jobs = @()
        foreach ($batch in $chunk) {
            $titles = ($batch | ForEach-Object { "File:$($_.archivo)" }) -join '|'
            $apiUrl = "$ApiBase" +
                      "?action=query&format=json&prop=imageinfo" +
                      "&iiprop=url|size|mime|extmetadata" +
                      "&iiurlwidth=$Width&redirects=1" +
                      "&titles=$([uri]::EscapeDataString($titles))"
            $jobs += [PSCustomObject]@{ Task = $client.GetStringAsync($apiUrl); Batch = $batch }
        }
        Wait-Tasks -Tasks ($jobs | ForEach-Object { $_.Task })

        foreach ($j in $jobs) {
            $batchNum++
            try {
                if (-not $j.Task.IsCompletedSuccessfully) {
                    Write-Warn "Lote $batchNum/$($batches.Count) fallo: $($j.Task.Exception.GetBaseException().Message)"
                    continue
                }
                $resp = $j.Task.Result | ConvertFrom-Json
                $pages = $resp.query.pages
                if (-not $pages) { continue }

                # Mapeo de normalizados y redirects
                $normMap = @{}
                if ($resp.query.normalized) {
                    foreach ($n in $resp.query.normalized) {
                        $from = ($n.from -replace '^File:', '') -replace '_', ' '
                        $to   = ($n.to   -replace '^File:', '') -replace '_', ' '
                        $normMap[$to] = $from
                    }
                }
                if ($resp.query.redirects) {
                    foreach ($r in $resp.query.redirects) {
                        $from = ($r.from -replace '^File:', '') -replace '_', ' '
                        $to   = ($r.to   -replace '^File:', '') -replace '_', ' '
                        $orig = if ($normMap.ContainsKey($from)) { $normMap[$from] } else { $from }
                        $normMap[$to] = $orig
                    }
                }

                foreach ($pageId in $pages.PSObject.Properties.Name) {
                    $page = $pages.$pageId
                    if (-not $page) { continue }
                    $apiTitle = ($page.title -replace '^File:', '') -replace '_', ' '

                    # Ubicar el archivo original
                    $origFile = $null
                    foreach ($b in $j.Batch) {
                        $bn = $b.archivo -replace '_', ' '
                        if ($bn -eq $apiTitle -or $normMap[$apiTitle] -eq $bn) { $origFile = $b.archivo; break }
                    }
                    if (-not $origFile) {
                        # Fallback: usar el normalizado
                        $origFile = if ($normMap.ContainsKey($apiTitle)) { $normMap[$apiTitle] } else { $apiTitle }
                    }

                    $isMissing = ($page.PSObject.Properties['missing'] -ne $null)
                    $infoArr = $page.imageinfo
                    if ($isMissing -or -not $infoArr -or @($infoArr).Count -eq 0) {
                        $apiByFile[$origFile] = [PSCustomObject]@{
                            Exists=$false; Thumb=''; Full=''; Mime=''; Size=0; License=''
                        }
                        continue
                    }

                    $info = @($infoArr)[0]
                    $lic = ''
                    try {
                        if ($info.extmetadata -and $info.extmetadata.LicenseShortName) {
                            $lic = [string]$info.extmetadata.LicenseShortName.value
                        }
                    } catch {}

                    $apiByFile[$origFile] = [PSCustomObject]@{
                        Exists  = $true
                        Thumb   = [string]$info.thumburl
                        Full    = [string]$info.url
                        Mime    = [string]$info.mime
                        Size    = [int]$info.size
                        License = $lic
                    }
                }
            } catch {
                Write-Warn "Error procesando lote: $($_.Exception.Message)"
            }
        }
        Write-Host "      - Lotes: $batchNum/$($batches.Count)" -ForegroundColor DarkGray
    }
    $client.Dispose()

    $apiOk      = (@($apiByFile.Values | Where-Object { $_.Exists })).Count
    $apiMissing = (@($apiByFile.Values | Where-Object { -not $_.Exists })).Count
    Write-Step "Existen en API:    $apiOk / $($apiByFile.Count)"
    Write-Step "No existen:        $apiMissing"
} else {
    Write-Info "Fase omitida (-SkipApi)"
}

# ==================================================================
#   FASE 4 - DESCARGA (paralelo)
# ==================================================================
Write-Banner "FASE 4 - Descarga de imagenes"

$downloadResults = @()

if ($SkipDownload) {
    Write-Info "Fase omitida (-SkipDownload)"
} else {
    # Preparar lista
    $toDownload = @()
    foreach ($img in $imagenes) {
        $dest = Join-Path $LocalDir $img.archivo
        $existsLocal = Test-Path $dest
        $apiInfo = if ($apiByFile.ContainsKey($img.archivo)) { $apiByFile[$img.archivo] } else { $null }

        if ($apiInfo -and -not $apiInfo.Exists) {
            $downloadResults += [PSCustomObject]@{
                id=$img.id; archivo=$img.archivo; status='MISSING_API';
                local=$existsLocal; size=0; error=''
            }
            if (-not $OnlyMissing) {
                Write-Host "  [404] $($img.id) - $($img.archivo)" -ForegroundColor Red
            }
            continue
        }

        if ($existsLocal -and -not $Force) {
            $sz = (Get-Item $dest).Length
            $downloadResults += [PSCustomObject]@{
                id=$img.id; archivo=$img.archivo; status='SKIP_EXISTS';
                local=$true; size=$sz; error=''
            }
            if (-not $OnlyMissing) {
                Write-Host "  [==]  $($img.id) - $($img.archivo) ($([math]::Round($sz/1KB,1)) KB)" -ForegroundColor DarkGray
            }
            continue
        }

        $dlUrl = if ($apiInfo -and $apiInfo.Thumb) { $apiInfo.Thumb }
                 else { "${FilePath}$(Encode-Filename $img.archivo)?width=$Width" }

        $toDownload += [PSCustomObject]@{ Item=$img; Dest=$dest; Url=$dlUrl }
    }

    $skipCount = @($downloadResults | Where-Object { $_.status -eq 'SKIP_EXISTS' }).Count
    $missCount = @($downloadResults | Where-Object { $_.status -eq 'MISSING_API' }).Count
    Write-Info "Pendientes: $($toDownload.Count)  |  Ya locales: $skipCount  |  Sin archivo: $missCount"

    if ($toDownload.Count -gt 0) {
        $client = New-HttpClient
        $chunks = Get-Chunks -Items $toDownload -Size $ThrottleLimit
        $done = 0
        $total = $toDownload.Count

        foreach ($chunk in $chunks) {
            $jobs = @()
            foreach ($job in $chunk) {
                $jobs += [PSCustomObject]@{
                    Job  = $job
                    Task = $client.GetAsync($job.Url, [System.Net.Http.HttpCompletionOption]::ResponseContentRead)
                }
            }
            Wait-Tasks -Tasks ($jobs | ForEach-Object { $_.Task })

            foreach ($j in $jobs) {
                $done++
                $job = $j.Job
                $status = 'OK'; $errorMsg = ''; $bytes = 0

                try {
                    if (-not $j.Task.IsCompletedSuccessfully) {
                        throw $j.Task.Exception.GetBaseException()
                    }
                    $resp = $j.Task.Result
                    if (-not $resp.IsSuccessStatusCode) {
                        throw "HTTP $([int]$resp.StatusCode)"
                    }
                    $ct = if ($resp.Content.Headers.ContentType) { $resp.Content.Headers.ContentType.MediaType } else { '' }
                    if ($ct -notlike 'image/*') {
                        throw "Content-Type no es imagen: $ct"
                    }
                    $bytesArr = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                    if (-not $bytesArr -or $bytesArr.Length -lt 200) {
                        throw "Respuesta muy chica ($($bytesArr.Length) bytes)"
                    }
                    [System.IO.File]::WriteAllBytes($job.Dest, $bytesArr)
                    $bytes = $bytesArr.Length
                    $resp.Dispose()
                } catch {
                    $status = 'ERROR'
                    $errorMsg = $_.Exception.Message
                }

                $downloadResults += [PSCustomObject]@{
                    id=$job.Item.id; archivo=$job.Item.archivo; status=$status;
                    local=(Test-Path $job.Dest); size=$bytes; error=$errorMsg
                }

                if ($status -eq 'OK') {
                    if (-not $OnlyMissing) {
                        Write-Host ("  [OK]  {0} - {1} ({2} KB)" -f `
                            $job.Item.id, $job.Item.archivo, [math]::Round($bytes/1KB,1)) -ForegroundColor Green
                    }
                } else {
                    Write-Host ("  [XX]  {0} - {1} : {2}" -f `
                        $job.Item.id, $job.Item.archivo, $errorMsg) -ForegroundColor Red
                }
            }

            Write-Progress -Activity "Descargando" `
                           -Status "$done / $total" `
                           -PercentComplete ([math]::Round(($done / $total) * 100, 1))
        }
        Write-Progress -Activity "Descargando" -Completed
        $client.Dispose()
    }
}

# ==================================================================
#   FASE 5 - MANIFIESTO + REPORTES
# ==================================================================
Write-Banner "FASE 5 - Manifiesto y reportes"

$localFiles = @()
$localTotalBytes = 0
if (Test-Path $LocalDir) {
    Get-ChildItem -Path $LocalDir -File | ForEach-Object {
        $localFiles += $_.Name
        $localTotalBytes += $_.Length
    }
}
$localFiles = @($localFiles | Sort-Object)

$manifest = [PSCustomObject]@{
    generated = (Get-Date).ToString('o')
    source    = 'Wikimedia Commons'
    width     = $Width
    total     = $localFiles.Count
    bytes     = $localTotalBytes
    files     = $localFiles
}

$manifestDir = Split-Path $ManifestPath -Parent
if (-not (Test-Path $manifestDir)) { New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null }
[System.IO.File]::WriteAllText($ManifestPath, ($manifest | ConvertTo-Json -Depth 5), $utf8NoBom)
Write-Ok "Manifiesto: $ManifestPath ($($localFiles.Count) archivos, $([math]::Round($localTotalBytes/1MB,2)) MB)"

$elapsed = (Get-Date) - $script:StartTime

$dlOk      = (@($downloadResults | Where-Object { $_.status -eq 'OK' })).Count
$dlSkip    = (@($downloadResults | Where-Object { $_.status -eq 'SKIP_EXISTS' })).Count
$dlErr     = (@($downloadResults | Where-Object { $_.status -eq 'ERROR' })).Count
$dlMissing = (@($downloadResults | Where-Object { $_.status -eq 'MISSING_API' })).Count

$apiOkCount      = if ($apiByFile.Count -gt 0) { (@($apiByFile.Values | Where-Object { $_.Exists })).Count } else { $null }
$apiMissingCount = if ($apiByFile.Count -gt 0) { (@($apiByFile.Values | Where-Object { -not $_.Exists })).Count } else { $null }

$summary = [PSCustomObject]@{
    timestamp           = (Get-Date).ToString('o')
    project_root        = $ProjectRoot
    json_path           = $JsonPath
    local_dir           = $LocalDir
    manifest_path       = $ManifestPath
    duracion_seg        = [math]::Round($elapsed.TotalSeconds, 1)
    total_json          = $imagenes.Count
    total_unicos        = $byId.Count
    campos_faltantes    = $fieldErrors.Count
    licencias_invalidas = $licenseFails.Count
    anios_invalidos     = $yearFails.Count
    ids_duplicados      = $idDuplicates.Count
    archivos_repetidos  = $fileDupsCount
    api_ok              = $apiOkCount
    api_missing         = $apiMissingCount
    descargas_ok        = $dlOk
    descargas_skip      = $dlSkip
    descargas_error     = $dlErr
    descargas_missing   = $dlMissing
    locales_total       = $localFiles.Count
    locales_bytes       = $localTotalBytes
    assets_locales_ok   = (@($localResults | Where-Object { $_.Exists })).Count
    assets_locales_miss = $missingLocal.Count
}

Write-Host ""
Write-Host "  --------------- RESUMEN FINAL ---------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Duracion:               " -NoNewline -ForegroundColor Gray
Write-Host "$($summary.duracion_seg)s" -ForegroundColor White

Write-Host "  Entradas en JSON:       " -NoNewline -ForegroundColor Gray
Write-Host "$($summary.total_json)" -ForegroundColor White

Write-Host "  Assets del proyecto:    " -NoNewline -ForegroundColor Gray
if ($summary.assets_locales_miss -eq 0) {
    Write-Host "$($summary.assets_locales_ok) / $($summary.assets_locales_ok)" -ForegroundColor Green
} else {
    Write-Host "$($summary.assets_locales_ok) / $($summary.assets_locales_ok + $summary.assets_locales_miss)" -ForegroundColor Yellow
}

if ($apiByFile.Count -gt 0) {
    Write-Host "  API Wikimedia:          " -NoNewline -ForegroundColor Gray
    $apiColor = if ($summary.api_missing -eq 0) { 'Green' } else { 'Yellow' }
    Write-Host "$($summary.api_ok) OK / $($summary.api_missing) MISSING" -ForegroundColor $apiColor
}

if (-not $SkipDownload) {
    Write-Host "  Descargas:              " -NoNewline -ForegroundColor Gray
    $dColor = if ($dlErr -eq 0) { 'Green' } else { 'Yellow' }
    Write-Host "$dlOk OK | $dlSkip ya existian | $dlErr error | $dlMissing sin archivo" -ForegroundColor $dColor
    Write-Host "  Imagenes locales:       " -NoNewline -ForegroundColor Gray
    Write-Host "$($localFiles.Count) archivos, $([math]::Round($localTotalBytes/1MB,2)) MB" -ForegroundColor White
}

# Reportes
$ts         = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportBase = Join-Path $OutputDir "revision-$ts"

$fullReport = [PSCustomObject]@{
    summary         = $summary
    fieldErrors     = $fieldErrors
    licenseFails    = $licenseFails
    yearFails       = $yearFails
    idDuplicates    = $idDuplicates
    fileDups        = $fileDups
    localAssets     = $localResults
    apiResults      = $apiByFile
    downloadResults = $downloadResults
    byLicense       = $byLicense
    byTag           = $byTag
}
[System.IO.File]::WriteAllText("$reportBase.json", ($fullReport | ConvertTo-Json -Depth 10), $utf8NoBom)
Write-Ok "Reporte JSON:   $reportBase.json"

if ($downloadResults.Count -gt 0) {
    $downloadResults | Export-Csv -Path "$reportBase-download.csv" -NoTypeInformation -Encoding UTF8
    Write-Ok "CSV descargas:  $reportBase-download.csv"
}

$problems = @($downloadResults | Where-Object { $_.status -in @('ERROR','MISSING_API') })
if ($problems.Count -gt 0) {
    $problems | Export-Csv -Path "$reportBase-problems.csv" -NoTypeInformation -Encoding UTF8
    Write-Ok "CSV problemas:  $reportBase-problems.csv ($($problems.Count))"
}

Write-Host ""
Write-Banner "AUDITORIA COMPLETADA EN $($summary.duracion_seg)s"

if ($dlErr -gt 0 -or $dlMissing -gt 0 -or $missingLocal.Count -gt 0) {
    Write-Host ""
    Write-Host "  Acciones sugeridas:" -ForegroundColor Yellow
    if ($dlMissing -gt 0) { Write-Host "    - $dlMissing imagenes no existen en Wikimedia (revisar nombres en JSON)." -ForegroundColor Gray }
    if ($dlErr -gt 0)     { Write-Host "    - $dlErr errores de red. Reintentar: .\revision.ps1 (solo descarga faltantes)." -ForegroundColor Gray }
    if ($missingLocal.Count -gt 0) {
        Write-Host "    - Crear assets faltantes:" -ForegroundColor Gray
        foreach ($l in $missingLocal) { Write-Host "        -> $($l.Asset)" -ForegroundColor DarkGray }
    }
} else {
    Write-Host ""
    Write-Host "  [OK] Todo correcto." -ForegroundColor Green
}

exit 0