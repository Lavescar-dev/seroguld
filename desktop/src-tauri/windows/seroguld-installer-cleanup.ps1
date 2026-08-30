param(
  [ValidateSet("PreInstall", "PostInstall", "PreUninstall")]
  [string]$Mode = "PostInstall",
  [string]$InstalledRoot = "",
  # Test harness only.  NSIS never passes this switch; it prevents the
  # isolated fixture smoke from querying/stopping host tasks, processes,
  # ports, or Docker resources while still exercising data/config migration.
  [switch]$FixtureOnly,
  [string]$FixtureCulture = ""
)

$ErrorActionPreference = "Stop"
if (-not [string]::IsNullOrWhiteSpace($FixtureCulture)) {
  if (-not $FixtureOnly) { throw "FixtureCulture yalnız FixtureOnly testinde kullanılabilir" }
  $culture = [Globalization.CultureInfo]::GetCultureInfo($FixtureCulture)
  [Threading.Thread]::CurrentThread.CurrentCulture = $culture
  [Threading.Thread]::CurrentThread.CurrentUICulture = $culture
}
$script:LegacyDatabaseSourceRoot = $null
$script:CustomerRuntimeSeedRelativePath = "runtime\seroguld-runtime\runtime-seed.env"

function Get-ActiveUserProfilePath {
  if ($FixtureOnly) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) { throw "Fixture kullanıcı profili bulunamadı" }
    return [System.IO.Path]::GetFullPath($env:USERPROFILE)
  }
  $consoleUser = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
  if ([string]::IsNullOrWhiteSpace($consoleUser)) { throw "Aktif WTS konsol kullanıcısı bulunamadı" }
  try {
    $account = New-Object -TypeName System.Security.Principal.NTAccount -ArgumentList $consoleUser
    $sid = $account.Translate([System.Security.Principal.SecurityIdentifier]).Value
    $profileKey = "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid"
    $profile = [string](Get-ItemPropertyValue -LiteralPath $profileKey -Name ProfileImagePath -ErrorAction Stop)
    $expanded = [Environment]::ExpandEnvironmentVariables($profile)
    if ([string]::IsNullOrWhiteSpace($expanded)) { throw "empty profile" }
    return [System.IO.Path]::GetFullPath($expanded)
  } catch {
    throw "Aktif WTS konsol kullanıcısı profili doğrulanamadı"
  }
}

function Get-LegacyProjectRoots {
  $profile = Get-ActiveUserProfilePath
  return @(
    (Join-Path $profile "Clients\Recai_Demir\seroguld-crm-latest-windows"),
    (Join-Path $profile "Clients\Recai_Demir\seroguld-crm-windows"),
    (Join-Path $profile "Clients\Recai_Demir\seroguld-crm")
  )
}

function Write-CleanupLog {
  param([string]$Message)
  $base = if ([string]::IsNullOrWhiteSpace($env:ProgramData)) { $env:TEMP } else { $env:ProgramData }
  if ([string]::IsNullOrWhiteSpace($base)) { return }
  $logPath = Join-Path $base "SeroGuldCRM\logs\installer-cleanup.log"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message"
}

function Write-TextFileAtomically {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Lines
  )
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ("." + [System.IO.Path]::GetFileName($Path) + "." + [guid]::NewGuid().ToString("N") + ".tmp")
  $replacementBackup = "$temporary.replace-backup"
  try {
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllLines($temporary, [string[]]$Lines, $encoding)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      [System.IO.File]::Replace($temporary, $Path, $replacementBackup, $true)
    } else {
      [System.IO.File]::Move($temporary, $Path)
    }
  } finally {
    if (Test-Path -LiteralPath $temporary -PathType Leaf) {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $replacementBackup -PathType Leaf) {
      Remove-Item -LiteralPath $replacementBackup -Force -ErrorAction SilentlyContinue
    }
  }
}

function Assert-InstalledSeroGuldClosed {
  # Upgrades/uninstall must never terminate the current packaged app or its
  # runtime: an open workbook may still contain unsynchronised edits.  Fail
  # closed and let the user close it safely instead of overwriting locked files
  # or claiming that a data-loss-prone force close was successful.
  try {
    $expectedPaths = @()
    if (-not [string]::IsNullOrWhiteSpace($InstalledRoot)) {
      $expectedPaths += (Join-Path $InstalledRoot "seroguld_crm_desktop.exe")
      $expectedPaths += (Join-Path $InstalledRoot "runtime\seroguld-runtime\seroguld-runtime.exe")
    }
    $expectedPaths = @($expectedPaths | ForEach-Object {
        try { [System.IO.Path]::GetFullPath($_).TrimEnd('\').ToLowerInvariant() } catch { $null }
      } | Where-Object { $_ })
    $running = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $name = ([string]$_.Name).Trim()
        if ([int]$_.ProcessId -eq $PID) { return $false }
        if ($name -ine "seroguld_crm_desktop.exe" -and $name -ine "seroguld-runtime.exe") { return $false }
        if ($expectedPaths.Count -eq 0) { return $true }
        $path = [string]$_.ExecutablePath
        # Same-name processes with an unreadable executable path are not
        # attributable to this install.  Leave them alone; cleanup must never
        # guess ownership from a process name alone.
        if ([string]::IsNullOrWhiteSpace($path)) { return $false }
        try { $expectedPaths -contains ([System.IO.Path]::GetFullPath($path).TrimEnd('\').ToLowerInvariant()) } catch { $false }
      })
  } catch {
    throw "Çalışan Sero Guld uygulaması doğrulanamadı; güvenli kapatmadan kurulum sürdürülemez"
  }
  if ($running.Count -gt 0) {
    $description = @($running | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ", "
    Write-CleanupLog "Kurulum öncesi çalışan Sero Guld süreci bulundu: $description"
    throw "Sero Guld CRM çalışıyor; kuruluma devam etmeden önce uygulamayı güvenle kapatın"
  }
}

function Inspect-LegacyPorts {
  $getConnections = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
  if ($null -eq $getConnections) {
    throw "Yerel backend portu güvenli biçimde denetlenemedi; kurulum durduruldu"
  }
  $connections = @(Get-NetTCPConnection -State Listen -LocalPort @(8100, 8082) -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) {
    Write-CleanupLog "Legacy Sero Guld ports 8100/8082 have no listeners"
    return
  }
  foreach ($connection in $connections) {
    $ownerPid = [int]$connection.OwningProcess
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
    if ($null -eq $process) {
      Write-CleanupLog "Port $($connection.LocalPort) owner PID $ownerPid disappeared"
      continue
    }
    $name = [string]$process.Name
    $commandLine = [string]$process.CommandLine
    $allowedNames = @("python.exe", "pythonw.exe", "uvicorn.exe", "powershell.exe", "pwsh.exe", "node.exe")
    $isAllowedName = $allowedNames -contains $name.ToLowerInvariant()
    $isSeroGuld = $commandLine -match "SeroGuldCRM" -and $commandLine -match "app\.main:app"
    if ($isAllowedName -and $isSeroGuld) {
      Write-CleanupLog "Port $($connection.LocalPort) eligible legacy PID $ownerPid ($name)"
    } else {
      Write-CleanupLog "Port $($connection.LocalPort) skipped foreign PID $ownerPid ($name)"
    }
  }
}

function Assert-PackagedBackendPortFree {
  $getConnections = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
  if ($null -eq $getConnections) {
    throw "Yerel backend portu güvenli biçimde denetlenemedi; kurulum durduruldu"
  }
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8100 -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) {
    Write-CleanupLog "Packaged backend port 8100 is free"
    return
  }
  # An updater-driven upgrade launches NSIS PreInstall while the previous app
  # instance is still shutting its packaged backend down.  Give the port a
  # bounded drain window instead of failing the install on the first check.
  $owners = @($listeners | ForEach-Object { [string]$_.OwningProcess } | Sort-Object -Unique) -join ', '
  Write-CleanupLog "Packaged backend port 8100 is occupied by PID(s): $owners; waiting up to 30s for it to drain"
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 1
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8100 -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) {
      Write-CleanupLog "Packaged backend port 8100 drained while waiting"
      return
    }
  } while ((Get-Date) -lt $deadline)
  $owners = @($listeners | ForEach-Object { [string]$_.OwningProcess } | Sort-Object -Unique) -join ', '
  Write-CleanupLog "Packaged backend port 8100 remains occupied by PID(s): $owners"
  throw "Sero Guld yerel backend portu 8100 kullanımda; kuruluma devam edilemiyor"
}

function Stop-LegacyTasks {
  $taskNames = @(
    "SeroGuldTauriDev",
    "Sero Guld CRM Backend",
    "Sero Guld CRM Install Resume"
  )
  $tasks = @($taskNames | ForEach-Object {
      Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue
    } | Where-Object { $taskNames -contains ([string]$_.TaskName) })

  # Resolve the exact registered action before stopping the task.  Task
  # Scheduler does not expose its child PID, so action matching is deliberately
  # limited to these three fixed task names, the registered executable and its
  # full argument fragment.  This lets us close the task-owned process tree
  # without touching an unrelated PowerShell/Python process.
  $taskProcessIds = @(Get-LegacyTaskProcessIds -Tasks $tasks)
  foreach ($task in $tasks) {
    Stop-ScheduledTask -InputObject $task -ErrorAction SilentlyContinue
  }
  Stop-ProcessIds -ProcessIds $taskProcessIds
  foreach ($task in $tasks) {
    Unregister-ScheduledTask -InputObject $task -Confirm:$false -ErrorAction SilentlyContinue
  }

  # A legacy backend may have been launched manually or reparented before the
  # task was inspected.  The separate direct-process rule remains narrower:
  # both SeroGuldCRM and app.main:app must occur in its command line.
  Stop-LegacyBackendProcesses
  $remaining = @($taskNames | Where-Object {
      $null -ne (Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue)
    })
  if ($remaining.Count -gt 0) {
    Write-CleanupLog "Legacy tasks remain after cleanup: $($remaining -join ', ')"
    throw "Sero Guld legacy scheduled task temizlenemedi: $($remaining -join ', ')"
  }
}

function Normalize-TaskCommandFragment {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $expanded = [Environment]::ExpandEnvironmentVariables($Value).Trim().ToLowerInvariant()
  $withoutQuotes = $expanded.Replace('"', '').Replace("'", '')
  return ([regex]::Replace($withoutQuotes, '\s+', ' ')).Trim()
}

function Get-LegacyTaskProcessIds {
  param([object[]]$Tasks)
  if ($null -eq $Tasks -or $Tasks.Count -eq 0) { return @() }
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $targetIds = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($task in $Tasks) {
    foreach ($action in @($task.Actions)) {
      $execute = [Environment]::ExpandEnvironmentVariables(([string]$action.Execute).Trim().Trim('"').Trim("'"))
      $arguments = Normalize-TaskCommandFragment ([string]$action.Arguments)
      # An argument-less generic host action (for example powershell.exe) is
      # not unique enough to attribute safely.  Stop-ScheduledTask still ends
      # the task itself; no foreign host process is guessed here.
      if ([string]::IsNullOrWhiteSpace($execute) -or [string]::IsNullOrWhiteSpace($arguments)) { continue }
      $executeName = [System.IO.Path]::GetFileName($execute)
      foreach ($process in $processes) {
        if (([string]$process.Name) -ine $executeName) { continue }
        $commandLine = Normalize-TaskCommandFragment ([string]$process.CommandLine)
        if (-not $commandLine.Contains($arguments)) { continue }
        [void]$targetIds.Add([int]$process.ProcessId)
      }
    }
  }
  # Capture descendants before Stop-ScheduledTask can terminate/reparent the
  # root action.  Descendant executable names and arguments are irrelevant once
  # their ancestry has been proven from the exact registered action.
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $processes) {
      if ($targetIds.Contains([int]$process.ParentProcessId) -and $targetIds.Add([int]$process.ProcessId)) {
        $changed = $true
      }
    }
  }
  return @($targetIds)
}

function Stop-ProcessIds {
  param([int[]]$ProcessIds)
  foreach ($processId in @($ProcessIds | Where-Object { $_ -gt 0 -and $_ -ne $PID } | Sort-Object -Descending)) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

function Get-LegacyBackendProcesses {
  $processes = @(Get-CimInstance Win32_Process)
  $allowedNames = @("python.exe", "pythonw.exe", "uvicorn.exe", "powershell.exe", "pwsh.exe", "node.exe")
  $targetIds = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($process in $processes) {
    if ($allowedNames -notcontains ([string]$process.Name).ToLowerInvariant()) { continue }
    $commandLine = [string]$process.CommandLine
    $isSeroGuld = $commandLine -match "SeroGuldCRM" -and $commandLine -match "app\.main:app"
    if ($isSeroGuld) {
      [void]$targetIds.Add([int]$process.ProcessId)
    }
  }
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $processes) {
      if ($targetIds.Contains([int]$process.ParentProcessId) -and $targetIds.Add([int]$process.ProcessId)) {
        $changed = $true
      }
    }
  }
  return @($processes | Where-Object { $targetIds.Contains([int]$_.ProcessId) })
}

function Stop-LegacyBackendProcesses {
  $targets = @(Get-LegacyBackendProcesses)
  foreach ($processId in @($targets | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Descending)) {
    # The process may exit between the CIM snapshot and this exact stop.  EAP
    # is Stop for the installer, so make that benign race explicit and rely on
    # the bounded post-stop query below for the real success condition.
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds(5)
  do {
    $remaining = @(Get-LegacyBackendProcesses)
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  $remaining = @(Get-LegacyBackendProcesses)
  if ($remaining.Count -gt 0) {
    $description = @($remaining | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ", "
    Write-CleanupLog "Legacy backend processes remain after cleanup: $description"
    throw "Sero Guld eski backend süreçleri temizlenemedi"
  }
}

function Stop-LegacyProcessDescendants {
  # Kept as an explicit alias so cleanup remains auditable in installer logs.
  Stop-LegacyBackendProcesses
}

function Remove-SeroGuldDockerResources {
  $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($null -eq $docker) { return $false }

  # Querying the daemon is deliberately the only Docker operation used as a
  # precondition.  The installer never starts, installs, upgrades, or
  # uninstalls Docker; an unavailable daemon means the legacy files remain
  # untouched and the customer data stays recoverable.
  try {
    & $docker.Source info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
  } catch {
    return $false
  }

  # These are the exact resources created by the CRM's old compose setup.
  # Inspect first so a missing resource is a successful no-op, then verify
  # removal. Do not broaden either match: another project may legitimately use
  # a similar OnlyOffice container/network and must never be touched.
  $containerId = & $docker.Source container inspect --format '{{.Id}}' "seroguld-onlyoffice-desktop" 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($containerId -join "").Trim())) {
    & $docker.Source rm -f "seroguld-onlyoffice-desktop" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Sero Guld legacy Docker container temizlenemedi"
    }
    $remainingContainer = & $docker.Source container inspect --format '{{.Id}}' "seroguld-onlyoffice-desktop" 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($remainingContainer -join "").Trim())) {
      throw "Sero Guld legacy Docker container kaldırıldıktan sonra hâlâ mevcut"
    }
  }
  foreach ($network in @("office-runtime_default")) {
    $networkId = & $docker.Source network inspect --format '{{.Id}}' $network 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($networkId -join "").Trim())) {
      continue
    }
    & $docker.Source network rm $network | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Sero Guld legacy Docker network temizlenemedi: $network"
    }
    $remainingNetwork = & $docker.Source network inspect --format '{{.Id}}' $network 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($remainingNetwork -join "").Trim())) {
      throw "Sero Guld legacy Docker network kaldırıldıktan sonra hâlâ mevcut: $network"
    }
  }
  return $true
}

function Remove-LegacyOfficeFiles {
  $legacyRoots = @(Get-LegacyProjectRoots)
  foreach ($root in $legacyRoots) {
    foreach ($relativePath in @(
      "office-runtime\onlyoffice.env",
      ".run\office-runtime\onlyoffice.env",
      "docker-compose.onlyoffice.yml",
      "docker-compose.office.yml",
      "compose.onlyoffice.yml"
    )) {
      $path = Join-Path $root $relativePath
      if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
      }
    }
  }
}

function Copy-TreePreservingExisting {
  param([string]$Source, [string]$Destination)
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
  $sourceItem = Get-Item -LiteralPath $Source -Force
  if (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Legacy veri ağacında junction/symlink bulundu; güvenli kopyalama durduruldu"
  }
  if (-not (Test-Path -LiteralPath $Destination)) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  } else {
    $destinationItem = Get-Item -LiteralPath $Destination -Force
    if (($destinationItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "ProgramData hedefinde junction/symlink bulundu; güvenli kopyalama durduruldu"
    }
  }
  # Merge only missing entries.  A runtime-created ProgramData directory may
  # already contain an empty `working` folder (or new files), so treating any
  # non-empty destination as a reason to skip the whole tree can strand old
  # customer documents during an upgrade.  Existing files are never replaced.
  foreach ($item in @(Get-ChildItem -LiteralPath $Source -Force)) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Legacy veri ağacında junction/symlink bulundu; güvenli kopyalama durduruldu"
    }
    $destinationItem = Join-Path $Destination $item.Name
    if ($item.PSIsContainer) {
      Copy-TreePreservingExisting $item.FullName $destinationItem
    } elseif (-not (Test-Path -LiteralPath $destinationItem)) {
      Copy-Item -LiteralPath $item.FullName -Destination $destinationItem -Force
    }
  }
}

function Test-UsableFieldEncryptionKey {
  param([AllowNull()][string]$Value)
  $candidate = ([string]$Value).Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) { return $false }
  if ($candidate -in @("change-me", "change-me-32-byte-base64-key")) { return $false }
  # The packaged runtime deliberately supports deterministic legacy secrets
  # as well as current 32-byte base64 values. Keep this test identical to its
  # fail-closed minimum so an upgrade never replaces a usable historical key.
  return $candidate.Length -ge 16
}

function Get-LegacyFieldEncryptionKeys {
  param([string[]]$Roots)
  $keys = @()
  foreach ($root in $Roots) {
    foreach ($sourceFile in @(
      (Join-Path $root ".env"),
      (Join-Path $root "config\runtime.env"),
      (Join-Path $root "config\production.env"),
      (Join-Path $root ".run\runtime.env")
      )) {
      if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { continue }
      foreach ($line in (Get-Content -LiteralPath $sourceFile -Encoding UTF8)) {
        if ($line -cmatch '^\s*FIELD_ENCRYPTION_KEY=(.+)$' -and (Test-UsableFieldEncryptionKey $Matches[1])) {
          $keys += $Matches[1].Trim()
        }
      }
    }
  }
  return @($keys | Sort-Object -Unique)
}

function Preserve-LegacyData {
  $programData = $env:ProgramData
  if ([string]::IsNullOrWhiteSpace($programData)) { return }
  $targetRoot = Join-Path $programData "SeroGuldCRM"
  $legacyRoots = @(Get-LegacyProjectRoots)
  foreach ($sourceRoot in $legacyRoots) {
    $targetDb = Join-Path $targetRoot "data\seroguld.db"
    $targetDbItem = Get-Item -LiteralPath $targetDb -ErrorAction SilentlyContinue
    if ($null -eq $targetDbItem -or $targetDbItem.Length -eq 0) {
      foreach ($relativeDb in @(
        "data\desktop.db",
        "data\seroguld.db",
        "backend\data\desktop.db",
        "backend\data\seroguld.db"
      )) {
        $sourceDb = Join-Path $sourceRoot $relativeDb
        if (Test-Path -LiteralPath $sourceDb -PathType Leaf) {
          New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetDb) | Out-Null
          Copy-Item -LiteralPath $sourceDb -Destination $targetDb -Force
          $script:LegacyDatabaseSourceRoot = $sourceRoot
          foreach ($suffix in @("-wal", "-shm")) {
            $sourceSidecar = "$sourceDb$suffix"
            $targetSidecar = "$targetDb$suffix"
            if (Test-Path -LiteralPath $targetSidecar -PathType Leaf) {
              # The main target was empty, but a previous interrupted
              # migration may have left a stale sidecar behind.  Preserve it
              # as a recoverable backup before pairing the adopted DB with any
              # source WAL/SHM files (or deliberately leaving that sidecar
              # absent when the source has no matching file).
              $sidecarBackup = "$targetSidecar.pre-legacy-$(Get-Date -Format yyyyMMddHHmmssfff).bak"
              Move-Item -LiteralPath $targetSidecar -Destination $sidecarBackup -Force
              Write-CleanupLog "Existing empty-target SQLite sidecar moved to recoverable backup"
            }
            if (Test-Path -LiteralPath $sourceSidecar -PathType Leaf) {
              Copy-Item -LiteralPath $sourceSidecar -Destination $targetSidecar -Force
            }
          }
          break
        }
      }
    }
  }
  $dataMappings = @{
    "documents" = "documents"
    "data\documents" = "documents"
    "data\uploads" = "data\uploads"
    "data\backups" = "data\backups"
    "data\restore-drill" = "data\restore-drill"
    "backend\data\documents" = "documents"
    "backend\data\uploads" = "data\uploads"
    "backend\data\backups" = "data\backups"
    "backend\data\restore-drill" = "data\restore-drill"
  }
  foreach ($sourceName in $dataMappings.Keys) {
    $targetName = $dataMappings[$sourceName]
    foreach ($sourceRoot in $legacyRoots) {
      $sourcePath = Join-Path $sourceRoot $sourceName
      if (Test-Path -LiteralPath $sourcePath -PathType Container) {
        Copy-TreePreservingExisting $sourcePath (Join-Path $targetRoot $targetName)
      }
    }
  }
}

function Preserve-LegacyRuntimeSettings {
  $programData = $env:ProgramData
  if ([string]::IsNullOrWhiteSpace($programData)) { return }
  $targetRoot = Join-Path $programData "SeroGuldCRM"
  $targetFile = Join-Path $targetRoot "config\runtime.env"
  $allowedKeys = @(
    "FIELD_ENCRYPTION_KEY", "KDS_ADDRESS_BASE_URL", "KDS_ADDRESS_TOKEN", "KDS_ADDRESS_TIMEOUT_SECONDS",
    "KDS_ADDRESS_CACHE_SECONDS", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT", "OPENAI_MAX_TOKENS",
    "OPENAI_TIMEOUT_SECONDS", "OPMC_API_URL", "OPMC_API_KEY", "OPMC_WEBHOOK_SECRET", "WOOCOMMERCE_BASE_URL",
    "WOOCOMMERCE_CONSUMER_KEY", "WOOCOMMERCE_CONSUMER_SECRET", "WOOCOMMERCE_WEBHOOK_SECRET", "WOOCOMMERCE_TIMEOUT_SECONDS", "WORDPRESS_BASE_URL",
    "WP_APP_USERNAME", "WP_APP_PASSWORD", "UNICONTA_API_URL", "UNICONTA_USERNAME", "UNICONTA_PASSWORD",
    "UNICONTA_COMPANY_ID", "UNICONTA_API_KEY", "UNICONTA_SEND_EMAIL_ON_FINALIZE", "UNICONTA_SEND_XML_ON_FINALIZE",
    "UNICONTA_PURCHASE_VAT_CODE_25", "UNICONTA_PURCHASE_VAT_CODE_0",
    "INVOICE_NUMBER_PREFIX", "INVOICE_DEFAULT_CURRENCY", "INVOICE_SALE_VAT_RATE_PERCENT", "INVOICE_SELLER_NAME",
    "INVOICE_SELLER_ADDRESS_LINE1", "INVOICE_SELLER_POSTAL_CODE", "INVOICE_SELLER_CITY", "INVOICE_SELLER_COUNTRY",
    "INVOICE_SELLER_CVR", "INVOICE_SELLER_EMAIL", "INVOICE_SELLER_PHONE", "POS_REFERENCE_START",
    "POS_REFERENCE_SCAN_WINDOW", "MARKET_RATES_LIVE_ENABLED", "MARKET_RATES_LIVE_FX_ENABLED", "MARKET_RATES_LIVE_PLATINUM_ENABLED", "MARKET_RATES_LIVE_PALLADIUM_ENABLED", "GOLD_PRICE_LIVE_ENABLED", "GOLD_PRICE_TIMEOUT_SECONDS", "GOLD_PRICE_CACHE_SECONDS", "METALS_DEV_API_KEY", "METALS_DEV_URL", "METALS_DEV_TIMEOUT_SECONDS", "METALS_DEV_CACHE_SECONDS",
    "INVENTORY_MARKET_GOLD_DKK", "INVENTORY_MARKET_SILVER_DKK", "INVENTORY_MARKET_PLATINUM_DKK", "INVENTORY_MARKET_PALLADIUM_DKK"
  )
  $legacyRoots = @(Get-LegacyProjectRoots)
  # Previous installers stored the database key in ProgramData's
  # config\production.env. Include the live data root when repairing an
  # interrupted/legacy installation; repository .env placeholders remain
  # rejected by Test-UsableFieldEncryptionKey.
  $keyRoots = @($targetRoot) + $legacyRoots
  # Deterministic precedence: an existing runtime key always wins (including
  # an intentionally empty value), then protected ProgramData sources, then
  # active-user legacy projects, and finally this installer's customer seed.
  # Only absent keys are ever added.
  $sourceFiles = @(
    [pscustomobject]@{ Label = "ProgramData production.env"; Path = (Join-Path $targetRoot "config\production.env") },
    [pscustomobject]@{ Label = "ProgramData api-seed.env"; Path = (Join-Path $targetRoot "config\api-seed.env") }
  )
  foreach ($sourceRoot in $legacyRoots) {
    $sourceLabel = "active-user " + (Split-Path -Leaf $sourceRoot)
    $sourceFiles += @(
      [pscustomobject]@{ Label = "$sourceLabel .env"; Path = (Join-Path $sourceRoot ".env") },
      [pscustomobject]@{ Label = "$sourceLabel runtime.env"; Path = (Join-Path $sourceRoot "config\runtime.env") },
      [pscustomobject]@{ Label = "$sourceLabel production.env"; Path = (Join-Path $sourceRoot "config\production.env") },
      [pscustomobject]@{ Label = "$sourceLabel .run runtime.env"; Path = (Join-Path $sourceRoot ".run\runtime.env") }
    )
  }
  if (-not [string]::IsNullOrWhiteSpace($InstalledRoot)) {
    $sourceFiles += [pscustomobject]@{
      Label = "installed customer runtime seed"
      Path = (Join-Path $InstalledRoot $script:CustomerRuntimeSeedRelativePath)
    }
  }
  $existing = @{}
  if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
    foreach ($line in (Get-Content -LiteralPath $targetFile -Encoding UTF8)) {
      if ($line -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $existing[$Matches[1]] = $Matches[2] }
    }
  }
  $additions = @()
  $targetDb = Join-Path $targetRoot "data\seroguld.db"
  $targetDbItem = Get-Item -LiteralPath $targetDb -ErrorAction SilentlyContinue
  $existingEncryptionKey = if ($existing.ContainsKey("FIELD_ENCRYPTION_KEY")) {
    [string]$existing["FIELD_ENCRYPTION_KEY"]
  } else { "" }
  if ($targetDbItem -and $targetDbItem.Length -gt 0) {
    $candidateKeys = @(Get-LegacyFieldEncryptionKeys -Roots $keyRoots)
    if (Test-UsableFieldEncryptionKey $existingEncryptionKey) {
      if (@($candidateKeys | Where-Object { $_ -ne $existingEncryptionKey }).Count -gt 0) {
        throw "Mevcut müşteri veritabanı için çakışan şifreleme anahtarları bulundu; kurulum durduruldu"
      }
    } elseif ($candidateKeys.Count -ne 1) {
      # A non-empty customer DB must never be paired with a missing,
      # placeholder, conflicting or trivially short key.
      throw "Mevcut müşteri veritabanı için benzersiz şifreleme anahtarı bulunamadı; kurulum durduruldu"
    }
  }
  if ($targetDbItem -and $targetDbItem.Length -gt 0 -and (-not (Test-UsableFieldEncryptionKey $existingEncryptionKey))) {
    # A non-empty customer DB must never be paired with a missing, placeholder
    # or trivially short key. Recover only one unambiguous usable legacy key;
    # zero or multiple candidates is a hard installer failure rather than a
    # silent data-corrupting upgrade.
    $recoverableKeys = @(Get-LegacyFieldEncryptionKeys -Roots $keyRoots)
    if ($recoverableKeys.Count -ne 1) {
      throw "Mevcut müşteri veritabanı için benzersiz şifreleme anahtarı bulunamadı; kurulum durduruldu"
    }
    $recoveredKey = $recoverableKeys[0]
    if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
      $backup = "$targetFile.pre-key-recovery-$(Get-Date -Format yyyyMMddHHmmssfff).bak"
      Copy-Item -LiteralPath $targetFile -Destination $backup -Force
      $replaced = $false
      $lines = @(Get-Content -LiteralPath $targetFile -Encoding UTF8 | ForEach-Object {
          if ($_ -cmatch '^\s*FIELD_ENCRYPTION_KEY=') {
            $replaced = $true
            "FIELD_ENCRYPTION_KEY=$recoveredKey"
          } else { $_ }
        })
      if (-not $replaced) { $lines += "FIELD_ENCRYPTION_KEY=$recoveredKey" }
      Write-TextFileAtomically -Path $targetFile -Lines $lines
      Write-CleanupLog "Geçersiz mevcut şifreleme anahtarı benzersiz legacy anahtarla kurtarıldı; önceki runtime.env yedeklendi"
    } else {
      $additions += "FIELD_ENCRYPTION_KEY=$recoveredKey"
    }
    $existing["FIELD_ENCRYPTION_KEY"] = $recoveredKey
  }
  # A legacy database may contain encrypted customer fields.  If this run
  # adopted that database into an empty ProgramData target, its encryption
  # key must travel with it; otherwise a newly generated key makes the old
  # records permanently unreadable.  Preserve the old runtime.env before the
  # deliberate FIELD_ENCRYPTION_KEY replacement, never print its value.
  if ($script:LegacyDatabaseSourceRoot) {
    $sourceKeys = @(Get-LegacyFieldEncryptionKeys -Roots @($script:LegacyDatabaseSourceRoot))
    if ($sourceKeys.Count -ne 1) {
      # Do not let an adopted legacy database pair with a generated or
      # unrelated ProgramData key.  Continuing would make encrypted customer
      # fields unreadable while the installer reports success; multiple
      # conflicting source keys are just as unsafe as a missing key.
      throw "Legacy database encryption key bulunamadı; veri güvenliği için kurulum durduruldu"
    }
    $sourceKey = $sourceKeys[0]
    if ($existing.ContainsKey("FIELD_ENCRYPTION_KEY") -and
        $existing["FIELD_ENCRYPTION_KEY"] -ne $sourceKey) {
      $backup = "$targetFile.pre-legacy-key-$(Get-Date -Format yyyyMMddHHmmss).bak"
      Copy-Item -LiteralPath $targetFile -Destination $backup -Force
      $lines = @(Get-Content -LiteralPath $targetFile -Encoding UTF8)
      $replaced = $false
      $lines = @($lines | ForEach-Object {
          if ($_ -cmatch '^\s*FIELD_ENCRYPTION_KEY=') {
            $replaced = $true
            "FIELD_ENCRYPTION_KEY=$sourceKey"
          } else { $_ }
        })
      if ($replaced) {
        Write-TextFileAtomically -Path $targetFile -Lines $lines
        $existing["FIELD_ENCRYPTION_KEY"] = $sourceKey
        Write-CleanupLog "Adopted legacy database encryption key; previous runtime.env backed up to $backup"
      }
    } elseif (-not $existing.ContainsKey("FIELD_ENCRYPTION_KEY")) {
      $additions += "FIELD_ENCRYPTION_KEY=$sourceKey"
      $existing["FIELD_ENCRYPTION_KEY"] = $sourceKey
    }
  }
  foreach ($source in $sourceFiles) {
    $sourceFile = [string]$source.Path
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { continue }
    $migratedKeys = @()
    foreach ($line in (Get-Content -LiteralPath $sourceFile -Encoding UTF8)) {
      # -cmatch prevents Turkish Windows culture from treating ASCII I as a
      # different letter while parsing canonical environment variable names.
      if ($line -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $key = $Matches[1]
        $value = $Matches[2]
        # Never migrate a login/bootstrap password, token, or path override.
        if (($allowedKeys -ccontains $key) -and (-not $existing.ContainsKey($key)) -and $value.Trim().Length -gt 0) {
          $additions += "$key=$value"
          $existing[$key] = $value
          $migratedKeys += $key
        }
      }
    }
    if ($migratedKeys.Count -gt 0) {
      Write-CleanupLog "Eksik runtime anahtarları kaynaktan taşındı: $([string]$source.Label) [$(@($migratedKeys | Sort-Object) -join ', ')]"
    }
  }
  if ($additions.Count -gt 0) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
    if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
      $updated = @((Get-Content -LiteralPath $targetFile -Encoding UTF8) + $additions)
      Write-TextFileAtomically -Path $targetFile -Lines $updated
    } else {
      Write-TextFileAtomically -Path $targetFile -Lines (@("# Migrated Sero Guld API/company settings. File ACL is restricted after migration.") + $additions)
    }
  }
}

function Remove-CustomerRuntimeSeed {
  if ([string]::IsNullOrWhiteSpace($InstalledRoot)) { return }
  $seed = Join-Path $InstalledRoot $script:CustomerRuntimeSeedRelativePath
  if (Test-Path -LiteralPath $seed -PathType Leaf) {
    Remove-Item -LiteralPath $seed -Force
    Write-CleanupLog "Kurulum müşteri entegrasyon seed'i Program Files alanından kaldırıldı"
  }
}

function Protect-PrivateRuntimeStorage {
  $programData = $env:ProgramData
  if ([string]::IsNullOrWhiteSpace($programData)) { throw "ProgramData bulunamadı" }
  $targetRoot = Join-Path $programData "SeroGuldCRM"
  $configRoot = Join-Path $targetRoot "config"
  New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
  # Per-machine NSIS runs elevated, but the packaged non-elevated desktop must
  # use the active WTS console account.  Win32_ComputerSystem.UserName is the
  # interactive console user; do not use Explorer ownership or the installer
  # token/SYSTEM as a fallback because that can strand the customer data.
  $consoleUser = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
  if ([string]::IsNullOrWhiteSpace($consoleUser)) {
    throw "Aktif WTS konsol kullanıcısı bulunamadı"
  }
  try {
    $account = New-Object -TypeName System.Security.Principal.NTAccount -ArgumentList $consoleUser
    $userSid = $account.Translate([System.Security.Principal.SecurityIdentifier]).Value
  } catch {
    throw "Aktif WTS konsol kullanıcısı SID doğrulanamadı"
  }
  if ($userSid -notmatch '^S-1-[0-9-]+$') { throw "Windows kullanıcı güvenliği doğrulanamadı" }
  foreach ($item in @(
      @{ Path = $targetRoot; Directory = $true },
      @{ Path = $configRoot; Directory = $true }
    )) {
    $systemGrant = if ($item.Directory) { '*S-1-5-18:(OI)(CI)(F)' } else { '*S-1-5-18:F' }
    $administratorsGrant = if ($item.Directory) { '*S-1-5-32-544:(OI)(CI)(F)' } else { '*S-1-5-32-544:F' }
    $userGrant = if ($item.Directory) { "*${userSid}:(OI)(CI)(F)" } else { "*${userSid}:F" }
    & "$env:SystemRoot\System32\icacls.exe" $item.Path /inheritance:r /remove:g '*S-1-1-0' '*S-1-5-11' '*S-1-5-32-545' /grant:r $systemGrant /grant:r $administratorsGrant /grant:r $userGrant | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Runtime çalışma alanı güvenli hale getirilemedi" }
  }
  # Customer documents, SQLite sidecars, uploads and backups can arrive from
  # an old profile with permissive inherited ACLs. Apply a direct full-control
  # ACE to every existing file/directory and an inheritance-only ACE to every
  # directory for future children. Using only (OI)(CI) in a recursive command
  # leaves existing files with an empty DACL, which makes a preserved database
  # unreadable after upgrade.
  & "$env:SystemRoot\System32\icacls.exe" $targetRoot /T /C /inheritance:r /remove:g '*S-1-1-0' '*S-1-5-11' '*S-1-5-32-545' /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' "*${userSid}:F" /grant '*S-1-5-18:(OI)(CI)(IO)(F)' '*S-1-5-32-544:(OI)(CI)(IO)(F)' "*${userSid}:(OI)(CI)(IO)(F)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Runtime müşteri verileri güvenli hale getirilemedi" }
  $runtimeEnv = Join-Path $configRoot "runtime.env"
  if (Test-Path -LiteralPath $runtimeEnv -PathType Leaf) {
    & "$env:SystemRoot\System32\icacls.exe" $runtimeEnv /inheritance:r /remove:g '*S-1-1-0' '*S-1-5-11' '*S-1-5-32-545' /grant:r '*S-1-5-18:F' /grant:r '*S-1-5-32-544:F' /grant:r "*${userSid}:F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Runtime yapılandırması güvenli hale getirilemedi" }
  }
  Write-CleanupLog "Runtime yapılandırma ACL'si sınırlandırıldı"
}

if (-not $FixtureOnly) {
  Assert-InstalledSeroGuldClosed
  Inspect-LegacyPorts
  Stop-LegacyTasks
  Stop-LegacyProcessDescendants
  Assert-PackagedBackendPortFree
  $dockerCleanupCompleted = Remove-SeroGuldDockerResources
  if (-not $dockerCleanupCompleted) {
    Write-CleanupLog "Docker daemon kullanılabilir değil; yalnızca eski Docker kaynak temizliği atlandı"
  }
} else {
  Write-CleanupLog "FixtureOnly smoke: sistem süreç/görev/port/Docker temizliği atlandı"
}
# These are exact legacy project files, not customer data.  Remove them even
# when no Docker daemon is installed; container/network deletion above remains
# conditional on an already-usable CLI/daemon and never starts Docker.
Remove-LegacyOfficeFiles

if ($Mode -eq "PostInstall") {
  try {
    Preserve-LegacyData
    Preserve-LegacyRuntimeSettings
    Protect-PrivateRuntimeStorage
  } finally {
    # The customer seed is intentionally extractable only while NSIS is
    # installing.  Never leave API credentials under Program Files.
    Remove-CustomerRuntimeSeed
  }
}

# ProgramData, Docker Desktop itself and non-Sero Guld processes are intentionally untouched.
