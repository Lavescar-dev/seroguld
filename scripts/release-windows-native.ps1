[CmdletBinding()]
param(
  [switch]$Finalize,
  [switch]$SkipRuntime,
  [switch]$SkipFrontend,
  [switch]$SkipTauri,
  [switch]$RunDefenderScan,
  [string]$Root = "",
  [string]$OutputDirectory = "",
  [string]$RuntimeBuildDirectory = ""
)

$ErrorActionPreference = "Stop"
$BuildStarted = Get-Date
$scriptDirectory = if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
  Split-Path -Parent $MyInvocation.MyCommand.Path
} else { $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Join-Path $scriptDirectory ".."
}
$Root = (Resolve-Path -LiteralPath $Root).ProviderPath
$ReleaseWork = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  Join-Path $Root ".run\windows-native-release"
} elseif (Test-Path -LiteralPath $OutputDirectory) {
  (Resolve-Path -LiteralPath $OutputDirectory).ProviderPath
} else {
  [System.IO.Path]::GetFullPath($OutputDirectory)
}
$NsisOutput = Join-Path $ReleaseWork "SERO-GULD-CRM-FULL-SETUP.exe"
$ManifestPath = Join-Path $ReleaseWork "release-manifest.json"
$DefenderScanStatus = "not-run"
$DefenderScanStartedAt = $null
$DefenderScanFinishedAt = $null
$DefenderScanTool = $null
$DefenderScanThreatCount = 0
$script:ArtifactChecks = [ordered]@{}
$ProductVersion = "0.3.23"
$CustomerRuntimeSeedRelativePath = "runtime\seroguld-runtime\runtime-seed.env"

function Get-CustomerRuntimeSeedAllowedKeys {
  return @(
    "KDS_ADDRESS_BASE_URL", "KDS_ADDRESS_TOKEN", "KDS_ADDRESS_TIMEOUT_SECONDS", "KDS_ADDRESS_CACHE_SECONDS",
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT", "OPENAI_MAX_TOKENS", "OPENAI_TIMEOUT_SECONDS",
    "OPMC_API_URL", "OPMC_API_KEY", "OPMC_WEBHOOK_SECRET",
    "WOOCOMMERCE_BASE_URL", "WOOCOMMERCE_CONSUMER_KEY", "WOOCOMMERCE_CONSUMER_SECRET",
    "WOOCOMMERCE_WEBHOOK_SECRET", "WOOCOMMERCE_TIMEOUT_SECONDS", "WORDPRESS_BASE_URL", "WP_APP_USERNAME", "WP_APP_PASSWORD",
    "WOOCOMMERCE_CATEGORY_MAP_JSON", "WOOCOMMERCE_STONEX_META_MAP_JSON", "WOOCOMMERCE_BADGE_META_JSON",
    "WOOCOMMERCE_DESC_FOOTER_HTML", "WOOCOMMERCE_DESC_FOOTER_ENABLED", "WOOCOMMERCE_PRIMARY_TERM_META_KEY",
    "UNICONTA_API_URL", "UNICONTA_USERNAME", "UNICONTA_PASSWORD", "UNICONTA_COMPANY_ID", "UNICONTA_API_KEY",
    "UNICONTA_PURCHASE_VAT_CODE_25", "UNICONTA_PURCHASE_VAT_CODE_0",
    "UNICONTA_SEND_EMAIL_ON_FINALIZE", "UNICONTA_SEND_XML_ON_FINALIZE",
    "INVOICE_NUMBER_PREFIX", "INVOICE_DEFAULT_CURRENCY", "INVOICE_SALE_VAT_RATE_PERCENT", "INVOICE_SELLER_NAME",
    "INVOICE_SELLER_ADDRESS_LINE1", "INVOICE_SELLER_POSTAL_CODE", "INVOICE_SELLER_CITY", "INVOICE_SELLER_COUNTRY",
    "INVOICE_SELLER_CVR", "INVOICE_SELLER_EMAIL", "INVOICE_SELLER_PHONE", "INVOICE_SELLER_WEBSITE", "POS_REFERENCE_START", "POS_REFERENCE_SCAN_WINDOW",
    "MARKET_RATES_LIVE_ENABLED", "MARKET_RATES_LIVE_FX_ENABLED", "MARKET_RATES_LIVE_PLATINUM_ENABLED", "MARKET_RATES_LIVE_PALLADIUM_ENABLED", "GOLD_PRICE_LIVE_ENABLED", "GOLD_PRICE_TIMEOUT_SECONDS", "GOLD_PRICE_CACHE_SECONDS",
    "INVENTORY_MARKET_GOLD_DKK", "INVENTORY_MARKET_SILVER_DKK", "INVENTORY_MARKET_PLATINUM_DKK",
    "INVENTORY_MARKET_PALLADIUM_DKK", "INVENTORY_MARKET_GOLD_BAR_DKK", "INVENTORY_MARKET_SILVER_BAR_DKK",
    "INVENTORY_MARKET_PLET_DKK", "INVENTORY_MARKET_RATE_PROFILE_JSON",
    "METALS_DEV_API_KEY", "METALS_DEV_URL", "METALS_DEV_TIMEOUT_SECONDS", "METALS_DEV_CACHE_SECONDS",
    "ECB_FX_URL", "ECB_FX_TIMEOUT_SECONDS", "ECB_FX_CACHE_SECONDS",
    "STOOQ_SYMBOL_PLATINUM", "STOOQ_SYMBOL_PALLADIUM"
  )
}

function Get-CustomerRuntimeSeedRequiredKeys {
  return @(
    "WOOCOMMERCE_BASE_URL", "WOOCOMMERCE_CONSUMER_KEY", "WOOCOMMERCE_CONSUMER_SECRET",
    "WORDPRESS_BASE_URL", "WP_APP_USERNAME", "WP_APP_PASSWORD",
    "UNICONTA_API_URL", "UNICONTA_USERNAME", "UNICONTA_PASSWORD", "UNICONTA_COMPANY_ID", "UNICONTA_API_KEY"
  )
}

function Assert-CustomerRuntimeSeed {
  param([Parameter(Mandatory = $true)][string]$Path)
  $allowed = @(Get-CustomerRuntimeSeedAllowedKeys)
  $seen = @{}
  foreach ($line in @(Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction Stop)) {
    $trimmed = ([string]$line).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) { continue }
    if ($line -cnotmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { throw "Installer customer runtime seed satırı geçersiz" }
    $key = [string]$Matches[1]
    $value = [string]$Matches[2]
    if ($allowed -cnotcontains $key) { throw "Installer customer runtime seed izin verilmeyen anahtar içeriyor: $key" }
    if ($seen.ContainsKey($key)) { throw "Installer customer runtime seed yinelenen anahtar içeriyor: $key" }
    if ([string]::IsNullOrWhiteSpace($value)) { throw "Installer customer runtime seed boş değer içeriyor: $key" }
    $seen[$key] = $true
  }
  $missingRequired = @(Get-CustomerRuntimeSeedRequiredKeys | Where-Object { -not $seen.ContainsKey($_) })
  if ($missingRequired.Count -gt 0) {
    throw "Installer customer runtime seed zorunlu entegrasyon anahtarları eksik: $($missingRequired -join ', ')"
  }
  return @($seen.Keys | Sort-Object)
}

function Test-FilesByteEqual {
  param(
    [Parameter(Mandatory = $true)][string]$FirstPath,
    [Parameter(Mandatory = $true)][string]$SecondPath
  )
  $first = [System.IO.File]::ReadAllBytes($FirstPath)
  $second = [System.IO.File]::ReadAllBytes($SecondPath)
  if ($first.Length -ne $second.Length) { return $false }
  for ($index = 0; $index -lt $first.Length; $index++) {
    if ($first[$index] -ne $second[$index]) { return $false }
  }
  return $true
}

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory = $Root)
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Release komutu başarısız oldu: $Command" }
  } finally {
    Pop-Location
  }
}

function Get-TextSha256 {
  param([AllowEmptyString()][string]$Text)
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose() }
}

function Assert-FreeSpace {
  param([string]$Path, [int64]$RequiredBytes, [string]$Purpose)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($rootPath) -or $rootPath.StartsWith('\\')) { return }
  $drive = [System.IO.DriveInfo]::new($rootPath)
  if ($drive.AvailableFreeSpace -lt $RequiredBytes) {
    $requiredMiB = [math]::Ceiling($RequiredBytes / 1MB)
    $availableMiB = [math]::Floor($drive.AvailableFreeSpace / 1MB)
    throw "$Purpose için disk alanı yetersiz: gerekli ${requiredMiB} MiB, boş ${availableMiB} MiB"
  }
}

function Get-SourceHead {
  $output = Invoke-ReleaseGit @('rev-parse', 'HEAD')
  $head = (($output -join "`n").Trim())
  if ([string]::IsNullOrWhiteSpace($head)) { throw "Git provenance bilgisi okunamadı" }
  return $head
}

function Invoke-ReleaseGit {
  param([string[]]$Arguments)
  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($null -ne $git) {
    $output = & $git.Source -C $Root @Arguments 2>$null
  } else {
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if ($null -eq $wsl) { throw "Git provenance aracı bulunamadı" }
    $output = & $wsl.Source --cd $Root git @Arguments 2>$null
  }
  if ($LASTEXITCODE -ne 0) { throw "Git provenance bilgisi okunamadı" }
  return $output
}

function Test-ReleaseSourcePath {
  param([string]$RelativePath)
  $normalized = ([string]$RelativePath).Replace('\', '/').TrimStart('./')
  if ([string]::IsNullOrWhiteSpace($normalized)) { return $false }
  if ($normalized -match '(^|/)(node_modules|target|\.run)(/|$)') { return $false }
  if ($normalized -match '^desktop/src-tauri/runtime(/|$)') { return $false }
  if ($normalized -match '(^|/)(dist|build|playwright-report|test-results)(/|$)') { return $false }
  if ($normalized -match '(^|/)(__pycache__|\.pytest_cache|\.mypy_cache)(/|$)') { return $false }
  if ($normalized -match '\.pyc$' -or $normalized -match '(^|/)\.vitest-results[^/]*$') { return $false }
  if ($normalized -match '(^|/)backend/(gate-[^/]+|sql-c)\.db(-wal|-shm)?$') { return $false }
  if ($normalized -eq 'backend/runtime-seed.env') { return $false }
  if ($normalized -eq 'NUL') { return $false }
  return $true
}

function Assert-SourceManifestMatchesCurrentTree {
  param([object]$SourceManifest)
  $tracked = Invoke-ReleaseGit @('diff', '--name-only', '--no-ext-diff', 'HEAD')
  $untrackedRaw = Invoke-ReleaseGit @('ls-files', '--others', '--exclude-standard')
  $currentPaths = @($tracked + $untrackedRaw |
      ForEach-Object { [string]$_ } |
      Where-Object { Test-ReleaseSourcePath $_ } |
      Sort-Object -Unique)
  $manifestProperties = @($SourceManifest.files.PSObject.Properties | Sort-Object Name)
  $manifestPaths = @($manifestProperties | ForEach-Object { $_.Name })
  if (($currentPaths -join "`n") -ne ($manifestPaths -join "`n") -or
      [int]$SourceManifest.source_file_count -ne $currentPaths.Count) {
    throw "Runtime kaynak fingerprint dosya listesi mevcut release ağacıyla eşleşmiyor"
  }

  $currentHashes = [ordered]@{}
  foreach ($relative in $currentPaths) {
    $path = Join-Path $Root ($relative -replace '/', '\')
    $value = if (Test-Path -LiteralPath $path -PathType Leaf) {
      (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    } else { 'deleted' }
    $expected = [string]$SourceManifest.files.PSObject.Properties[$relative].Value
    if ($value -ne $expected) { throw "Runtime kaynak fingerprint içeriği değişmiş: $relative" }
    $currentHashes[$relative] = $value
  }
  $hashLines = @($currentHashes.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
  $status = @($currentHashes.GetEnumerator() | ForEach-Object {
      $state = if ($_.Value -eq 'deleted') { 'deleted' } else { 'present' }
      "$state $($_.Key)"
    }) -join "`n"
  # Keep native command invocation and `-join` separate. In Windows
  # PowerShell, placing both inside one expression can parse `-join` as part
  # of the command invocation and hash the string-array type instead of the
  # actual diff text.
  $diffOutput = Invoke-ReleaseGit @('diff', '--no-ext-diff', '--binary', 'HEAD')
  $diff = (($diffOutput -join "`n").Trim())
  $untracked = @($untrackedRaw |
      ForEach-Object { [string]$_ } |
      Where-Object { Test-ReleaseSourcePath $_ } |
      Sort-Object -Unique) -join "`n"
  if ((Get-TextSha256 $hashLines) -ne $SourceManifest.source_files_sha256 -or
      (Get-TextSha256 $status) -ne $SourceManifest.source_status_sha256 -or
      (Get-TextSha256 $diff) -ne $SourceManifest.source_diff_sha256 -or
      (Get-TextSha256 $untracked) -ne $SourceManifest.source_untracked_sha256) {
    throw "Runtime kaynak fingerprint özetleri mevcut release ağacıyla eşleşmiyor"
  }
}

function Assert-ReleaseSource {
  if ((Split-Path -Leaf $Root) -ne "seroguld-crm-latest-windows") {
    throw "Release yalnızca seroguld-crm-latest-windows ağacından üretilebilir"
  }
  $configPath = Join-Path $Root "desktop\src-tauri\tauri.conf.json"
  $config = Get-Content -LiteralPath $configPath -Raw
  try {
    $configObject = $config | ConvertFrom-Json
  } catch {
    throw "Tauri yapılandırması JSON olarak okunamadı"
  }
  if ($configObject.version -ne $ProductVersion -or
      $configObject.bundle.targets -ne "nsis" -or
      $configObject.bundle.windows.webviewInstallMode.type -ne "offlineInstaller" -or
      $configObject.bundle.windows.nsis.compression -ne "zlib" -or
      $configObject.bundle.windows.nsis.installMode -ne "perMachine" -or
      $configObject.bundle.windows.nsis.installerIcon -notmatch 'seroguld-sg\.ico$' -or
      @($configObject.bundle.icon) -notcontains '../../installer/windows/assets/seroguld-sg.ico' -or
      @($configObject.bundle.icon) -notcontains '../../installer/windows/assets/seroguld-sg.png') {
    throw "Tauri Windows release ayarları ($ProductVersion/NSIS/perMachine/offline/SG icon/zlib) doğrulanamadı"
  }
  $releaseCsp = [string]$configObject.app.security.csp
  $connectDirective = [regex]::Match($releaseCsp, '(?i)(?:^|;)\s*connect-src\s+([^;]+)')
  if (-not $connectDirective.Success) { throw "Release CSP connect-src kuralı bulunamadı" }
  foreach ($urlMatch in [regex]::Matches($connectDirective.Groups[1].Value, '(?i)(?:https?|wss?)://[^\s]+')) {
    $connectUri = [uri]$urlMatch.Value
    if ($connectUri.Host -notin @('127.0.0.1', 'localhost', 'tauri.localhost')) {
      throw "Release CSP uzak backend bağlantısına izin veriyor: $($connectUri.Host)"
    }
  }
  if ($connectDirective.Groups[1].Value -notmatch '(?i)http://127\.0\.0\.1:8100') {
    throw "Release CSP packaged backend loopback adresini içermiyor"
  }
  $main = Get-Content -LiteralPath (Join-Path $Root "desktop\src-tauri\src\main.rs") -Raw
  foreach ($marker in @('mod pending_purchase_draft;', 'get_identity_scanner_capabilities', 'DISPLAY_SETTINGS_FILE')) {
    if ($main -notmatch [regex]::Escape($marker)) { throw "Aug desktop koruması release kaynağında yok: $marker" }
  }
  foreach ($legacyPath in @(
      (Join-Path $Root "desktop\src-tauri\src\office_runtime.rs"),
      (Join-Path $Root "desktop\src-tauri\onlyoffice.compose.yml")
    )) {
    if (Test-Path -LiteralPath $legacyPath) { throw "Legacy OnlyOffice/runtime dosyası release kaynağında bulunuyor" }
  }
  $hook = Get-Content -LiteralPath (Join-Path $Root "desktop\src-tauri\windows\installer-hooks.nsh") -Raw
  $cleanup = Get-Content -LiteralPath (Join-Path $Root "desktop\src-tauri\windows\seroguld-installer-cleanup.ps1") -Raw
  $acceptance = Get-Content -LiteralPath (Join-Path $Root "scripts\windows-desktop-acceptance.ps1") -Raw
  foreach ($source in @($hook, $cleanup, $acceptance)) {
    if ($source -notmatch [regex]::Escape('seroguld_crm_desktop.exe')) {
      throw "Installer/cleanup/acceptance canonical executable adıyla eşleşmiyor"
    }
  }
}

function Get-SevenZip {
  $sevenZip = Get-Command 7z.exe -ErrorAction SilentlyContinue
  if ($null -eq $sevenZip) {
    throw "NSIS artifact gate için 7z.exe gerekli; arşiv doğrulaması atlanamaz"
  }
  return $sevenZip.Source
}

function Assert-SgIconAsset {
  $icon = Join-Path $Root "installer\windows\assets\seroguld-sg.ico"
  $png = Join-Path $Root "installer\windows\assets\seroguld-sg.png"
  foreach ($path in @($icon, $png)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "SG icon asset bulunamadı: $path"
    }
  }
  $bytes = [System.IO.File]::ReadAllBytes($icon)
  if ($bytes.Length -lt 6 -or $bytes[0] -ne 0 -or $bytes[1] -ne 0 -or $bytes[2] -ne 1 -or $bytes[3] -ne 0) {
    throw "SG ICO header geçersiz"
  }
  $frameCount = [BitConverter]::ToUInt16($bytes, 4)
  if ($frameCount -lt 2) {
    throw "SG ICO çoklu frame içermiyor; installer icon için en az iki frame gerekli"
  }
  $pngBytes = [System.IO.File]::ReadAllBytes($png)
  $pngSignature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
  $pngHeaderMatches = $pngBytes.Length -ge $pngSignature.Length
  if ($pngHeaderMatches) {
    for ($index = 0; $index -lt $pngSignature.Length; $index++) {
      if ($pngBytes[$index] -ne $pngSignature[$index]) {
        $pngHeaderMatches = $false
        break
      }
    }
  }
  if (-not $pngHeaderMatches) {
    throw "SG PNG header geçersiz"
  }
  return [ordered]@{
    ico_sha256 = (Get-FileHash -LiteralPath $icon -Algorithm SHA256).Hash.ToLowerInvariant()
    png_sha256 = (Get-FileHash -LiteralPath $png -Algorithm SHA256).Hash.ToLowerInvariant()
    ico_frames = [int]$frameCount
  }
}

function Assert-SgIconFramesEmbedded {
  param(
    [string]$IconPath,
    [hashtable]$Targets
  )
  if (-not ("SeroGuldRelease.BinaryPattern" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;

namespace SeroGuldRelease {
  public static class BinaryPattern {
    public static bool FileContains(string path, byte[] pattern) {
      if (pattern == null || pattern.Length == 0) return false;
      int[] prefix = new int[pattern.Length];
      for (int i = 1, j = 0; i < pattern.Length;) {
        if (pattern[i] == pattern[j]) prefix[i++] = ++j;
        else if (j > 0) j = prefix[j - 1];
        else prefix[i++] = 0;
      }
      byte[] buffer = new byte[1024 * 1024];
      int matched = 0;
      using (FileStream stream = File.OpenRead(path)) {
        int read;
        while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) {
          for (int i = 0; i < read; i++) {
            while (matched > 0 && buffer[i] != pattern[matched]) matched = prefix[matched - 1];
            if (buffer[i] == pattern[matched]) matched++;
            if (matched == pattern.Length) return true;
          }
        }
      }
      return false;
    }
  }
}
'@
  }

  $iconBytes = [System.IO.File]::ReadAllBytes($IconPath)
  $frameCount = [BitConverter]::ToUInt16($iconBytes, 4)
  $frames = @()
  for ($index = 0; $index -lt $frameCount; $index++) {
    $entryOffset = 6 + (16 * $index)
    $size = [BitConverter]::ToUInt32($iconBytes, $entryOffset + 8)
    $offset = [BitConverter]::ToUInt32($iconBytes, $entryOffset + 12)
    if ($size -le 0 -or $offset + $size -gt $iconBytes.Length) {
      throw "SG ICO frame sınırları geçersiz: $index"
    }
    $frame = New-Object byte[] $size
    [Array]::Copy($iconBytes, [int]$offset, $frame, 0, [int]$size)
    $frames += ,$frame
  }

  $evidence = [ordered]@{}
  foreach ($entry in $Targets.GetEnumerator()) {
    $targetPath = [string]$entry.Value
    if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
      throw "SG icon PE hedefi bulunamadı: $targetPath"
    }
    $embedded = 0
    foreach ($frame in $frames) {
      if ([SeroGuldRelease.BinaryPattern]::FileContains($targetPath, $frame)) {
        $embedded++
      }
    }
    if ($embedded -ne $frameCount) {
      throw "SG icon frame'leri PE kaynağına eksik gömülmüş: $($entry.Key) ($embedded/$frameCount)"
    }
    $evidence[$entry.Key] = [ordered]@{
      embedded_frames = $embedded
      expected_frames = [int]$frameCount
      passed = $true
    }
  }
  return $evidence
}

function Assert-FrontendLoopbackBundle {
  $distRoot = Join-Path $Root "frontend\dist"
  $javascriptFiles = @(Get-ChildItem -LiteralPath $distRoot -Filter "*.js" -Recurse -File -ErrorAction Stop)
  if ($javascriptFiles.Count -eq 0) { throw "Frontend production bundle bulunamadı" }
  $foundLoopback = $false
  foreach ($file in $javascriptFiles) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    if ($content -match 'http://127\.0\.0\.1:8100') { $foundLoopback = $true }
    foreach ($match in [regex]::Matches($content, '(?i)(?:https?|wss?)://[^"''\s]+:8100')) {
      $uri = [uri]$match.Value
      if ($uri.Host -notin @('127.0.0.1', 'localhost')) {
        throw "Frontend bundle uzak backend adresi içeriyor: $($uri.Host)"
      }
    }
  }
  if (-not $foundLoopback) { throw "Frontend bundle packaged loopback backend adresini içermiyor" }
  $bundleFiles = @(Get-ChildItem -LiteralPath $distRoot -Recurse -File -Force | Sort-Object FullName)
  $hashLines = @($bundleFiles | ForEach-Object {
      $relative = $_.FullName.Substring($distRoot.Length).TrimStart('\').Replace('\', '/')
      $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      "$relative=$hash"
    }) -join "`n"
  return [ordered]@{
    passed = $true
    backend_url = 'http://127.0.0.1:8100'
    javascript_file_count = $javascriptFiles.Count
    bundle_file_count = $bundleFiles.Count
    bundle_sha256 = Get-TextSha256 $hashLines
    remote_backend_count = 0
  }
}

function Assert-NoUpxCompression {
  param([string[]]$Paths)
  if (@($Paths).Count -eq 0) {
    throw "UPX gate için payload içinde PE dosyası bulunamadı"
  }
  $checked = @()
  foreach ($path in @($Paths | Where-Object { $_ })) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "UPX gate için PE dosyası bulunamadı: $path"
    }
    # Gerçek UPX imzaları PE bölüm tablosunda (dosyanın BAŞINDA) yaşar.
    # Tüm dosyayı taramak, sıkıştırılmış NSIS payload'ında 4 baytlık desenin
    # RASTGELE çıkmasıyla yanlış pozitif veriyordu (267MB'ta ~%25/build).
    # Yalnız ilk 16KB (DOS+PE başlıkları + section adları) taranır.
    $stream = [System.IO.File]::OpenRead($path)
    try {
      $headBytes = New-Object byte[] ([Math]::Min(16384, $stream.Length))
      $null = $stream.Read($headBytes, 0, $headBytes.Length)
    } finally {
      $stream.Dispose()
    }
    $ascii = [System.Text.Encoding]::ASCII.GetString($headBytes)
    if ($ascii.Contains("UPX0") -or $ascii.Contains("UPX1") -or $ascii.Contains("UPX2") -or $ascii.Contains("UPX!")) {
      throw "PE/Runtime UPX sıkıştırması tespit edildi: $path"
    }
    $checked += [System.IO.Path]::GetFileName($path)
  }
  return @($checked)
}

function Assert-PayloadListing {
  param([string]$Installer, [string]$IconPath)
  $sevenZip = Get-SevenZip
  $testOutput = & $sevenZip t $Installer 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $testOutput -notmatch '(?im)Everything is Ok') {
    throw "NSIS payload 7z test başarısız; 'Everything is Ok' doğrulanmadı"
  }
  $listing = & $sevenZip l '-slt' $Installer 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "NSIS payload 7z ile okunamadı" }
  $methods = @($listing -split "`r?`n" | Where-Object { $_ -match '^\s*Method\s*=\s*(.+)$' } | ForEach-Object {
      ([regex]::Match($_, '^\s*Method\s*=\s*(.+)$')).Groups[1].Value.Trim()
    } | Sort-Object -Unique)
  $nonEmptyMethods = @($methods | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $unexpectedMethods = @($nonEmptyMethods | Where-Object { $_ -notmatch '(?i)^(Deflate|zlib)(?:\s|$)' })
  if ($nonEmptyMethods.Count -eq 0 -or $unexpectedMethods.Count -gt 0) {
    throw "NSIS payload sıkıştırmasının tamamı Deflate/zlib değil: $($methods -join ', ')"
  }
  $bad = @($listing -split "`r?`n" | Where-Object {
      $line = $_.ToLowerInvariant()
      ($line -match 'gcapi\.dll|onlyoffice|office_runtime|docker-compose|\.pyc|\.pdb') -or
      (($line -match '(^|[\\/])\.env($|[\\/])|(^|[\\/])runtime\.env($|[\\/])|(^|[\\/])production\.env($|[\\/])') -and $line -notmatch 'runtime-seed\.env')
    })
  if ($bad.Count -gt 0) { throw "NSIS payload'ta yasaklı dosya bulundu" }
  $canonicalRuntime = Join-Path $Root "desktop\src-tauri\runtime\seroguld-runtime\seroguld-runtime.exe"
  if (-not (Test-Path -LiteralPath $canonicalRuntime -PathType Leaf)) {
    throw "Canonical packaged runtime bulunamadı: $canonicalRuntime"
  }
  $extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("SeroGuldArtifact-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  try {
    $extractOutput = & $sevenZip x '-y' "-o$extractRoot" $Installer 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "NSIS payload 7z ile geçici klasöre açılamadı" }
    $payloadRuntimes = @(Get-ChildItem -LiteralPath $extractRoot -Filter "seroguld-runtime.exe" -Recurse -File -ErrorAction Stop)
    if ($payloadRuntimes.Count -ne 1) {
      throw "NSIS payload'ta tek packaged runtime bulunamadı: $($payloadRuntimes.Count)"
    }
    $payloadDesktopExecutables = @(Get-ChildItem -LiteralPath $extractRoot -Filter "seroguld_crm_desktop.exe" -Recurse -File -ErrorAction Stop)
    if ($payloadDesktopExecutables.Count -ne 1) {
      throw "NSIS payload'ta canonical desktop executable tek değil: $($payloadDesktopExecutables.Count)"
    }
    $iconEvidence = Assert-SgIconFramesEmbedded -IconPath $IconPath -Targets @{
      installer = $Installer
      desktop_executable = $payloadDesktopExecutables[0].FullName
    }
    $canonicalHash = (Get-FileHash -LiteralPath $canonicalRuntime -Algorithm SHA256).Hash.ToLowerInvariant()
    $payloadHash = (Get-FileHash -LiteralPath $payloadRuntimes[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($canonicalHash -ne $payloadHash) {
      throw "NSIS payload runtime hash canonical runtime ile eşleşmiyor"
    }
    $payloadFiles = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Force)
    $payloadPePaths = @($payloadFiles | Where-Object {
        $_.Extension -in @('.exe', '.dll')
      } | ForEach-Object { $_.FullName })
    $payloadUpxChecked = Assert-NoUpxCompression -Paths $payloadPePaths
    $payloadSeedFiles = @($payloadFiles | Where-Object { $_.Name -ceq "runtime-seed.env" })
    if ($payloadSeedFiles.Count -ne 1) {
      throw "NSIS payload'ta tek customer runtime seed bulunmalı: $($payloadSeedFiles.Count)"
    }
    $payloadSeedRelative = $payloadSeedFiles[0].FullName.Substring($extractRoot.Length).TrimStart('\')
    if ($payloadSeedRelative -cne $CustomerRuntimeSeedRelativePath) {
      throw "NSIS customer runtime seed beklenmeyen konumda: $payloadSeedRelative"
    }
    $seedKeys = @(Assert-CustomerRuntimeSeed -Path $payloadSeedFiles[0].FullName)
    $canonicalSeed = Join-Path $Root "desktop\src-tauri\runtime\seroguld-runtime\runtime-seed.env"
    if (-not (Test-Path -LiteralPath $canonicalSeed -PathType Leaf) -or
        -not (Test-FilesByteEqual -FirstPath $canonicalSeed -SecondPath $payloadSeedFiles[0].FullName)) {
      throw "NSIS customer runtime seed canonical payload ile eşleşmiyor"
    }
    $payloadSecretFiles = @($payloadFiles | Where-Object {
        $name = $_.Name.ToLowerInvariant()
        ($_.Extension -ieq '.env' -and $_.FullName -ne $payloadSeedFiles[0].FullName) -or
          $name -match 'docker-compose|onlyoffice|office_runtime|gcapi\.dll'
      })
    if ($payloadSecretFiles.Count -gt 0) {
      throw "NSIS payload'ta legacy/env secret dosyası bulundu: $($payloadSecretFiles.Name -join ', ')"
    }
    $script:ArtifactChecks.runtime_canonical_sha256 = $canonicalHash
    $script:ArtifactChecks.runtime_payload_sha256 = $payloadHash
    $script:ArtifactChecks.runtime_hash_match = $true
    $script:ArtifactChecks.customer_runtime_seed_path = $payloadSeedRelative
    $script:ArtifactChecks.customer_runtime_seed_keys = $seedKeys
    $script:ArtifactChecks.customer_runtime_seed_exact_count = 1
    $script:ArtifactChecks.payload_upx_checked = @($payloadUpxChecked)
    $script:ArtifactChecks.sg_icon_pe_resources = $iconEvidence
  } finally {
    if (Test-Path -LiteralPath $extractRoot) {
      Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  $script:ArtifactChecks.archive_test = 'Everything is Ok'
  $script:ArtifactChecks.compression_methods = @($nonEmptyMethods)
  return "passed"
}

function Verify-ReleaseArtifact {
  param([string]$Installer)
  if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw "NSIS çıktısı bulunamadı" }
  $resolvedRuntimeBuildDirectory = if ([string]::IsNullOrWhiteSpace($RuntimeBuildDirectory)) {
    Join-Path $Root ".run\windows-runtime-build"
  } else { [System.IO.Path]::GetFullPath($RuntimeBuildDirectory) }
  $sourceManifestPath = Join-Path $resolvedRuntimeBuildDirectory "build-manifest.json"
  if (-not (Test-Path -LiteralPath $sourceManifestPath -PathType Leaf)) {
    throw "Runtime kaynak fingerprint manifesti bulunamadı; installer provenance doğrulanamaz"
  }
  $sourceManifest = Get-Content -LiteralPath $sourceManifestPath -Raw | ConvertFrom-Json
  $currentHead = Get-SourceHead
  if ($sourceManifest.source_head -ne $currentHead -or $sourceManifest.product_version -ne $ProductVersion) {
    throw "Runtime kaynak fingerprint manifesti mevcut release kaynağıyla eşleşmiyor"
  }
  Assert-SourceManifestMatchesCurrentTree -SourceManifest $sourceManifest
  $icon = Join-Path $Root "installer\windows\assets\seroguld-sg.ico"
  $iconChecks = Assert-SgIconAsset
  $payloadCheck = Assert-PayloadListing -Installer $Installer -IconPath $icon
  $hash = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
  $sevenZip = Get-SevenZip
  $sevenZipVersion = ((& $sevenZip i 2>$null | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1) -join "").Trim()
  if ([string]::IsNullOrWhiteSpace($sevenZipVersion)) {
    throw "7z/NanaZip sürüm bilgisi okunamadı"
  }
  $upxChecked = Assert-NoUpxCompression -Paths @(
    $Installer,
    (Join-Path $Root "desktop\src-tauri\runtime\seroguld-runtime\seroguld-runtime.exe")
  )
  $script:ArtifactChecks.upx_checked = @($upxChecked)
  $script:ArtifactChecks.upx_absent = $true
  $script:ArtifactChecks.sg_ico_frames = $iconChecks.ico_frames
  $script:ArtifactChecks.sg_icon_config = $true
  $manifest = [ordered]@{
    schema = 2
    product = "SERO GULD CRM"
    version = $ProductVersion
    installer = [System.IO.Path]::GetFileName($Installer)
    installer_size_bytes = (Get-Item -LiteralPath $Installer).Length
    installer_sha256 = $hash
    installer_payload_check = $payloadCheck
    icon_sha256 = $iconChecks.ico_sha256
    icon_png_sha256 = $iconChecks.png_sha256
    icon_frames = $iconChecks.ico_frames
    seven_zip = $sevenZipVersion
    source_provenance = $sourceManifest
    artifact_checks = $script:ArtifactChecks
    defender_scan = $DefenderScanStatus
    defender_scan_started_at = $DefenderScanStartedAt
    defender_scan_finished_at = $DefenderScanFinishedAt
    defender_scan_tool = $DefenderScanTool
    defender_scan_threat_count = $DefenderScanThreatCount
    final_copy_performed = $false
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
  Set-Content -LiteralPath "$Installer.sha256" -Value "$hash  $([System.IO.Path]::GetFileName($Installer))" -Encoding ASCII
}

Assert-ReleaseSource
if ($Finalize -and -not $RunDefenderScan) {
  throw "Final Downloads kopyası için -RunDefenderScan zorunludur"
}
if ($Finalize -and ($SkipRuntime -or $SkipFrontend -or $SkipTauri)) {
  throw "Final Downloads release'i runtime, frontend ve Tauri'yi aynı doğrulanmış çağrıda yeniden üretmelidir"
}
New-Item -ItemType Directory -Force -Path $ReleaseWork | Out-Null
Assert-FreeSpace -Path $Root -RequiredBytes ([int64](1536MB)) -Purpose "Windows runtime ve NSIS release"

# A release build always talks to its own packaged sidecar. Do not inherit a
# developer/CI network endpoint into Vite, even when the caller happens to
# have VITE_* variables set globally.
$loopbackBackend = "http://127.0.0.1:8100"
$previousApiBaseUrl = $env:VITE_API_BASE_URL
$previousWsBaseUrl = $env:VITE_WS_BASE_URL
$env:VITE_API_BASE_URL = $loopbackBackend
$env:VITE_WS_BASE_URL = $loopbackBackend

try {
  if (-not $SkipRuntime) {
    $powershell = Join-Path $PSHOME "powershell.exe"
    if (-not (Test-Path -LiteralPath $powershell)) { $powershell = (Get-Command pwsh.exe -ErrorAction Stop).Source }
    $runtimeArguments = @(
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", (Join-Path $Root "scripts\build-windows-runtime.ps1")
    )
    if (-not [string]::IsNullOrWhiteSpace($RuntimeBuildDirectory)) {
      $runtimeArguments += @("-BuildDirectory", [System.IO.Path]::GetFullPath($RuntimeBuildDirectory))
    }
    Invoke-Checked -Command $powershell -Arguments $runtimeArguments
  }
  if (-not $SkipFrontend) {
    Invoke-Checked -Command "npm.cmd" -Arguments @("run", "build") -WorkingDirectory (Join-Path $Root "frontend")
  }
  $script:ArtifactChecks.frontend_loopback = Assert-FrontendLoopbackBundle
  if (-not $SkipTauri) {
    Invoke-Checked -Command "npm.cmd" -Arguments @("run", "tauri", "build", "--", "--ci") -WorkingDirectory (Join-Path $Root "desktop")
  }
} finally {
  if ($null -eq $previousApiBaseUrl) { Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }
  else { $env:VITE_API_BASE_URL = $previousApiBaseUrl }
  if ($null -eq $previousWsBaseUrl) { Remove-Item Env:VITE_WS_BASE_URL -ErrorAction SilentlyContinue }
  else { $env:VITE_WS_BASE_URL = $previousWsBaseUrl }
}

$bundleDirectory = Join-Path $Root "desktop\src-tauri\target\release\bundle\nsis"
$builtInstaller = @(Get-ChildItem -LiteralPath $bundleDirectory -Filter "*.exe" -File -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
if ($builtInstaller.Count -ne 1) { throw "Tauri NSIS installer çıktısı bulunamadı" }
$installerVersionPattern = '(?i)(^|[_ -])' + [regex]::Escape($ProductVersion) + '([_ -]|\.)'
if ($builtInstaller[0].Name -notmatch $installerVersionPattern) {
  throw "NSIS çıktısı $ProductVersion değil; eski/yanlış installer kesinlikle release'e alınmayacak: $($builtInstaller[0].Name)"
}
if (-not $SkipTauri -and $builtInstaller[0].LastWriteTime -lt $BuildStarted) {
  throw "NSIS çıktısı bu release çağrısında üretilmedi; eski artifact kesinlikle kullanılmayacak"
}
Copy-Item -LiteralPath $builtInstaller[0].FullName -Destination $NsisOutput -Force
Verify-ReleaseArtifact -Installer $NsisOutput

function Write-DefenderManifest {
  $manifestAfterScan = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
  $manifestAfterScan | Add-Member -NotePropertyName defender_scan -NotePropertyValue $DefenderScanStatus -Force
  $manifestAfterScan | Add-Member -NotePropertyName defender_scan_started_at -NotePropertyValue $DefenderScanStartedAt -Force
  $manifestAfterScan | Add-Member -NotePropertyName defender_scan_finished_at -NotePropertyValue $DefenderScanFinishedAt -Force
  $manifestAfterScan | Add-Member -NotePropertyName defender_scan_tool -NotePropertyValue $DefenderScanTool -Force
  $manifestAfterScan | Add-Member -NotePropertyName defender_scan_threat_count -NotePropertyValue $DefenderScanThreatCount -Force
  $manifestAfterScan | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
}

function Invoke-DefenderCustomScan {
  $script:DefenderScanStartedAt = (Get-Date).ToUniversalTime().ToString("o")
  $script:DefenderScanTool = $null
  $script:DefenderScanThreatCount = 0
  try {
    $startScan = Get-Command Start-MpScan -ErrorAction SilentlyContinue
    $scanOutput = ""
    if ($null -ne $startScan) {
      $script:DefenderScanTool = "Start-MpScan/CustomScan"
      Start-MpScan -ScanType CustomScan -ScanPath $NsisOutput -ErrorAction Stop
    } else {
      $mpCmdCandidates = @(
        (Join-Path $env:ProgramFiles "Windows Defender\MpCmdRun.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Windows Defender\MpCmdRun.exe")
      )
      $mpCmd = @($mpCmdCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1)
      if ($mpCmd.Count -eq 0) {
        throw "Defender custom-scan aracı bulunamadı; açıkça istenen tarama atlanamaz"
      }
      $script:DefenderScanTool = "MpCmdRun.exe/-ScanType 3/-File"
      $scanOutput = (& $mpCmd[0] -Scan -ScanType 3 -File $NsisOutput 2>&1 | Out-String)
      if ($LASTEXITCODE -ne 0) {
        throw "Defender custom taraması başarısız oldu (exit $LASTEXITCODE)"
      }
    }
    $script:DefenderScanFinishedAt = (Get-Date).ToUniversalTime().ToString("o")
    $threatQuery = Get-Command Get-MpThreatDetection -ErrorAction SilentlyContinue
    if ($null -eq $threatQuery) {
      throw "Defender tehdit sonucu sorgulanamadı; tarama başarı olarak işaretlenemez"
    }
    $scanStart = [datetime]::Parse($script:DefenderScanStartedAt).ToUniversalTime()
    $scanFinish = [datetime]::Parse($script:DefenderScanFinishedAt).ToUniversalTime()
    $threats = @(Get-MpThreatDetection -ErrorAction Stop | Where-Object {
        $detectionTime = $_.InitialDetectionTime
        $detectionTime -and
          $detectionTime.ToUniversalTime() -ge $scanStart.AddMinutes(-1) -and
          $detectionTime.ToUniversalTime() -le $scanFinish.AddMinutes(5)
      })
    $activeThreatCommand = Get-Command Get-MpThreat -ErrorAction SilentlyContinue
    $activeThreats = if ($null -eq $activeThreatCommand) { @() } else {
      @(Get-MpThreat -ErrorAction Stop | Where-Object { $_.IsActive })
    }
    $script:DefenderScanThreatCount = $threats.Count + $activeThreats.Count
    if ($script:DefenderScanThreatCount -gt 0) {
      throw "Defender installer payload için tehdit bildirdi"
    }
    $script:DefenderScanStatus = "passed"
  } catch {
    $script:DefenderScanStatus = "failed"
    if ([string]::IsNullOrWhiteSpace($script:DefenderScanFinishedAt)) {
      $script:DefenderScanFinishedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    Write-DefenderManifest
    throw
  }
}

if ($RunDefenderScan) {
  Invoke-DefenderCustomScan
}
Write-DefenderManifest

function Get-InstallerSidecars {
  param([string]$InstallerPath)
  $directory = Split-Path -Parent $InstallerPath
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($InstallerPath)
  $withoutExtension = Join-Path $directory $baseName
  return @(
    "$InstallerPath.sha256",
    "$InstallerPath.manifest.json",
    "$withoutExtension.sha256",
    "$withoutExtension.manifest.json"
  ) | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
}

function Assert-ArchivedInstallerMetadata {
  param([string]$InstallerPath, [string]$ActualHash, [string[]]$Sidecars)
  foreach ($sidecar in @($Sidecars)) {
    if ($sidecar.EndsWith('.sha256', [System.StringComparison]::OrdinalIgnoreCase)) {
      $content = Get-Content -LiteralPath $sidecar -Raw -ErrorAction Stop
      $match = [regex]::Match($content, '(?i)\b[0-9a-f]{64}\b')
      if (-not $match.Success -or $match.Value.ToLowerInvariant() -ne $ActualHash) {
        throw "Arşivlenecek installer SHA-256 yan dosyası geçersiz: $sidecar"
      }
    }
    if ($sidecar.EndsWith('.manifest.json', [System.StringComparison]::OrdinalIgnoreCase)) {
      try { $legacyManifest = Get-Content -LiteralPath $sidecar -Raw | ConvertFrom-Json }
      catch { throw "Arşivlenecek installer manifesti okunamadı: $sidecar" }
      if ($legacyManifest.installer_sha256 -and
          ([string]$legacyManifest.installer_sha256).ToLowerInvariant() -ne $ActualHash) {
        throw "Arşivlenecek installer manifest hash'i dosyayla eşleşmiyor: $sidecar"
      }
    }
  }
}

if ($Finalize) {
  $downloads = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
  Assert-FreeSpace -Path $downloads -RequiredBytes ([int64](600MB)) -Purpose "Downloads final installer kopyası"
  New-Item -ItemType Directory -Force -Path $downloads | Out-Null
  $destination = Join-Path $downloads "SERO-GULD-CRM-FULL-SETUP.exe"
  $destinationSha = "$destination.sha256"
  $destinationManifest = Join-Path $downloads "SERO-GULD-CRM-FULL-SETUP.manifest.json"
  $archiveRoot = Join-Path $downloads "SeroGuldCRM-archive"
  $archiveDirectory = $archiveRoot
  $sourceHash = (Get-FileHash -LiteralPath $NsisOutput -Algorithm SHA256).Hash.ToLowerInvariant()
  $sourceManifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
  if (([string]$sourceManifest.installer_sha256).ToLowerInvariant() -ne $sourceHash -or
      $sourceManifest.defender_scan -ne 'passed' -or
      [int]$sourceManifest.defender_scan_threat_count -ne 0) {
    throw "Final installer kaynak manifest/hash/Defender bilgisi tutarsız"
  }

  $stageToken = [guid]::NewGuid().ToString('N')
  $stagedInstaller = Join-Path $downloads ".SERO-GULD-CRM-FULL-SETUP.$stageToken.tmp.exe"
  $stagedSha = "$stagedInstaller.sha256"
  $stagedManifest = "$stagedInstaller.manifest.json"
  Copy-Item -LiteralPath $NsisOutput -Destination $stagedInstaller -Force
  $stagedHash = (Get-FileHash -LiteralPath $stagedInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($stagedHash -ne $sourceHash) {
    Remove-Item -LiteralPath $stagedInstaller -Force -ErrorAction SilentlyContinue
    throw "Downloads staging kopyası kaynak installer hash'iyle eşleşmiyor"
  }

  $gcapiPath = Join-Path $downloads 'gcapi.dll'
  $gcapiBefore = if (Test-Path -LiteralPath $gcapiPath -PathType Leaf) {
    (Get-FileHash -LiteralPath $gcapiPath -Algorithm SHA256).Hash.ToLowerInvariant()
  } else { $null }
  $legacySetupNames = @(
    "SERO-GULD-CRM-FULL-SETUP.exe",
    "SERO-GULD-CRM-SETUP.exe",
    "SeroGuldCRM-Setup.exe",
    "Sero Guld CRM Setup.exe"
  )
  $legacySetups = @($legacySetupNames | ForEach-Object {
      $candidate = Join-Path $downloads $_
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $candidate }
  } | Select-Object -Unique)
  $archiveMoves = New-Object System.Collections.Generic.List[object]
  $archiveGeneratedFiles = New-Object System.Collections.Generic.List[string]
  # Use a native PowerShell array here. Windows PowerShell 5.1 can throw
  # "Argument types do not match" when a generic List[object] is wrapped in
  # @() while binding Add-Member's NotePropertyValue during finalization.
  $archiveRecords = @()
  $placedFinalFiles = New-Object System.Collections.Generic.List[string]
  try {
    if ($legacySetups.Count -gt 0) {
      New-Item -ItemType Directory -Force -Path $archiveDirectory | Out-Null
      foreach ($legacySetup in $legacySetups) {
        $legacyHash = (Get-FileHash -LiteralPath $legacySetup -Algorithm SHA256).Hash.ToLowerInvariant()
        $sidecars = @(Get-InstallerSidecars -InstallerPath $legacySetup)
        Assert-ArchivedInstallerMetadata -InstallerPath $legacySetup -ActualHash $legacyHash -Sidecars $sidecars

        $archiveName = "{0}-replaced-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmssfff"), [System.IO.Path]::GetFileName($legacySetup)
        $archivePath = Join-Path $archiveDirectory $archiveName
        Move-Item -LiteralPath $legacySetup -Destination $archivePath
        $archiveMoves.Add([pscustomobject]@{ original = $legacySetup; archived = $archivePath })

        $archivedSidecars = @()
        foreach ($sidecar in $sidecars) {
          $sidecarName = [System.IO.Path]::GetFileName($sidecar)
          $sidecarArchive = "$archivePath.sidecar-$sidecarName"
          Move-Item -LiteralPath $sidecar -Destination $sidecarArchive
          $archiveMoves.Add([pscustomobject]@{ original = $sidecar; archived = $sidecarArchive })
          $archivedSidecars += [System.IO.Path]::GetFileName($sidecarArchive)
        }
        $normalizedArchiveSha = "$archivePath.sha256"
        Set-Content -LiteralPath $normalizedArchiveSha -Value "$legacyHash  $archiveName" -Encoding ASCII
        $archiveGeneratedFiles.Add($normalizedArchiveSha)
        $recordPath = "$archivePath.archive.json"
        $record = [ordered]@{
          schema = 1
          original_name = [System.IO.Path]::GetFileName($legacySetup)
          archived_name = $archiveName
          sha256 = $legacyHash
          archived_at_utc = (Get-Date).ToUniversalTime().ToString('o')
          sidecars = @($archivedSidecars)
        }
        $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordPath -Encoding UTF8
        $archiveGeneratedFiles.Add($recordPath)
        $archiveRecords += [pscustomobject]$record
      }
    }

    Set-Content -LiteralPath $stagedSha -Value "$sourceHash  $([System.IO.Path]::GetFileName($destination))" -Encoding ASCII
    $sourceManifest.final_copy_performed = $true
    $sourceManifest | Add-Member -NotePropertyName final_destination_sha256 -NotePropertyValue $sourceHash -Force
    $sourceManifest | Add-Member -NotePropertyName archived_existing_download -NotePropertyValue @($archiveRecords) -Force
    $sourceManifest | Add-Member -NotePropertyName external_gcapi -NotePropertyValue ([ordered]@{
        present = $null -ne $gcapiBefore
        sha256_before = $gcapiBefore
        sha256_after = $gcapiBefore
        unchanged = $true
      }) -Force
    $sourceManifest | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $stagedManifest -Encoding UTF8

    Move-Item -LiteralPath $stagedInstaller -Destination $destination -Force
    $placedFinalFiles.Add($destination)
    Move-Item -LiteralPath $stagedSha -Destination $destinationSha -Force
    $placedFinalFiles.Add($destinationSha)
    Move-Item -LiteralPath $stagedManifest -Destination $destinationManifest -Force
    $placedFinalFiles.Add($destinationManifest)

    $finalHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    $finalSidecar = Get-Content -LiteralPath $destinationSha -Raw
    $finalManifest = Get-Content -LiteralPath $destinationManifest -Raw | ConvertFrom-Json
    $gcapiAfter = if (Test-Path -LiteralPath $gcapiPath -PathType Leaf) {
      (Get-FileHash -LiteralPath $gcapiPath -Algorithm SHA256).Hash.ToLowerInvariant()
    } else { $null }
    if ($finalHash -ne $sourceHash -or
        $finalSidecar -notmatch [regex]::Escape($sourceHash) -or
        ([string]$finalManifest.installer_sha256).ToLowerInvariant() -ne $finalHash -or
        ([string]$finalManifest.final_destination_sha256).ToLowerInvariant() -ne $finalHash -or
        -not [bool]$finalManifest.final_copy_performed -or
        $gcapiAfter -ne $gcapiBefore) {
      throw "Downloads final installer/hash/manifest veya gcapi bütünlük kontrolü başarısız"
    }
    Copy-Item -LiteralPath $destinationManifest -Destination $ManifestPath -Force
  } catch {
    foreach ($path in @($stagedInstaller, $stagedSha, $stagedManifest)) {
      if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
      }
    }
    foreach ($path in $placedFinalFiles) {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
    for ($index = $archiveMoves.Count - 1; $index -ge 0; $index--) {
      $move = $archiveMoves[$index]
      if ((Test-Path -LiteralPath $move.archived -PathType Leaf) -and
          -not (Test-Path -LiteralPath $move.original)) {
        Move-Item -LiteralPath $move.archived -Destination $move.original -Force -ErrorAction SilentlyContinue
      }
    }
    foreach ($generated in $archiveGeneratedFiles) {
      Remove-Item -LiteralPath $generated -Force -ErrorAction SilentlyContinue
    }
    throw
  }
  Write-Host "Final NSIS release Downloads'a kopyalandı: $destination"
} else {
  Write-Host "NSIS release hazır (Downloads kopyası yapılmadı): $NsisOutput"
}
