param(
  [string]$ApplicationPath = "$env:ProgramFiles\Sero Guld CRM\seroguld_crm_desktop.exe",
  [int]$StartupTimeoutSeconds = 45,
  [string]$ReportPath = "$env:TEMP\seroguld-desktop-acceptance.json",
  [switch]$ForceCloseAfterChecks
)

$ErrorActionPreference = "Stop"
$results = [System.Collections.Generic.List[object]]::new()
$startedProcess = $null

function Add-Result {
  param([string]$Name, [bool]$Passed, [string]$Detail)
  $results.Add([pscustomobject]@{
    name = $Name
    passed = $Passed
    detail = $Detail
  })
}

function Get-ProcessSnapshot {
  $snapshot = @{}
  foreach ($process in @(Get-CimInstance Win32_Process)) {
    $snapshot[[int]$process.ProcessId] = [pscustomobject]@{
      name = [string]$process.Name
      command_line = [string]$process.CommandLine
    }
  }
  return $snapshot
}

function Wait-Until {
  param([scriptblock]$Condition, [int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

if (-not (Test-Path -LiteralPath $ApplicationPath -PathType Leaf)) {
  throw "SERO GULD CRM executable bulunamadı: $ApplicationPath"
}

$before = Get-ProcessSnapshot
# The installed release deliberately ignores SEROGULD_PROGRAM_DATA.  CI may
# set PROGRAMDATA to a disposable runner directory, which exercises the exact
# same canonical `%PROGRAMDATA%\SeroGuldCRM` resolution as production.
$programDataRoot = Join-Path $env:ProgramData "SeroGuldCRM"
$legacyTaskNames = @(
  "SeroGuldTauriDev",
  "Sero Guld CRM Backend",
  "Sero Guld CRM Install Resume"
)

function Test-PrivateRuntimeAcl {
  $runtimeEnv = Join-Path $programDataRoot "config\runtime.env"
  if (-not (Test-Path -LiteralPath $runtimeEnv -PathType Leaf)) {
    return @{ Passed = $false; Detail = "runtime.env bulunamadı" }
  }
  try {
    $whoami = & "$env:SystemRoot\System32\whoami.exe" /user /fo csv /nh 2>$null
    $currentSid = ($whoami -split '[,\"\s]+' | Where-Object { $_ -match '^S-1-' } | Select-Object -First 1)
    $acl = Get-Acl -LiteralPath $runtimeEnv
    $broadSids = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545")
    $seenSids = @($acl.Access | ForEach-Object {
        try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }
        catch { [string]$_.IdentityReference }
      })
    $required = @("S-1-5-18", "S-1-5-32-544", $currentSid)
    $missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace($_) -or $seenSids -notcontains $_ })
    $broad = @($broadSids | Where-Object { $seenSids -contains $_ })
    $protected = [bool]$acl.AreAccessRulesProtected
    if ($missing.Count -gt 0 -or $broad.Count -gt 0 -or -not $protected) {
      return @{ Passed = $false; Detail = "runtime.env ACL geniş veya eksik (secret değerleri raporlanmadı)" }
    }
    return @{ Passed = $true; Detail = "runtime.env ACL SYSTEM/Administrators/interactive user ile sınırlı" }
  } catch {
    return @{ Passed = $false; Detail = "runtime.env ACL doğrulanamadı" }
  }
}

try {
  $installedSeed = Join-Path (Split-Path -Parent $ApplicationPath) "runtime\seroguld-runtime\runtime-seed.env"
  Add-Result "customer-seed-removed" (-not (Test-Path -LiteralPath $installedSeed -PathType Leaf)) "Program Files customer seed mevcut değil"
  $startedProcess = Start-Process -FilePath $ApplicationPath -PassThru

  $healthReady = Wait-Until -TimeoutSeconds $StartupTimeoutSeconds -Condition {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:8100/health"
      return [int]$response.StatusCode -eq 200
    } catch {
      return $false
    }
  }
  Add-Result "backend-health" $healthReady ($(if ($healthReady) { "127.0.0.1:8100/health hazır" } else { "Backend timeout" }))

  $runtimeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'seroguld-runtime.exe'")
  $serveProcesses = @($runtimeProcesses | Where-Object { [string]$_.CommandLine -match "(?:^|\s)serve(?:\s|$)" })
  Add-Result "packaged-runtime" ($serveProcesses.Count -eq 1) "serve process sayısı: $($serveProcesses.Count)"

  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8100 -ErrorAction SilentlyContinue)
  $loopbackOnly = $listeners.Count -gt 0 -and @($listeners | Where-Object {
    $_.LocalAddress -notin @("127.0.0.1", "::1")
  }).Count -eq 0
  Add-Result "loopback-only" $loopbackOnly "listeners: $(@($listeners | ForEach-Object { $_.LocalAddress }) -join ', ')"

  $after = Get-ProcessSnapshot
  $forbiddenNames = @(
    "docker desktop.exe",
    "wsl.exe",
    "python.exe",
    "pythonw.exe",
    "uvicorn.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe"
  )
  $unexpected = @()
  foreach ($entry in $after.GetEnumerator()) {
    if ($before.ContainsKey($entry.Key)) { continue }
    $name = $entry.Value.name.ToLowerInvariant()
    if ($forbiddenNames -contains $name) {
      $unexpected += "$($entry.Value.name)#$($entry.Key)"
    }
  }
  Add-Result "no-forbidden-child-process" ($unexpected.Count -eq 0) ($(if ($unexpected.Count) { $unexpected -join ', ' } else { "Yeni yasak süreç yok" }))

  $remainingTasks = @()
  foreach ($taskName in $legacyTaskNames) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $task) { $remainingTasks += $taskName }
  }
  Add-Result "legacy-tasks-removed" ($remainingTasks.Count -eq 0) ($(if ($remainingTasks.Count) { $remainingTasks -join ', ' } else { "Eski görev yok" }))

  $databasePath = Join-Path $programDataRoot "data\seroguld.db"
  $desktopLog = Join-Path $programDataRoot "logs\desktop.log"
  $backendLog = Join-Path $programDataRoot "logs\backend.log"
  Add-Result "programdata-database" (Test-Path -LiteralPath $databasePath -PathType Leaf) $databasePath
  Add-Result "desktop-log" (Test-Path -LiteralPath $desktopLog -PathType Leaf) $desktopLog
  Add-Result "backend-log" (Test-Path -LiteralPath $backendLog -PathType Leaf) $backendLog
  $runtimeAcl = Test-PrivateRuntimeAcl
  Add-Result "private-runtime-acl" $runtimeAcl.Passed $runtimeAcl.Detail

  if ($null -ne $startedProcess -and -not $startedProcess.HasExited) {
    $null = $startedProcess.CloseMainWindow()
    $closed = $startedProcess.WaitForExit(15000)
    $closeMode = "normal close"
    if (-not $closed -and $ForceCloseAfterChecks -and -not $startedProcess.HasExited) {
      # CI has no operator to confirm the close dialog.  Force-closing this
      # exact installed executable exercises the Windows Job Object fallback;
      # production UI still requires an explicit save/discard decision.
      Stop-Process -Id $startedProcess.Id -Force
      $closed = $startedProcess.WaitForExit(5000)
      $closeMode = "forced CI close"
    }
    Add-Result "application-close" $closed ($(if ($closed) { "Ana pencere kapandı ($closeMode)" } else { "15 saniyede kapanmadı" }))
  }

  $runtimeStopped = Wait-Until -TimeoutSeconds 15 -Condition {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'seroguld-runtime.exe'").Count -eq 0
  }
  Add-Result "runtime-stopped-with-app" $runtimeStopped ($(if ($runtimeStopped) { "Runtime kalmadı" } else { "Runtime hâlâ çalışıyor" }))
} finally {
  $passed = @($results | Where-Object { -not $_.passed }).Count -eq 0
  $report = [pscustomobject]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    application_path = $ApplicationPath
    passed = $passed
    checks = $results
  }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  Write-Host "Kabul raporu: $ReportPath"
}

if (@($results | Where-Object { -not $_.passed }).Count -gt 0) {
  $results | Where-Object { -not $_.passed } | Format-Table -AutoSize
  exit 1
}

$results | Format-Table -AutoSize
