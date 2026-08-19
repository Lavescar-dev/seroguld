[CmdletBinding()]
param(
  [string]$CleanupScript = "",
  [switch]$KeepFixture
)

$ErrorActionPreference = "Stop"

function Assert-Smoke {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "Windows installer smoke başarısız: $Message" }
}

function Write-SmokeFile {
  param([string]$Path, [string]$Content)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  # BOM'suz UTF-8: PS 5.1 Set-Content -Encoding UTF8 BOM yazar; ilk satiri
  # gercek bir anahtar olan env fixture'larinda BOM anahtari bozardi.
  [System.IO.File]::WriteAllText($Path, ($Content + "`n"), [System.Text.UTF8Encoding]::new($false))
}

function Get-ConsoleUserSid {
  $consoleUser = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
  Assert-Smoke (-not [string]::IsNullOrWhiteSpace($consoleUser)) "aktif WTS konsol kullanıcısı yok"
  try {
    return (New-Object System.Security.Principal.NTAccount($consoleUser)).Translate(
      [System.Security.Principal.SecurityIdentifier]
    ).Value
  } catch {
    throw "aktif WTS konsol kullanıcısı SID'e çevrilemedi"
  }
}

function Assert-PrivateAcl {
  param([string]$Path)
  $acl = Get-Acl -LiteralPath $Path
  $sidValues = @($acl.Access | ForEach-Object {
      try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }
      catch { [string]$_.IdentityReference }
    })
  $required = @("S-1-5-18", "S-1-5-32-544", (Get-ConsoleUserSid))
  $missing = @($required | Where-Object { $sidValues -notcontains $_ })
  $broad = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545" | Where-Object { $sidValues -contains $_ })
  Assert-Smoke ($missing.Count -eq 0) "runtime ACL gerekli SID içermez"
  Assert-Smoke ($broad.Count -eq 0) "runtime ACL broad user ACE içeriyor"
  Assert-Smoke ([bool]$acl.AreAccessRulesProtected) "runtime ACL inheritance hâlâ açık"
}

$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRoot)) {
  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($CleanupScript)) {
  $CleanupScript = Join-Path $scriptRoot "..\desktop\src-tauri\windows\seroguld-installer-cleanup.ps1"
}
$powershell = Join-Path $PSHOME "powershell.exe"
if (-not (Test-Path -LiteralPath $powershell -PathType Leaf)) {
  $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
}
Assert-Smoke (Test-Path -LiteralPath $CleanupScript -PathType Leaf) "cleanup script bulunamadı"

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("seroguld-installer-smoke-" + [guid]::NewGuid().ToString("N"))
$fixtureProgramData = Join-Path $fixtureRoot "ProgramData"
$fixtureProfile = Join-Path $fixtureRoot "UserProfile"
$fixtureInstalledRoot = Join-Path $fixtureRoot "InstalledRoot"
$targetRoot = Join-Path $fixtureProgramData "SeroGuldCRM"
$legacyRoot = Join-Path $fixtureProfile "Clients\Recai_Demir\seroguld-crm-windows"
$latestLegacyRoot = Join-Path $fixtureProfile "Clients\Recai_Demir\seroguld-crm-latest-windows"
$runtimeEnv = Join-Path $targetRoot "config\runtime.env"
$productionEnv = Join-Path $targetRoot "config\production.env"
$apiSeedEnv = Join-Path $targetRoot "config\api-seed.env"
$customerSeed = Join-Path $fixtureInstalledRoot "runtime\seroguld-runtime\runtime-seed.env"
$installerLog = Join-Path $targetRoot "logs\installer-cleanup.log"
$targetDb = Join-Path $targetRoot "data\seroguld.db"
$targetExistingDocument = Join-Path $targetRoot "documents\existing.txt"
$legacyDocument = Join-Path $legacyRoot "documents\legacy.txt"
$legacyDataDocument = Join-Path $legacyRoot "data\documents\legacy-data.txt"
$legacyDb = Join-Path $legacyRoot "data\desktop.db"
$legacyOnlyOfficeEnv = Join-Path $legacyRoot "office-runtime\onlyoffice.env"
$legacyCompose = Join-Path $legacyRoot "docker-compose.onlyoffice.yml"
$legacyOfficeCompose = Join-Path $legacyRoot "docker-compose.office.yml"
$legacyComposeAlias = Join-Path $legacyRoot "compose.onlyoffice.yml"
$legacyRunOnlyOfficeEnv = Join-Path $legacyRoot ".run\office-runtime\onlyoffice.env"
$oldProgramData = $env:ProgramData
$oldUserProfile = $env:USERPROFILE
$oldPath = $env:Path
$purchaseVatCode25 = "K$([char]0x00F8)bsmoms"
$purchaseVatCode0 = "K$([char]0x00F8)bBrugtmoms"

try {
  New-Item -ItemType Directory -Force -Path $fixtureInstalledRoot | Out-Null
  # Explicitly exercise the culture-sensitive ASCII-I case. The cleanup child
  # runs under tr-TR even when CI's Windows image uses en-US.
  Write-SmokeFile -Path $targetDb -Content "existing-customer-db"
  Write-SmokeFile -Path $runtimeEnv -Content @"
FIELD_ENCRYPTION_KEY=smoke-only-key-never-log-this-value
WOOCOMMERCE_CONSUMER_KEY=runtime-key-must-win
WP_APP_PASSWORD=
"@
  Write-SmokeFile -Path $productionEnv -Content @"
FIELD_ENCRYPTION_KEY=smoke-only-key-never-log-this-value
WOOCOMMERCE_BASE_URL=https://example.invalid/wp-json/wc/v3
WOOCOMMERCE_CONSUMER_KEY=production-key-must-not-win
INVOICE_SELLER_NAME=Smoke Seller
INITIAL_ADMIN_PASSWORD=must-not-migrate
"@
  Write-SmokeFile -Path $apiSeedEnv -Content @"
UNICONTA_API_URL=https://api.example.invalid
UNICONTA_USERNAME=api-seed-user
UNICONTA_PASSWORD=api-seed-password
UNICONTA_COMPANY_ID=55606
UNICONTA_API_KEY=api-seed-key
UNICONTA_SEND_EMAIL_ON_FINALIZE=false
UNICONTA_SEND_XML_ON_FINALIZE=false
UNICONTA_PURCHASE_VAT_CODE_25=$purchaseVatCode25
UNICONTA_PURCHASE_VAT_CODE_0=$purchaseVatCode0
WOOCOMMERCE_TIMEOUT_SECONDS=23
INVENTORY_MARKET_GOLD_DKK=2999
MARKET_RATES_LIVE_ENABLED=false
"@
  Write-SmokeFile -Path (Join-Path $latestLegacyRoot ".env") -Content @"
OPENAI_API_KEY=legacy-openai-key
UNICONTA_USERNAME=legacy-user-must-not-win
"@
  Write-SmokeFile -Path $customerSeed -Content @"
OPMC_API_KEY=installer-opmc-key
WP_APP_PASSWORD=installer-password-must-not-resurrect-empty
UNICONTA_USERNAME=installer-user-must-not-win
"@
  Write-SmokeFile -Path $targetExistingDocument -Content "existing-document"
  Write-SmokeFile -Path $legacyDocument -Content "legacy-document"
  Write-SmokeFile -Path $legacyDataDocument -Content "legacy-data-document"
  Write-SmokeFile -Path $legacyDb -Content "legacy-db-must-not-overwrite"
  Write-SmokeFile -Path $legacyOnlyOfficeEnv -Content "legacy-onlyoffice-secret=must-remove"
  Write-SmokeFile -Path $legacyCompose -Content "services: {}"
  Write-SmokeFile -Path $legacyOfficeCompose -Content "services: {}"
  Write-SmokeFile -Path $legacyComposeAlias -Content "services: {}"
  Write-SmokeFile -Path $legacyRunOnlyOfficeEnv -Content "legacy-onlyoffice-secret=must-remove"

  $liveProgramData = [Environment]::GetEnvironmentVariable("ProgramData", "Machine")
  if ([string]::IsNullOrWhiteSpace($liveProgramData)) { $liveProgramData = $oldProgramData }
  Assert-Smoke (-not [string]::Equals(
      ([System.IO.Path]::GetFullPath($fixtureProgramData)).TrimEnd('\'),
      ([System.IO.Path]::GetFullPath($liveProgramData)).TrimEnd('\'),
      [StringComparison]::OrdinalIgnoreCase
    )) "fixture ProgramData canlı ProgramData ile aynı"

  # A System32-only PATH makes Get-Command docker.exe return no command even
  # on a machine that has Docker installed. The cleanup script must still
  # remove the exact old files while skipping daemon/container operations.
  $env:ProgramData = $fixtureProgramData
  $env:USERPROFILE = $fixtureProfile
  $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
  & $powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $CleanupScript `
    -Mode PostInstall -InstalledRoot $fixtureInstalledRoot -FixtureOnly -FixtureCulture tr-TR
  if ($LASTEXITCODE -ne 0) { throw "isolated cleanup child process başarısız oldu: $LASTEXITCODE" }

  $runtimeContent = Get-Content -LiteralPath $runtimeEnv -Encoding UTF8 -Raw
  Assert-Smoke ($runtimeContent -cmatch '(?m)^FIELD_ENCRYPTION_KEY=smoke-only-key-never-log-this-value\s*$') `
    "geçerli mevcut şifreleme anahtarı tr-TR altında korunmadı"
  Assert-Smoke ($runtimeContent -cmatch '(?m)^WOOCOMMERCE_BASE_URL=https://example\.invalid/wp-json/wc/v3\s*$') `
    "whitelist entegrasyon seed'i ProgramData'ya alınmadı"
  Assert-Smoke ($runtimeContent -cmatch '(?m)^WOOCOMMERCE_CONSUMER_KEY=runtime-key-must-win\s*$') `
    "mevcut runtime anahtarı düşük öncelikli kaynakla değiştirildi"
  Assert-Smoke ($runtimeContent -cmatch '(?m)^WP_APP_PASSWORD=\s*$') `
    "bilerek boşaltılmış mevcut runtime anahtarı yeniden dolduruldu"
  foreach ($expected in @(
      'WOOCOMMERCE_TIMEOUT_SECONDS=23', 'INVOICE_SELLER_NAME=Smoke Seller',
      'INVENTORY_MARKET_GOLD_DKK=2999', 'MARKET_RATES_LIVE_ENABLED=false', 'UNICONTA_API_URL=https://api.example.invalid',
      'UNICONTA_USERNAME=api-seed-user', 'UNICONTA_PASSWORD=api-seed-password',
      'UNICONTA_COMPANY_ID=55606', 'UNICONTA_API_KEY=api-seed-key',
      "UNICONTA_PURCHASE_VAT_CODE_25=$purchaseVatCode25", "UNICONTA_PURCHASE_VAT_CODE_0=$purchaseVatCode0",
      'OPENAI_API_KEY=legacy-openai-key', 'OPMC_API_KEY=installer-opmc-key'
    )) {
    Assert-Smoke ($runtimeContent -cmatch ("(?m)^" + [regex]::Escape($expected) + '\s*$')) `
      "tr-TR/öncelik runtime taşıması eksik: $($expected.Split('=')[0])"
  }
  Assert-Smoke ($runtimeContent -cnotmatch '(?m)^INITIAL_ADMIN_PASSWORD=') `
    "bootstrap parolası runtime.env'e taşındı"
  Assert-Smoke (-not (Test-Path -LiteralPath $customerSeed -PathType Leaf)) `
    "müşteri runtime seed'i PostInstall sonrasında Program Files fixture'ında kaldı"
  Assert-Smoke (@(Get-ChildItem -LiteralPath (Split-Path -Parent $runtimeEnv) -Filter 'runtime.env.pre-key-recovery-*.bak' -File -ErrorAction SilentlyContinue).Count -eq 0) `
    "geçerli mevcut FIELD_ENCRYPTION_KEY gereksiz recovery yedeği üretti"
  $logContent = Get-Content -LiteralPath $installerLog -Raw
  foreach ($forbiddenLogValue in @('api-seed-password', 'api-seed-key', 'legacy-openai-key', 'installer-opmc-key', 'smoke-only-key-never-log-this-value')) {
    Assert-Smoke (-not $logContent.Contains($forbiddenLogValue)) "installer log gizli değer içeriyor"
  }
  Assert-Smoke ((Get-Content -LiteralPath $targetDb -Raw) -eq "existing-customer-db`r`n") `
    "mevcut müşteri DB'si değiştirildi"
  Assert-Smoke ((Get-Content -LiteralPath $targetExistingDocument -Raw) -eq "existing-document`r`n") `
    "mevcut müşteri belgesi değiştirildi"
  Assert-Smoke ((Get-Content -LiteralPath (Join-Path $targetRoot "documents\legacy.txt") -Raw) -eq "legacy-document`r`n") `
    "legacy belge korunarak kopyalanmadı"
  Assert-Smoke ((Get-Content -LiteralPath (Join-Path $targetRoot "documents\legacy-data.txt") -Raw) -eq "legacy-data-document`r`n") `
    "legacy data belgesi korunarak kopyalanmadı"

  foreach ($legacyFile in @($legacyOnlyOfficeEnv, $legacyCompose, $legacyOfficeCompose, $legacyComposeAlias, $legacyRunOnlyOfficeEnv)) {
    Assert-Smoke (-not (Test-Path -LiteralPath $legacyFile -PathType Leaf)) "Docker yokken exact legacy dosya silinmedi: $legacyFile"
  }
  Assert-PrivateAcl -Path $runtimeEnv
  Assert-PrivateAcl -Path $targetDb
  Assert-PrivateAcl -Path $targetExistingDocument
  Assert-PrivateAcl -Path (Join-Path $targetRoot "documents\legacy.txt")
  Write-Host "Windows installer isolated smoke: PASSED (canlı ProgramData/Downloads kullanılmadı)"
} finally {
  $env:ProgramData = $oldProgramData
  $env:USERPROFILE = $oldUserProfile
  $env:Path = $oldPath
  if ($KeepFixture) {
    Write-Host "Smoke fixture korunuyor: $fixtureRoot"
  } elseif (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
