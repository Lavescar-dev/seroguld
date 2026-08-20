param(
  [string]$Root = "",
  [string]$Python = "",
  [string]$BuildDirectory = "",
  [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"

$scriptDirectory = if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
  Split-Path -Parent $MyInvocation.MyCommand.Path
} else { $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Join-Path $scriptDirectory ".."
}
$Root = (Resolve-Path -LiteralPath $Root).ProviderPath
$BackendDir = Join-Path $Root "backend"
$DesktopRuntimeDir = Join-Path $Root "desktop\src-tauri\runtime\seroguld-runtime"
$BuildDir = if ([string]::IsNullOrWhiteSpace($BuildDirectory)) {
  Join-Path $Root ".run\windows-runtime-build"
} elseif (Test-Path -LiteralPath $BuildDirectory) {
  (Resolve-Path -LiteralPath $BuildDirectory).ProviderPath
} else {
  [System.IO.Path]::GetFullPath($BuildDirectory)
}
$SeedPath = Join-Path $BackendDir "runtime-seed.env"
$SpecPath = Join-Path $BackendDir "seroguld-runtime.spec"
$RequirementsPath = Join-Path $BackendDir "requirements-windows.txt"
$VenvDir = Join-Path $BuildDir "venv"
$ReferenceDir = Join-Path $Root "referans"
$RequiredTemplates = @(
  "Afregningsbilag ( alis frontumuz).xlsm",
  "Depolama.xlsx",
  "Log sistemi- afg verileri buraya yazdiriyorum..xlsx"
)
$CustomerRuntimeSeedName = "runtime-seed.env"

function Get-CustomerRuntimeSeedAllowedKeys {
  # This is a customer-specific offline installer.  The allowlist is explicit
  # so repository/database/login secrets can never reach the extractable NSIS
  # payload by merely being added to .env.  FIELD/JWT/admin/database/path keys
  # are deliberately absent.
  return @(
    "KDS_ADDRESS_BASE_URL", "KDS_ADDRESS_TOKEN", "KDS_ADDRESS_TIMEOUT_SECONDS", "KDS_ADDRESS_CACHE_SECONDS",
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_MAX_TOKENS", "OPENAI_TIMEOUT_SECONDS",
    "OPMC_API_URL", "OPMC_API_KEY", "OPMC_WEBHOOK_SECRET",
    "WOOCOMMERCE_BASE_URL", "WOOCOMMERCE_CONSUMER_KEY", "WOOCOMMERCE_CONSUMER_SECRET",
    "WOOCOMMERCE_WEBHOOK_SECRET", "WOOCOMMERCE_TIMEOUT_SECONDS",
    "WOOCOMMERCE_CATEGORY_MAP_JSON", "WOOCOMMERCE_STONEX_META_MAP_JSON", "WOOCOMMERCE_BADGE_META_JSON",
    "WOOCOMMERCE_DESC_FOOTER_HTML", "WOOCOMMERCE_DESC_FOOTER_ENABLED", "WOOCOMMERCE_PRIMARY_TERM_META_KEY",
    "WORDPRESS_BASE_URL", "WP_APP_USERNAME", "WP_APP_PASSWORD",
    "UNICONTA_API_URL", "UNICONTA_USERNAME", "UNICONTA_PASSWORD", "UNICONTA_COMPANY_ID", "UNICONTA_API_KEY",
    "UNICONTA_PURCHASE_VAT_CODE_25", "UNICONTA_PURCHASE_VAT_CODE_0",
    "UNICONTA_SEND_EMAIL_ON_FINALIZE", "UNICONTA_SEND_XML_ON_FINALIZE",
    "INVOICE_NUMBER_PREFIX", "INVOICE_DEFAULT_CURRENCY", "INVOICE_SALE_VAT_RATE_PERCENT", "INVOICE_SELLER_NAME",
    "INVOICE_SELLER_ADDRESS_LINE1", "INVOICE_SELLER_POSTAL_CODE", "INVOICE_SELLER_CITY", "INVOICE_SELLER_COUNTRY",
    "INVOICE_SELLER_CVR", "INVOICE_SELLER_EMAIL", "INVOICE_SELLER_PHONE", "INVOICE_SELLER_WEBSITE", "POS_REFERENCE_START",
    "POS_REFERENCE_SCAN_WINDOW", "MARKET_RATES_LIVE_ENABLED", "MARKET_RATES_LIVE_FX_ENABLED", "MARKET_RATES_LIVE_PLATINUM_ENABLED", "MARKET_RATES_LIVE_PALLADIUM_ENABLED", "GOLD_PRICE_LIVE_ENABLED", "GOLD_PRICE_TIMEOUT_SECONDS", "GOLD_PRICE_CACHE_SECONDS",
    "INVENTORY_MARKET_GOLD_DKK", "INVENTORY_MARKET_SILVER_DKK", "INVENTORY_MARKET_PLATINUM_DKK",
    "INVENTORY_MARKET_PALLADIUM_DKK", "INVENTORY_MARKET_GOLD_BAR_DKK", "INVENTORY_MARKET_SILVER_BAR_DKK",
    "INVENTORY_MARKET_PLET_DKK", "INVENTORY_MARKET_RATE_PROFILE_JSON",
    "METALS_DEV_API_KEY", "METALS_DEV_URL", "METALS_DEV_TIMEOUT_SECONDS", "METALS_DEV_CACHE_SECONDS",
    "ECB_FX_URL", "ECB_FX_TIMEOUT_SECONDS", "ECB_FX_CACHE_SECONDS",
    "STOOQ_SYMBOL_PLATINUM", "STOOQ_SYMBOL_PALLADIUM"
  )
}

function Get-CustomerRuntimeSeedRequiredKeys {
  # This release is the customer-specific Sero Guld installer, not a generic
  # redistributable.  Fail closed instead of silently publishing a package
  # whose WooCommerce, WordPress or Uniconta credentials were unavailable on
  # the build machine. Optional OpenAI/OPMC/KDS values are still copied when
  # present, but are not prerequisites for producing the installer.
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
    # -cmatch is intentional: Windows PowerShell's culture-sensitive -match
    # rejects ASCII I in canonical env keys under tr-TR.
    if ($line -cnotmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      throw "Customer runtime seed geçersiz satır içeriyor"
    }
    $key = [string]$Matches[1]
    $value = [string]$Matches[2]
    if ($allowed -cnotcontains $key) { throw "Customer runtime seed izin verilmeyen anahtar içeriyor: $key" }
    if ($seen.ContainsKey($key)) { throw "Customer runtime seed yinelenen anahtar içeriyor: $key" }
    if ([string]::IsNullOrWhiteSpace($value)) { throw "Customer runtime seed boş değer içeriyor: $key" }
    $seen[$key] = $true
  }
  $missingRequired = @(Get-CustomerRuntimeSeedRequiredKeys | Where-Object { -not $seen.ContainsKey($_) })
  if ($missingRequired.Count -gt 0) {
    throw "Customer runtime seed zorunlu entegrasyon anahtarları eksik: $($missingRequired -join ', ')"
  }
  return @($seen.Keys | Sort-Object)
}

$script:GitExecutable = @(@(
    Get-Command git.exe -ErrorAction SilentlyContinue
    Get-Command git -ErrorAction SilentlyContinue
  ) | Where-Object { $null -ne $_ } | Select-Object -First 1)

function Invoke-SourceGit {
  param([string[]]$Arguments)
  if ($script:GitExecutable.Count -gt 0) {
    $output = & $script:GitExecutable[0].Source -C $Root @Arguments 2>$null
  } else {
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if ($null -eq $wsl) { throw "Git provenance aracı bulunamadı" }
    $output = & $wsl.Source --cd $Root git @Arguments 2>$null
  }
  if ($LASTEXITCODE -ne 0) { throw "Git provenance bilgisi okunamadı" }
  return $output
}

function Get-CommandText {
  param([string[]]$Arguments)
  $output = Invoke-SourceGit $Arguments
  return (($output -join "`n").Trim())
}

function Get-TextSha256 {
  param([AllowEmptyString()][string]$Text)
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant() }
  finally { $hash.Dispose() }
}

function Assert-FreeSpace {
  param([string]$Path, [int64]$RequiredBytes, [string]$Purpose)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($rootPath) -or $rootPath.StartsWith('\\')) {
    return
  }
  $drive = [System.IO.DriveInfo]::new($rootPath)
  if ($drive.AvailableFreeSpace -lt $RequiredBytes) {
    $requiredMiB = [math]::Ceiling($RequiredBytes / 1MB)
    $availableMiB = [math]::Floor($drive.AvailableFreeSpace / 1MB)
    throw "$Purpose için disk alanı yetersiz: gerekli ${requiredMiB} MiB, boş ${availableMiB} MiB"
  }
}

function Test-SourceFingerprintPath {
  param([string]$RelativePath)
  $normalized = ([string]$RelativePath).Replace('\', '/').TrimStart('./')
  if ([string]::IsNullOrWhiteSpace($normalized)) { return $false }
  # The source fingerprint must cover every tracked diff and untracked source
  # input, while remaining stable after local builds/tests.  These paths are
  # generated artifacts, not release inputs; hashing them would make the
  # provenance manifest change merely because a test or build was run.
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

function Get-SourceFingerprintPaths {
  # `git diff HEAD` includes both staged and unstaged tracked changes.  The
  # separate `ls-files --others` call adds every untracked source file, rather
  # than hashing only a hand-maintained list of desktop files.  This is
  # intentionally content-addressed below; names alone are insufficient
  # provenance when a new migration/route/service is added untracked.
  $tracked = Invoke-SourceGit @("diff", "--name-only", "--no-ext-diff", "HEAD")
  $untracked = Invoke-SourceGit @("ls-files", "--others", "--exclude-standard")
  @($tracked + $untracked |
    ForEach-Object { [string]$_ } |
    Where-Object { Test-SourceFingerprintPath $_ } |
    Sort-Object -Unique)
}

function Assert-AugustSourceProvenance {
  $leaf = Split-Path -Leaf $Root
  if ($leaf -ne "seroguld-crm-latest-windows") {
    throw "Windows runtime yalnızca seroguld-crm-latest-windows ağacında derlenebilir; donor/wrong tree reddedildi"
  }
  $head = Get-CommandText @("rev-parse", "HEAD")
  $commitDate = Get-CommandText @("show", "-s", "--format=%cs", "HEAD")
  try { $parsedDate = [datetime]::ParseExact($commitDate, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture) } catch {
    throw "Git provenance tarihi okunamadı"
  }
  if ($parsedDate -lt [datetime]::new(2026, 8, 1)) {
    throw "Haziran/yanlış baseline reddedildi; Ağustos modern desktop ağacı gerekli"
  }
  $mainPath = Join-Path $Root "desktop\src-tauri\src\main.rs"
  $main = Get-Content -LiteralPath $mainPath -Raw -ErrorAction Stop
  foreach ($marker in @(
      "mod pending_purchase_draft;",
      "get_identity_scanner_capabilities",
      "acquire_identity_scan",
      "DISPLAY_SETTINGS_FILE",
      "save_customer_display_settings",
      "customer-display-settings.v1.json"
    )) {
    if ($main -notmatch [regex]::Escape($marker)) {
      throw "Ağustos desktop koruması eksik: $marker"
    }
  }
  foreach ($forbidden in @(
      (Join-Path $Root "desktop\src-tauri\src\office_runtime.rs"),
      (Join-Path $Root "desktop\src-tauri\onlyoffice.compose.yml")
    )) {
    if (Test-Path -LiteralPath $forbidden) {
      throw "Legacy OnlyOffice/runtime dosyası kaynak ağacından kaldırılmalı: $forbidden"
    }
  }
  return $head
}

function Write-SourceFingerprintManifest {
  param([string]$Head)
  # Compare against HEAD so staged and unstaged tracked changes are both
  # represented in the release provenance (plain `git diff` omits the index).
  $diff = Get-CommandText @("diff", "--no-ext-diff", "--binary", "HEAD")
  $untracked = @(
    Invoke-SourceGit @("ls-files", "--others", "--exclude-standard") |
      ForEach-Object { [string]$_ } |
      Where-Object { Test-SourceFingerprintPath $_ } |
      Sort-Object -Unique
  ) -join "`n"
  $fileHashes = [ordered]@{}
  foreach ($relative in @(Get-SourceFingerprintPaths)) {
    $path = Join-Path $Root ($relative -replace '/', '\\')
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $fileHashes[$relative] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    } else {
      # A tracked deletion is part of the source decision and must not be
      # silently omitted from provenance.  Keep a deterministic marker rather
      # than attempting to hash a file that no longer exists.
      $fileHashes[$relative] = "deleted"
    }
  }
  $fileHashLines = @($fileHashes.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
  # Do not hash raw `git status` output: the canonical runtime onedir is an
  # intentionally generated/untracked packaging input and would make the
  # manifest change after its own build.  This filtered status representation
  # covers every source path included above and stays replayable.
  $status = @($fileHashes.GetEnumerator() | ForEach-Object {
      $state = if ($_.Value -eq 'deleted') { 'deleted' } else { 'present' }
      "$state $($_.Key)"
    }) -join "`n"
  $manifest = [ordered]@{
    schema = 2
    product_version = "0.3.8"
    source_head = $Head
    source_diff_sha256 = Get-TextSha256 $diff
    source_untracked_sha256 = Get-TextSha256 $untracked
    source_status_sha256 = Get-TextSha256 $status
    source_file_count = $fileHashes.Count
    source_files_sha256 = Get-TextSha256 $fileHashLines
    files = $fileHashes
  }
  New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
  $manifestPath = Join-Path $BuildDir "build-manifest.json"
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  return $manifestPath
}

function Assert-RuntimePayload {
  param([string]$RuntimeRoot)
  $forbidden = @()
  foreach ($file in @(Get-ChildItem -LiteralPath $RuntimeRoot -Recurse -File -Force)) {
    $relative = $file.FullName.Substring($RuntimeRoot.Length).TrimStart('\').ToLowerInvariant()
    $name = $file.Name.ToLowerInvariant()
    $isAllowedSeed = $name -ceq $CustomerRuntimeSeedName -and $relative -ceq $CustomerRuntimeSeedName
    if ($name -eq "gcapi.dll" -or
        (($name -eq ".env" -or $name -eq "runtime.env" -or $name -eq "production.env") -and -not $isAllowedSeed) -or
        $name -match "onlyoffice|office_runtime|docker-compose|\.pyc$|\.pdb$") {
      $forbidden += $relative
    }
    if ($isAllowedSeed) { Assert-CustomerRuntimeSeed -Path $file.FullName | Out-Null }
  }
  if ($forbidden.Count -gt 0) {
    throw "Runtime payload'ta yasaklı/legacy dosyalar bulundu: $($forbidden -join ', ')"
  }
}

function Resolve-Python {
  if ($Python -and (Test-Path $Python)) { return (Resolve-Path $Python).Path }
  $candidates = @(
    @{ Command = "py"; Args = @("-3") },
    @{ Command = "python"; Args = @() },
    @{ Command = "python3"; Args = @() }
  )
  foreach ($candidate in $candidates) {
    try {
      $version = & $candidate.Command @($candidate.Args) -c "import sys; print(sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $version) { return ([string]$version).Trim() }
    } catch { }
  }
  throw "Python 3 build runtime bulunamadı. Bu yalnızca build makinesinde gereklidir."
}

function Write-ApiSeed {
  $knownKeys = @(Get-CustomerRuntimeSeedAllowedKeys)
  $values = @{}
  $envPath = Join-Path $Root ".env"
  if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw "Customer runtime seed kaynağı bulunamadı; repository .env gerekli"
  }
  foreach ($line in (Get-Content -LiteralPath $envPath -Encoding UTF8 -ErrorAction Stop)) {
    # Case-sensitive matching avoids Turkish-I corruption in Windows
    # PowerShell 5.1 and keeps canonical uppercase key comparison explicit.
    if ($line -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$' -and
        $knownKeys -ccontains $Matches[1] -and
        -not [string]::IsNullOrWhiteSpace([string]$Matches[2])) {
      $values[[string]$Matches[1]] = $line.Trim()
    }
  }
  $missingRequired = @(Get-CustomerRuntimeSeedRequiredKeys | Where-Object { -not $values.ContainsKey($_) })
  if ($missingRequired.Count -gt 0) {
    # Key names are safe diagnostics; values are intentionally never emitted.
    throw "Customer runtime seed zorunlu entegrasyon anahtarları eksik: $($missingRequired -join ', ')"
  }
  $seed = @("# Sero Guld customer integration seed; removed from Program Files after installation.")
  foreach ($key in ($values.Keys | Sort-Object)) { $seed += $values[$key] }
  Set-Content -LiteralPath $SeedPath -Value $seed -Encoding UTF8
  Assert-CustomerRuntimeSeed -Path $SeedPath | Out-Null
}

function Invoke-Python {
  param([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory = $Root)
  Push-Location $WorkingDirectory
  try {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Python build komutu başarısız oldu: $($Arguments -join ' ')" }
  } finally {
    Pop-Location
  }
}

function Start-RuntimeProcess {
  param([string]$Executable, [string]$Mode, [string]$ProgramDataRoot, [int]$SmokePort = 0)
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Executable
  $info.Arguments = $Mode
  $info.WorkingDirectory = Split-Path -Parent $Executable
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.EnvironmentVariables["SEROGULD_PROGRAM_DATA"] = $ProgramDataRoot
  $info.EnvironmentVariables["PYTHONUNBUFFERED"] = "1"
  if ($SmokePort -gt 0) {
    $info.EnvironmentVariables["SEROGULD_RUNTIME_SMOKE_PORT"] = [string]$SmokePort
  }
  return [System.Diagnostics.Process]::Start($info)
}

function Invoke-ExcelProbeSmoke {
  param([string]$RuntimeExe, [string]$ProgramDataRoot)
  # excel-probe tek satir JSON verdict yazmali ve makinede Excel yoksa bile
  # kontrollu bir exit koduyla (0/3) donmelidir.
  $env:SEROGULD_PROGRAM_DATA = $ProgramDataRoot
  $output = & $RuntimeExe excel-probe 2>$null
  $exit = $LASTEXITCODE
  Remove-Item Env:SEROGULD_PROGRAM_DATA -ErrorAction SilentlyContinue
  if ($exit -ne 0 -and $exit -ne 3) {
    throw "excel-probe beklenmeyen exit kodu: $exit"
  }
  $line = ($output | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1)
  if (-not $line) { throw "excel-probe JSON verdict yazmadi" }
  $verdict = $line | ConvertFrom-Json
  if ($null -eq $verdict.available) { throw "excel-probe verdict 'available' alani eksik" }
  Write-Host ("excel-probe smoke OK (available=" + $verdict.available + ")")
}

function Invoke-ExcelBridgeProtocolSmoke {
  param([string]$Executable, [string]$ProgramDataRoot)
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Executable
  $info.Arguments = "excel-bridge"
  $info.WorkingDirectory = Split-Path -Parent $Executable
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.EnvironmentVariables["SEROGULD_PROGRAM_DATA"] = $ProgramDataRoot
  $process = [System.Diagnostics.Process]::Start($info)
  try {
    # The nonexistent path intentionally stops before COM/Excel is loaded.
    # It still proves the packaged executable can receive the bridge JSON over
    # stdin; without a console subsystem PyInstaller exposes stdin as None.
    $process.StandardInput.WriteLine('{"workbook_path":"C:\\__sero_bridge_protocol_smoke_missing__.xlsm"}')
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(15000)) {
      $process.Kill()
      throw "Packaged Excel bridge stdin protocol timeout"
    }
    if ($process.ExitCode -ne 1) {
      throw "Packaged Excel bridge protocol beklenmeyen exit code: $($process.ExitCode)"
    }
  } finally {
    if ($process -and -not $process.HasExited) { $process.Kill() }
    if ($process) { $process.Dispose() }
  }
}

function Assert-PackagedBootstrapLogin {
  param([int]$Port)
  # Exercise the real packaged password handler, not only /health.  This
  # catches a runtime that starts successfully but cannot read the hash format
  # written for the clean-install admin account.
  $bootstrap = Invoke-RestMethod -TimeoutSec 5 -Uri "http://127.0.0.1:$Port/api/auth/bootstrap-state"
  if ([string]$bootstrap.email -ne "info@seroguld.dk" -or -not [bool]$bootstrap.initial_login_pending) {
    throw "Packaged runtime temiz-kurulum bootstrap durumu geçersiz"
  }
  $body = @{ email = "info@seroguld.dk"; password = "admin" } | ConvertTo-Json -Compress
  $login = Invoke-RestMethod -Method Post -TimeoutSec 10 -ContentType "application/json" `
    -Body $body -Uri "http://127.0.0.1:$Port/api/auth/login"
  if ([string]::IsNullOrWhiteSpace([string]$login.access_token) -or
      [string]$login.user.email -ne "info@seroguld.dk" -or
      -not [bool]$login.user.must_change_password) {
    throw "Packaged runtime temiz-kurulum admin girişi başarısız"
  }
}

function Get-FreeLoopbackPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

$sourceHead = Assert-AugustSourceProvenance
$manifestPath = Write-SourceFingerprintManifest -Head $sourceHead
$oneGiB = [int64](1GB)
Assert-FreeSpace -Path $DesktopRuntimeDir -RequiredBytes $oneGiB -Purpose "Windows runtime yayını ve smoke"
$pythonExe = Resolve-Python
foreach ($required in @($SpecPath, $RequirementsPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Windows runtime build girdisi eksik: $required"
  }
}
if (-not (Test-Path -LiteralPath $ReferenceDir -PathType Container)) {
  throw "Referans workbook klasörü bulunamadı: $ReferenceDir"
}
if ((Get-Content -LiteralPath $SpecPath -Raw) -notmatch '(?m)^\s*console\s*=\s*True\s*,?\s*$') {
  throw "PyInstaller runtime console=True olmalı; Excel bridge stdin protokolü korunmadı."
}
$missingTemplates = @($RequiredTemplates | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $ReferenceDir $_) -PathType Leaf)
  })
if ($missingTemplates.Count -gt 0) {
  throw "Gerekli referans workbook'ları eksik: $($missingTemplates -join ', ')"
}
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $DesktopRuntimeDir | Out-Null

try {
  Write-ApiSeed
  if (-not (Test-Path (Join-Path $VenvDir "Scripts\python.exe"))) {
    Invoke-Python -Executable $pythonExe -Arguments @("-m", "venv", $VenvDir)
  }
  $buildPython = Join-Path $VenvDir "Scripts\python.exe"
  Invoke-Python -Executable $buildPython -Arguments @("-m", "pip", "install", "--upgrade", "pip") -WorkingDirectory $BackendDir
  Invoke-Python -Executable $buildPython -Arguments @("-m", "pip", "install", "-r", $RequirementsPath) -WorkingDirectory $BackendDir
  Invoke-Python -Executable $buildPython -Arguments @("-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", $BuildDir, "--workpath", (Join-Path $BuildDir "pyinstaller"), $SpecPath) -WorkingDirectory $BackendDir

  $builtRuntimeDir = Join-Path $BuildDir "seroguld-runtime"
  $builtRuntimeExe = Join-Path $builtRuntimeDir "seroguld-runtime.exe"
  if (-not (Test-Path $builtRuntimeExe)) { throw "PyInstaller runtime çıktısı bulunamadı: $builtRuntimeExe" }
  $packagedReferenceDir = Join-Path $builtRuntimeDir "referans"
  $missingPackagedTemplates = @($RequiredTemplates | Where-Object {
      -not (Test-Path -LiteralPath (Join-Path $packagedReferenceDir $_) -PathType Leaf)
    })
  if ($missingPackagedTemplates.Count -gt 0) {
    throw "Paketlenmiş runtime gerekli referans workbook'larını içermiyor: $($missingPackagedTemplates -join ', ')"
  }
  Assert-RuntimePayload -RuntimeRoot $builtRuntimeDir
  if (-not $SkipSmoke) {
    # SQLite locking over a WSL UNC/project path is not representative of the
    # installed Windows runtime and can fail with `database is locked` before
    # a single migration runs. Exercise the package on a unique local-Windows
    # fixture, matching the actual ProgramData filesystem contract.
    $smokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("SeroGuldRuntimeSmoke-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null
    try {
      $smokePort = Get-FreeLoopbackPort
      $migrate = Start-RuntimeProcess -Executable $builtRuntimeExe -Mode "migrate" -ProgramDataRoot $smokeRoot
      if (-not $migrate.WaitForExit(120000)) { $migrate.Kill(); throw "Packaged runtime migration timeout" }
      if ($migrate.ExitCode -ne 0) { throw "Packaged runtime migration başarısız oldu: $($migrate.ExitCode)" }
      Invoke-ExcelBridgeProtocolSmoke -Executable $builtRuntimeExe -ProgramDataRoot $smokeRoot
      Invoke-ExcelProbeSmoke -RuntimeExe $builtRuntimeExe -ProgramDataRoot $smokeRoot

      $serve = Start-RuntimeProcess -Executable $builtRuntimeExe -Mode "serve" -ProgramDataRoot $smokeRoot -SmokePort $smokePort
      try {
        $deadline = (Get-Date).AddSeconds(30)
        $ready = $false
        while ((Get-Date) -lt $deadline) {
          if ($serve.HasExited) { throw "Packaged runtime serve erken kapandı: exit $($serve.ExitCode)" }
          try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$smokePort/health"
            if ([int]$response.StatusCode -eq 200) { $ready = $true; break }
          } catch { Start-Sleep -Milliseconds 500 }
        }
        if (-not $ready) { throw "Packaged runtime /health 30 saniye içinde hazır olmadı" }
        Assert-PackagedBootstrapLogin -Port $smokePort
      } finally {
        if ($serve -and -not $serve.HasExited) { $serve.Kill(); $serve.WaitForExit(10000) | Out-Null }
      }
    } finally {
      if (Test-Path -LiteralPath $smokeRoot) {
        Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }

  # Publish the canonical sidecar only after every packaged-mode smoke passes;
  # a failed build must never replace the last known-good runtime.
  if (Test-Path $DesktopRuntimeDir) { Remove-Item -LiteralPath $DesktopRuntimeDir -Recurse -Force }
  Copy-Item -LiteralPath $builtRuntimeDir -Destination (Split-Path -Parent $DesktopRuntimeDir) -Recurse -Force
} finally {
  if (Test-Path $SeedPath) { Remove-Item -LiteralPath $SeedPath -Force }
}

Write-Host "Windows onedir runtime hazır: $DesktopRuntimeDir"
Write-Host "Kaynak fingerprint manifesti: $manifestPath"
