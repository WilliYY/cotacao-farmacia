Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System.Runtime.InteropServices;
public static class SantaCruzMouse {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extraInfo);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(System.IntPtr handle);

    [DllImport("user32.dll")]
    public static extern System.IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(System.IntPtr handle, int command);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(System.IntPtr handle);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(System.IntPtr handle, bool useAltTab);

    [DllImport("user32.dll")]
    public static extern System.IntPtr GetDC(System.IntPtr handle);

    [DllImport("gdi32.dll")]
    public static extern uint GetPixel(System.IntPtr dc, int x, int y);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(System.IntPtr handle, System.IntPtr dc);
}
"@

$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$SearchQuery = if ($args.Count -gt 0) { [string]$args[0] } else { "" }
$SantaUser = if ($args.Count -gt 1) { [string]$args[1] } else { [string]$env:SANTACRUZ_USERNAME }
$SantaPassword = if ($args.Count -gt 2) { [string]$args[2] } else { [string]$env:SANTACRUZ_PASSWORD }
$SantaClientCode = if ($args.Count -gt 3) { [string]$args[3] } else { [string]$env:SANTACRUZ_CLIENT_CODE }
$FallbackSearchQuery = if ($args.Count -gt 4) { [string]$args[4] } else { [string]$env:SANTACRUZ_FALLBACK_QUERY }
$DiscoveryOnly = $SearchQuery -eq "--discover-only" -or $env:SANTACRUZ_DISCOVERY_ONLY -eq "true"
$StatusOnly = $SearchQuery -eq "--status-only"
$PrepareOnly = $SearchQuery -eq "--prepare"
$CleanupOnly = $SearchQuery -eq "--cleanup"

$StartupWaitSeconds = 180
if ($env:SANTACRUZ_STARTUP_WAIT_SECONDS) {
    $parsedWait = 0
    if ([int]::TryParse($env:SANTACRUZ_STARTUP_WAIT_SECONDS, [ref]$parsedWait) -and $parsedWait -gt 0) {
        $StartupWaitSeconds = $parsedWait
    }
}

$ResultWaitSeconds = 45
if ($env:SANTACRUZ_RESULT_WAIT_SECONDS) {
    $parsedResultWait = 0
    if ([int]::TryParse($env:SANTACRUZ_RESULT_WAIT_SECONDS, [ref]$parsedResultWait) -and $parsedResultWait -gt 0) {
        $ResultWaitSeconds = $parsedResultWait
    }
}

$UpdateWaitSeconds = 300
if ($env:SANTACRUZ_UPDATE_WAIT_SECONDS) {
    $parsedUpdateWait = 0
    if ([int]::TryParse($env:SANTACRUZ_UPDATE_WAIT_SECONDS, [ref]$parsedUpdateWait) -and $parsedUpdateWait -gt 0) {
        $UpdateWaitSeconds = $parsedUpdateWait
    }
}

$HeadlessGraceSeconds = 240
if ($env:SANTACRUZ_HEADLESS_GRACE_SECONDS) {
    $parsedHeadlessGrace = 0
    if ([int]::TryParse($env:SANTACRUZ_HEADLESS_GRACE_SECONDS, [ref]$parsedHeadlessGrace) -and $parsedHeadlessGrace -gt 0) {
        $HeadlessGraceSeconds = $parsedHeadlessGrace
    }
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$localAppDataRoot = [Environment]::GetFolderPath("LocalApplicationData")
if (-not $localAppDataRoot) { $localAppDataRoot = $env:LOCALAPPDATA }
if (-not $localAppDataRoot) { $localAppDataRoot = [System.IO.Path]::GetTempPath() }
$cacheDirectory = Join-Path $localAppDataRoot "WimifarmaCotacao"
$discoveryCachePath = Join-Path $cacheDirectory "santacruz-install.json"
$tracePath = [string]$env:SANTACRUZ_TRACE_PATH
$originalForegroundWindow = [SantaCruzMouse]::GetForegroundWindow()
$script:SantaCruzAutomationMutex = $null
$script:SantaCruzAutomationMutexOwned = $false

function Write-SantaCruzTrace {
    param([string]$Message)
    if (-not $tracePath) { return }
    try {
        "$(Get-Date -Format 'HH:mm:ss.fff') $Message" | Add-Content -LiteralPath $tracePath -Encoding UTF8
    } catch {}
}

function Exit-SantaCruzAutomationMutex {
    if (-not $script:SantaCruzAutomationMutex) { return }
    if ($script:SantaCruzAutomationMutexOwned) {
        try { $script:SantaCruzAutomationMutex.ReleaseMutex() } catch {}
    }
    try { $script:SantaCruzAutomationMutex.Dispose() } catch {}
    $script:SantaCruzAutomationMutex = $null
    $script:SantaCruzAutomationMutexOwned = $false
}

function Enter-SantaCruzAutomationMutex {
    try {
        $mutex = New-Object System.Threading.Mutex($false, "Local\WimifarmaCotacaoSantaCruz")
        $acquired = $false
        try {
            $acquired = $mutex.WaitOne(0)
        } catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) {
            $mutex.Dispose()
            return $false
        }
        $script:SantaCruzAutomationMutex = $mutex
        $script:SantaCruzAutomationMutexOwned = $true
        return $true
    } catch {
        Write-SantaCruzTrace "automation mutex failed: $($_.Exception.Message)"
        return $false
    }
}

function Complete-SantaCruzResult {
    param(
        [string]$Status,
        [string]$Reason = "",
        [object[]]$Results = @(),
        [string]$InstallRoot = "",
        [string]$LaunchPath = "",
        [string]$DiscoverySource = "",
        [hashtable]$Details = @{}
    )

    $payload = [ordered]@{
        status = $Status
        reason = $Reason
        installRoot = $InstallRoot
        launchPath = $LaunchPath
        discoverySource = $DiscoverySource
        results = @($Results)
    }
    foreach ($key in $Details.Keys) {
        $payload[$key] = $Details[$key]
    }
    if ($env:SANTACRUZ_RESTORE_FOCUS -ne "false" -and $originalForegroundWindow -ne [System.IntPtr]::Zero) {
        try { [SantaCruzMouse]::SetForegroundWindow($originalForegroundWindow) | Out-Null } catch {}
    }
    Exit-SantaCruzAutomationMutex
    Write-Output ($payload | ConvertTo-Json -Depth 8 -Compress)
    exit 0
}

function Get-InstallRootFromPath {
    param([string]$CandidatePath)

    if (-not $CandidatePath) { return "" }
    $current = $CandidatePath
    if (Test-Path -LiteralPath $current -PathType Leaf) {
        $current = Split-Path -Parent $current
    }

    for ($level = 0; $level -lt 6 -and $current; $level++) {
        $hasLauncher = (Test-Path -LiteralPath (Join-Path $current "digitador-sd.exe")) -or
            (Test-Path -LiteralPath (Join-Path $current "Pe - SantaCruz.exe"))
        $hasRuntime = (Test-Path -LiteralPath (Join-Path $current "data")) -and
            (Test-Path -LiteralPath (Join-Path $current "lib"))
        if ($hasLauncher -or $hasRuntime) { return $current }

        $parent = Split-Path -Parent $current
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }

    return ""
}

function Resolve-LaunchCandidate {
    param(
        [string]$CandidatePath,
        [string]$Source,
        [int]$Score = 0,
        [string]$WorkingDirectory = "",
        [string]$Arguments = ""
    )

    if (-not $CandidatePath) { return $null }
    $candidatePathValue = [Environment]::ExpandEnvironmentVariables($CandidatePath.Trim())
    if ($candidatePathValue -match '^\s*"([^"]+)"') {
        $candidate = $Matches[1]
    } else {
        $candidate = ($candidatePathValue -replace ',\d+$', '').Trim().Trim('"')
    }

    if (Test-Path -LiteralPath $candidate -PathType Container) {
        foreach ($launcherName in @("digitador-sd.exe", "Pe - SantaCruz.exe", "pedido-eletronico.exe")) {
            $launcher = Join-Path $candidate $launcherName
            if (Test-Path -LiteralPath $launcher -PathType Leaf) {
                $candidate = $launcher
                break
            }
        }
    }

    if ([System.IO.Path]::GetExtension($candidate).ToLowerInvariant() -eq ".lnk" -and (Test-Path -LiteralPath $candidate)) {
        try {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($candidate)
            if (-not $WorkingDirectory) { $WorkingDirectory = $shortcut.WorkingDirectory }
            if (-not $Arguments) { $Arguments = $shortcut.Arguments }
            $candidate = $shortcut.TargetPath
        } catch {
            return $null
        }
    }

    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    $fileName = [System.IO.Path]::GetFileName($candidate).ToLowerInvariant()
    $identity = "$candidate $WorkingDirectory $Arguments"
    $knownLauncher = $fileName -in @("digitador-sd.exe", "pe - santacruz.exe", "pedido-eletronico.exe")
    if (-not $knownLauncher -and $identity -notmatch '(?i)santa\s*-?\s*cruz|digitador-sd') { return $null }

    $installRoot = Get-InstallRootFromPath $(if ($WorkingDirectory) { $WorkingDirectory } else { $candidate })
    if (-not $installRoot) { $installRoot = Split-Path -Parent $candidate }
    if (-not $WorkingDirectory -or -not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        $WorkingDirectory = $installRoot
    }

    [PSCustomObject]@{
        LaunchPath = $candidate
        InstallRoot = $installRoot
        WorkingDirectory = $WorkingDirectory
        Arguments = $Arguments
        Source = $Source
        Score = $Score
    }
}

function Add-LaunchCandidate {
    param(
        [System.Collections.Generic.List[object]]$Candidates,
        [string]$Path,
        [string]$Source,
        [int]$Score,
        [string]$WorkingDirectory = "",
        [string]$Arguments = ""
    )

    $resolved = Resolve-LaunchCandidate $Path $Source $Score $WorkingDirectory $Arguments
    if ($resolved -and -not ($Candidates | Where-Object { $_.LaunchPath -eq $resolved.LaunchPath })) {
        $Candidates.Add($resolved)
    }
}

function Find-LaunchersUnderRoot {
    param(
        [string]$Root,
        [datetime]$Deadline,
        [int]$MaxDepth = 4
    )

    $found = New-Object System.Collections.Generic.List[string]
    if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) { return $found }

    $queue = New-Object System.Collections.Queue
    $queue.Enqueue([PSCustomObject]@{ Path = $Root; Depth = 0 })
    $skipNames = @('Windows', 'System Volume Information', '$Recycle.Bin', 'node_modules', '.git')

    while ($queue.Count -gt 0 -and [DateTime]::UtcNow -lt $Deadline) {
        $entry = $queue.Dequeue()
        foreach ($launcherName in @("digitador-sd.exe", "Pe - SantaCruz.exe", "pedido-eletronico.exe")) {
            $launcher = Join-Path $entry.Path $launcherName
            if (Test-Path -LiteralPath $launcher -PathType Leaf) { $found.Add($launcher) }
        }

        if ($entry.Depth -ge $MaxDepth) { continue }
        $children = Get-ChildItem -LiteralPath $entry.Path -Directory -Force -ErrorAction SilentlyContinue
        foreach ($child in $children) {
            if ([DateTime]::UtcNow -ge $Deadline) { break }
            if ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
            if ($skipNames -contains $child.Name) { continue }
            $queue.Enqueue([PSCustomObject]@{ Path = $child.FullName; Depth = $entry.Depth + 1 })
        }
    }

    return $found
}

function Find-SantaCruzInstallation {
    $candidates = New-Object System.Collections.Generic.List[object]

    if ($env:SANTACRUZ_APP_PATH) {
        Add-LaunchCandidate $candidates $env:SANTACRUZ_APP_PATH "environment" 1000
    }

    if (Test-Path -LiteralPath $discoveryCachePath -PathType Leaf) {
        try {
            $cached = Get-Content -LiteralPath $discoveryCachePath -Raw | ConvertFrom-Json
            Add-LaunchCandidate $candidates $cached.launchPath "validated-cache" 900 $cached.workingDirectory $cached.arguments
        } catch {}
    }

    $shortcutRoots = @(
        [Environment]::GetFolderPath("Desktop"),
        [Environment]::GetFolderPath("CommonDesktopDirectory"),
        [Environment]::GetFolderPath("StartMenu"),
        [Environment]::GetFolderPath("CommonStartMenu")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

    foreach ($shortcutRoot in $shortcutRoots) {
        $shortcuts = Get-ChildItem -LiteralPath $shortcutRoot -Filter "*.lnk" -File -Recurse -ErrorAction SilentlyContinue
        foreach ($shortcut in $shortcuts) {
            if ($shortcut.Name -match '(?i)santa\s*-?\s*cruz|pedido\s+eletr|^pe\s*-') {
                Add-LaunchCandidate $candidates $shortcut.FullName "shortcut" 800
            }
        }
    }

    $uninstallKeys = @(
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($entry in Get-ItemProperty $uninstallKeys -ErrorAction SilentlyContinue) {
        if ($entry.DisplayName -match '(?i)santa\s*-?\s*cruz|pedido\s+eletr|digitador') {
            Add-LaunchCandidate $candidates $entry.InstallLocation "registry" 750
            Add-LaunchCandidate $candidates $entry.DisplayIcon "registry" 740
        }
    }

    $knownRoots = @(
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Pe - SantaCruz" }),
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Pe - SantaCruz" }),
        $(if ($localAppDataRoot) { Join-Path $localAppDataRoot "Programs\Pe - SantaCruz" }),
        $(if ($env:SystemDrive) { Join-Path "$($env:SystemDrive)\" "Pe - SantaCruz" })
    ) | Where-Object { $_ }
    foreach ($knownRoot in $knownRoots) {
        Add-LaunchCandidate $candidates $knownRoot "known-location" 700
    }

    if ($candidates.Count -eq 0) {
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        $scanRoots = New-Object System.Collections.Generic.List[string]
        foreach ($drive in [System.IO.DriveInfo]::GetDrives()) {
            if ($drive.DriveType -eq [System.IO.DriveType]::Fixed -and $drive.IsReady) {
                $scanRoots.Add($drive.RootDirectory.FullName)
            }
        }
        foreach ($scanRoot in $scanRoots) {
            foreach ($launcher in Find-LaunchersUnderRoot $scanRoot $deadline 4) {
                Add-LaunchCandidate $candidates $launcher "disk-scan" 600
            }
            if ([DateTime]::UtcNow -ge $deadline) { break }
        }
    }

    $winner = $candidates | Sort-Object Score -Descending | Select-Object -First 1
    if ($winner) {
        try {
            New-Item -ItemType Directory -Path $cacheDirectory -Force -ErrorAction Stop | Out-Null
            [ordered]@{
                launchPath = $winner.LaunchPath
                workingDirectory = $winner.WorkingDirectory
                arguments = $winner.Arguments
            } | ConvertTo-Json -Compress | Set-Content -LiteralPath $discoveryCachePath -Encoding UTF8 -ErrorAction Stop
        } catch {}
    }
    return $winner
}

function Get-ProcessPath {
    param([int]$ProcessId)
    try { return (Get-Process -Id $ProcessId -ErrorAction Stop).Path } catch { return "" }
}

function Find-SantaCruzWindow {
    # --- Strategy 1: Scan ALL top-level windows by title (most reliable, works on any PC) ---
    try {
        $allWindows = $desktop.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::TrueCondition
        )
        $candidates = @()
        foreach ($candidateWindow in $allWindows) {
            try {
                $title = [string]$candidateWindow.Current.Name
                if (-not $title) { continue }
                $candidateProcessId = [int]$candidateWindow.Current.ProcessId
                $candidateProcessPath = Get-ProcessPath $candidateProcessId
                $candidateProcessName = try { (Get-Process -Id $candidateProcessId -ErrorAction Stop).ProcessName } catch { "" }
                $genericTitleIsValidated = $title -eq "Pedidos" -and (
                    $candidateProcessName -match '(?i)digitador|santa.?cruz|pe.?santacruz' -or
                    $candidateProcessPath -match '(?i)pe\s*-\s*santacruz|digitador-sd|santacruz'
                )
                if ($title -match '(?i)santa\s*-?\s*cruz|pedido\s*eletr[oô]nico|digitador\s*-?\s*sd|vitrine\s*de\s*ofertas' -or $genericTitleIsValidated) {
                    $bounds = $candidateWindow.Current.BoundingRectangle
                    if ($bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
                    $score = [double]($bounds.Width * $bounds.Height)
                    if ($genericTitleIsValidated) { $score += 10000000 }
                    if ($title -match '(?i)^Pedido Eletr.nico SantaCruz') { $score += 1000000 }
                    if ($title -match '(?i)vitrine') { $score += 500000 }
                    $candidates += [PSCustomObject]@{ Window = $candidateWindow; Score = $score; Title = $title }
                }
            } catch {}
        }
        $winner = $candidates | Sort-Object Score -Descending | Select-Object -First 1
        if ($winner) {
            Write-SantaCruzTrace "window-scan found title='$($winner.Title)' score=$($winner.Score)"
            return $winner.Window
        }
    } catch {
        Write-SantaCruzTrace "window-scan failed: $_"
    }

    # --- Strategy 2: Find process first, then its windows ---
    $process = Find-SantaCruzProcess
    if (-not $process) { return $null }
    try {
        $processCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
            $process.Id
        )
        $windows = $desktop.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            $processCondition
        )
        if ($windows.Count -gt 0) {
            $candidates = @()
            foreach ($candidateWindow in $windows) {
                try {
                    $title = [string]$candidateWindow.Current.Name
                    $bounds = $candidateWindow.Current.BoundingRectangle
                    $score = [double]($bounds.Width * $bounds.Height)
                    if ($title -match '(?i)santa\s*-?\s*cruz|pedido\s*eletr|digitador|vitrine|pedidos') { $score += 1000000 }
                    $candidates += [PSCustomObject]@{ Window = $candidateWindow; Score = $score }
                } catch {}
            }
            $winner = $candidates | Sort-Object Score -Descending | Select-Object -First 1
            if ($winner) { return $winner.Window }
        }
    } catch { return $null }
    return $null
}

function Find-SantaCruzProcess {
    $santaCruzPattern = '(?i)santa\s*-?\s*cruz|digitador[\s_-]*sd|pe\s*-?\s*santacruz'

    # --- Priority 1: Process name matches known Santa Cruz executables ---
    $knownProcessNames = @('digitador-sd', 'Pe - SantaCruz')
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
        try {
            $pName = [string]$process.ProcessName
            foreach ($known in $knownProcessNames) {
                if ($pName -eq $known) {
                    Write-SantaCruzTrace "process-match by known name='$pName' pid=$($process.Id)"
                    return $process
                }
            }
        } catch {}
    }

    # --- Priority 2: Java processes with Santa Cruz in their path or window title ---
    foreach ($process in Get-Process -Name 'javaw', 'java' -ErrorAction SilentlyContinue) {
        try {
            # Check process path
            $pPath = ""
            try { $pPath = [string]$process.Path } catch {}
            if ($pPath -and $pPath -match $santaCruzPattern) {
                Write-SantaCruzTrace "process-match by path='$pPath' pid=$($process.Id)"
                return $process
            }

            # Check main window title
            $mwTitle = ""
            try { $mwTitle = [string]$process.MainWindowTitle } catch {}
            if ($mwTitle -and $mwTitle -match $santaCruzPattern) {
                Write-SantaCruzTrace "process-match by MainWindowTitle='$mwTitle' pid=$($process.Id)"
                return $process
            }

            # Check command line arguments (WMI)
            try {
                $wmiProc = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)" -ErrorAction SilentlyContinue
                $cmdLine = [string]$wmiProc.CommandLine
                if ($cmdLine -and $cmdLine -match $santaCruzPattern) {
                    Write-SantaCruzTrace "process-match by CommandLine pid=$($process.Id)"
                    return $process
                }
            } catch {}

            # Check modules (jars loaded by javaw)
            try {
                $modules = $process.Modules | Select-Object -First 30 -ErrorAction SilentlyContinue
                foreach ($mod in $modules) {
                    if ([string]$mod.FileName -match $santaCruzPattern) {
                        Write-SantaCruzTrace "process-match by module='$($mod.FileName)' pid=$($process.Id)"
                        return $process
                    }
                }
            } catch {}
        } catch {}
    }

    # --- Priority 3: Any process name matching SantaCruz pattern loosely ---
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
        try {
            $pName = [string]$process.ProcessName
            if ($pName -match '(?i)^santacruz$') {
                Write-SantaCruzTrace "process-match by loose name='$pName' pid=$($process.Id)"
                return $process
            }
        } catch {}
    }

    return $null
}

function Find-SantaCruzMainWindowProcess {
    $titlePattern = '(?i)^Pedido Eletr.nico SantaCruz|santa\s*-?\s*cruz|vitrine\s+de\s+ofertas|digitador\s*-?\s*sd'
    $candidates = @()
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
        try {
            if ($process.ProcessName -match '(?i)^(dwm|explorer|applicationframehost)$') { continue }
            $title = [string]$process.MainWindowTitle
            if ($process.MainWindowHandle -eq 0 -or -not $title -or $title -notmatch $titlePattern) { continue }
            $score = if ($title -match '(?i)^Pedido Eletr.nico SantaCruz') { 1000000 } else { 0 }
            if ($process.ProcessName -match '(?i)^(javaw|java|digitador-sd|pe\s*-\s*santacruz)$') {
                $score += 2000000
            }
            $candidates += [PSCustomObject]@{ Process = $process; Score = $score }
        } catch {}
    }
    $winner = $candidates | Sort-Object Score -Descending | Select-Object -First 1
    if ($winner) {
        Write-SantaCruzTrace "main-window process pid=$($winner.Process.Id) title='$($winner.Process.MainWindowTitle)'"
        return $winner.Process
    }
    return $null
}

function Get-RecentSantaCruzStartupIssue {
    param([string]$InstallRoot)
    if (-not $InstallRoot) { return "" }
    $initializerLog = Join-Path $InstallRoot "log\inicializador.log.0"
    if (-not (Test-Path -LiteralPath $initializerLog -PathType Leaf)) { return "" }
    try {
        $logFile = Get-Item -LiteralPath $initializerLog -ErrorAction Stop
        if ($logFile.LastWriteTime -lt (Get-Date).AddMinutes(-20)) { return "" }
        $recentLines = Get-Content -LiteralPath $initializerLog -Tail 160 -ErrorAction Stop
        if ($recentLines -match '503\s*-\s*Service Unavailable') {
            return "O atualizador da Santa Cruz respondeu 503 Service Unavailable"
        }
    } catch {}
    return ""
}

function Find-ControlByAutomationId {
    param($Window, [string]$AutomationId)
    if (-not $Window) { return $null }
    try {
        return $Window.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
                $AutomationId
            ))
        )
    } catch { return $null }
}

function Find-TableControl {
    param($Window)
    if (-not $Window) { return $null }
    try {
        $tableCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Table
        )
        $tables = $Window.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            $tableCondition
        )

        # Priority 1: Search results grid in Santa Cruz JavaFX application has exactly 18 columns
        foreach ($table in $tables) {
            try {
                $grid = $table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
                if ($grid.Current.ColumnCount -eq 18) { return $table }
            } catch {}
        }

        # Priority 2: Any table with >= 18 columns
        foreach ($table in $tables) {
            try {
                $grid = $table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
                if ($grid.Current.ColumnCount -ge 18) { return $table }
            } catch {}
        }

        # Priority 3: Table with >= 14 columns where Col 0 is valid EAN and not trash icon
        foreach ($table in $tables) {
            try {
                $grid = $table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
                if ($grid.Current.ColumnCount -ge 14) {
                    $c0 = Get-GridCellText $grid 0 0
                    if ($c0 -and $c0 -ne '' -and $c0 -match '^\d{13}$') { return $table }
                }
            } catch {}
        }
    } catch { return $null }
    return $null
}

function Find-SearchControl {
    param($Window, $Table = $null)
    try {
        $editCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        $windowBounds = $Window.Current.BoundingRectangle
        $tableBounds = if ($Table) { $Table.Current.BoundingRectangle } else { $null }
        $scored = @()
        foreach ($edit in $edits) {
            if (-not $edit.Current.IsEnabled -or $edit.Current.IsOffscreen -or $edit.Current.IsPassword) { continue }
            $identity = "$($edit.Current.Name) $($edit.Current.AutomationId) $($edit.Current.HelpText)"
            if ($identity -match '(?i)senha|password|usuario|login|cliente') { continue }
            $score = 0
            if ($identity -match '(?i)busca|pesquis|produto|ean|descri|codigo') { $score += 100 }
            $bounds = $edit.Current.BoundingRectangle
            if ($bounds.Width -ge 300) { $score += 50 }
            if ($bounds.Top -gt $windowBounds.Top + 250) { $score += 25 }
            if ($bounds.Top -lt $windowBounds.Top + 500) { $score += 10 }
            if ($tableBounds) {
                $verticalGap = $tableBounds.Top - $bounds.Bottom
                if ($verticalGap -ge 0 -and $verticalGap -le 40) { $score += 100 }
                $expectedWidth = $tableBounds.Width * 0.62
                $widthDifference = [Math]::Abs($bounds.Width - $expectedWidth)
                $score += [Math]::Max(0, 100 - ($widthDifference / 2))
            }
            $scored += [PSCustomObject]@{ Element = $edit; Score = $score }
        }
        $winner = $scored | Sort-Object Score -Descending | Select-Object -First 1
        if ($winner -and $winner.Score -ge 60) { return $winner.Element }
    } catch {}

    if ($Table) {
        try {
            $tb = $Table.Current.BoundingRectangle
            if ($tb.Width -gt 0 -and $tb.Height -gt 0) {
                $syntheticRect = New-Object System.Windows.Rect(
                    [double]($tb.Left + 10),
                    [double]($tb.Top - 28),
                    [double]($tb.Width * 0.60),
                    [double](24)
                )
                return [PSCustomObject]@{
                    Current = [PSCustomObject]@{
                        BoundingRectangle = $syntheticRect
                        IsEnabled = $true
                        IsOffscreen = $false
                        Name = "Busca inteligente"
                        AutomationId = "synthetic-search-input"
                    }
                }
            }
        } catch {}
    }
    return $null
}

function ConvertTo-NormalizedText {
    param([string]$Value)
    if (-not $Value) { return "" }
    $decomposed = $Value.Normalize([System.Text.NormalizationForm]::FormD)
    $builder = New-Object System.Text.StringBuilder
    foreach ($character in $decomposed.ToCharArray()) {
        $category = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($character)
        if ($category -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
            $builder.Append($character) | Out-Null
        }
    }
    return (($builder.ToString().ToLowerInvariant() -replace '\s+', ' ').Trim())
}

function Get-WindowTextSummary {
    param($Window)
    if (-not $Window) { return "" }
    $names = New-Object System.Collections.Generic.List[string]
    try {
        $all = $Window.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.PropertyCondition]::TrueCondition
        )
        foreach ($element in $all) {
            $name = [string]$element.Current.Name
            if ($name -and $names.Count -lt 250) { $names.Add($name) }
        }
    } catch {}
    return "$($Window.Current.Name) $($names -join ' ')"
}

function Set-AutomationValue {
    param($Element, [string]$Value)
    if (-not $Element) { return $false }
    try {
        $pattern = $Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $pattern.SetValue($Value)
        return $true
    } catch {
        try {
            $Element.SetFocus()
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            [System.Windows.Forms.SendKeys]::SendWait($Value.Replace("+", "{+}").Replace("^", "{^}").Replace("%", "{%}"))
            return $true
        } catch { return $false }
    }
}

function Prepare-SantaCruzWindowForInput {
    param($Window)
    if (-not $Window -or $Window.Current.NativeWindowHandle -eq 0) { return }
    try {
        $handle = [System.IntPtr]$Window.Current.NativeWindowHandle
        if ([SantaCruzMouse]::IsIconic($handle)) {
            [SantaCruzMouse]::ShowWindow($handle, 9) | Out-Null
            Start-Sleep -Milliseconds 250
        }
        $bounds = $Window.Current.BoundingRectangle
        if ($bounds.Width -lt 1000 -or $bounds.Height -lt 600) {
            [SantaCruzMouse]::ShowWindow($handle, 3) | Out-Null
            Start-Sleep -Milliseconds 350
        } else {
            [SantaCruzMouse]::ShowWindow($handle, 5) | Out-Null
        }
        [SantaCruzMouse]::SetForegroundWindow($handle) | Out-Null
        Start-Sleep -Milliseconds 150
    } catch {
        Write-SantaCruzTrace "window preparation failed: $_"
    }
}

function Test-SantaCruzWindowResponsive {
    param($Window)
    if (-not $Window) { return $false }
    try {
        $process = Get-Process -Id $Window.Current.ProcessId -ErrorAction Stop
        return [bool]$process.Responding
    } catch {
        return $false
    }
}

function Invoke-SantaCruzProductList {
    param($Window)
    if (-not $Window -or -not (Test-SantaCruzWindowResponsive $Window)) { return $false }
    try {
        Prepare-SantaCruzWindowForInput $Window
        [System.Windows.Forms.SendKeys]::SendWait("{F3}")
        Write-SantaCruzTrace "product list requested with F3"
        return $true
    } catch {
        Write-SantaCruzTrace "product list F3 failed: $_"
        return $false
    }
}

function Get-AutomationValue {
    param($Element)
    if (-not $Element) { return "" }
    try {
        $pattern = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
            return ([string]$pattern.Current.Value).Trim()
        }
    } catch {}
    return ""
}

function Clear-SantaCruzSearchInput {
    param($Element, $Window = $null)
    if (-not $Element) { return $false }
    if ($Window -and -not (Test-SantaCruzWindowResponsive $Window)) {
        Write-SantaCruzTrace "search input cleanup skipped because Santa Cruz is not responding"
        return $false
    }

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Prepare-SantaCruzWindowForInput $Window

        try {
            $valuePattern = $null
            if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
                $valuePattern.SetValue("")
                Start-Sleep -Milliseconds 120
                if (-not (Get-AutomationValue $Element)) {
                    Write-SantaCruzTrace "search input cleared with ValuePattern attempt=$attempt"
                    return $true
                }
            }
        } catch {
            Write-SantaCruzTrace "ValuePattern clear unavailable attempt=$attempt; using keyboard"
        }

        try {
            $Element.SetFocus()
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            Start-Sleep -Milliseconds 60
            [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
            Start-Sleep -Milliseconds 140
            if (-not (Get-AutomationValue $Element)) {
                Write-SantaCruzTrace "search input cleared with keyboard attempt=$attempt"
                return $true
            }
        } catch {
            Write-SantaCruzTrace "keyboard clear attempt=$attempt failed: $_"
        }
    }
    return $false
}

function Paste-SantaCruzSearchText {
    param($Element, [string]$Value)
    if (-not $Element -or -not $Value) { return $false }

    $previousClipboard = $null
    $hadClipboardData = $false
    try {
        $previousClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
        $hadClipboardData = $null -ne $previousClipboard
        [System.Windows.Forms.Clipboard]::SetText($Value)
        $Element.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait("^v")
        Start-Sleep -Milliseconds 700
        return $true
    } catch {
        Write-SantaCruzTrace "clipboard paste unavailable: $_"
        return $false
    } finally {
        try {
            if ($hadClipboardData) {
                [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard, $true)
            } else {
                [System.Windows.Forms.Clipboard]::Clear()
            }
        } catch {
            Write-SantaCruzTrace "clipboard restore failed: $_"
        }
    }
}

function Type-AutomationValue {
    param($Element, [string]$Value)
    if (-not $Element) { return $false }
    try {
        $valuePattern = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
            $valuePattern.SetValue($Value)
            return $true
        }
    } catch {}
    try {
        $Element.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
        if ($Value) {
            foreach ($character in $Value.ToCharArray()) {
                $escaped = ([string]$character).Replace("+", "{+}").Replace("^", "{^}").Replace("%", "{%}")
                [System.Windows.Forms.SendKeys]::SendWait($escaped)
                Start-Sleep -Milliseconds 45
            }
        }
        return $true
    } catch { return $false }
}

function Ensure-SantaCruzSearchInput {
    param($Element, [string]$TargetValue, $Window = $null, [bool]$UseEnter = $false)
    if (-not $Element) { return $false }

    try {
        Prepare-SantaCruzWindowForInput $Window

        # Step 1: Click physical center of edit box bounds to lock focus on JavaFX input box
        $bounds = $Element.Current.BoundingRectangle
        if ($bounds.Width -gt 0 -and $bounds.Height -gt 0 -and $bounds.Left -gt 0) {
            $cx = [int]($bounds.Left + ($bounds.Width / 2))
            $cy = [int]($bounds.Top + ($bounds.Height / 2))
            Write-SantaCruzTrace "click input box x=$cx y=$cy"
            [SantaCruzMouse]::SetCursorPos($cx, $cy) | Out-Null
            [SantaCruzMouse]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
            [SantaCruzMouse]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
            Start-Sleep -Milliseconds 120
        }

        # Step 2: clear, type and verify. JavaFX can drop keystrokes while its
        # catalog is repainting, so retry slowly instead of submitting a prefix.
        if ($TargetValue) {
            $typingConfirmed = $false
            for ($typingAttempt = 1; $typingAttempt -le 3 -and -not $typingConfirmed; $typingAttempt++) {
                if (-not (Clear-SantaCruzSearchInput $Element $Window)) {
                    Write-SantaCruzTrace "input could not be cleared attempt=$typingAttempt query='$TargetValue'"
                    continue
                }
                $Element.SetFocus()
                $keyDelay = 55 + (($typingAttempt - 1) * 45)
                $pasted = Paste-SantaCruzSearchText $Element $TargetValue
                if (-not $pasted) {
                    foreach ($character in $TargetValue.ToCharArray()) {
                        $escaped = ([string]$character).Replace("+", "{+}").Replace("^", "{^}").Replace("%", "{%}").Replace("~", "{~}")
                        [System.Windows.Forms.SendKeys]::SendWait($escaped)
                        Start-Sleep -Milliseconds $keyDelay
                    }
                }
                Start-Sleep -Milliseconds 250
                $typedValue = Get-AutomationValue $Element
                $typingConfirmed = (ConvertTo-NormalizedText $typedValue) -eq (ConvertTo-NormalizedText $TargetValue)
                Write-SantaCruzTrace "typing verification attempt=$typingAttempt pasted=$pasted delay=$keyDelay expected='$TargetValue' actual='$typedValue' confirmed=$typingConfirmed"
            }
            if (-not $typingConfirmed) {
                Write-SantaCruzTrace "input verification failed after retries expected='$TargetValue'"
                return $false
            }

            # Step 3: submit only after the exact text is confirmed.
            Start-Sleep -Milliseconds 50
            if ($UseEnter) {
                Write-SantaCruzTrace "submitting search with Enter"
                $Element.SetFocus()
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            } elseif (-not (Invoke-SantaCruzSearchSubmit $Window $Element)) {
                Write-SantaCruzTrace "search magnifier could not be clicked; using Enter fallback"
                $Element.SetFocus()
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            }
            Start-Sleep -Milliseconds 300
        }

        Start-Sleep -Milliseconds 100
        Write-SantaCruzTrace "input-completed query='$TargetValue'"
        return $true
    } catch {
        Write-SantaCruzTrace "typing failed: $_"
        return $false
    }
}

function Complete-SantaCruzSearchResult {
    param(
        [string]$Status,
        [string]$Reason,
        [object[]]$Results,
        $SearchControl,
        $Window,
        $Installation
    )

    $cleared = if (Test-SantaCruzWindowResponsive $Window) {
        Clear-SantaCruzSearchInput $SearchControl $Window
    } else {
        Write-SantaCruzTrace "search result completed while Santa Cruz is not responding; window kept open"
        $false
    }
    $details = @{ searchCleared = $cleared }
    if (-not $cleared) {
        $Reason = "$Reason; o campo de pesquisa nao pode ser limpo automaticamente"
        if ($Status -eq "ok") { $Status = "ok-cleanup-warning" }
    }
    Complete-SantaCruzResult $Status $Reason $Results `
        $(if ($Installation) { $Installation.InstallRoot }) `
        $(if ($Installation) { $Installation.LaunchPath }) `
        $(if ($Installation) { $Installation.Source }) `
        $details
}

function Invoke-SantaCruzSearchSubmit {
    param($Window, $SearchControl)
    if (-not $Window -or -not $SearchControl -or -not (Test-SantaCruzWindowResponsive $Window)) {
        return $false
    }
    try {
        $searchBounds = $SearchControl.Current.BoundingRectangle
        $comboCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ComboBox
        )
        $rightEdge = $searchBounds.Right
        $rowTolerance = [Math]::Max(8, $searchBounds.Height * 0.6)
        $overlapTolerance = [Math]::Max(3, $searchBounds.Height * 0.2)
        Write-SantaCruzTrace "search bounds=$searchBounds"
        $alignedCombos = @()
        $scope = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($SearchControl)
        for ($depth = 0; $depth -lt 4 -and $scope; $depth++) {
            if ($scope.Current.NativeWindowHandle -ne 0) { break }
            $combos = $scope.FindAll([System.Windows.Automation.TreeScope]::Descendants, $comboCondition)
            foreach ($combo in $combos) {
                $bounds = $combo.Current.BoundingRectangle
                if (-not $combo.Current.IsOffscreen -and [Math]::Abs($bounds.Top - $searchBounds.Top) -le $rowTolerance) {
                    $alignedCombos += [PSCustomObject]@{ Element = $combo; Bounds = $bounds }
                }
            }
            $scope = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($scope)
        }
        $selectedComboCount = 0
        foreach ($entry in @($alignedCombos | Sort-Object { $_.Bounds.Left })) {
            if ($entry.Bounds.Left -lt ($rightEdge - $overlapTolerance)) { continue }
            Write-SantaCruzTrace "selected combo bounds=$($entry.Bounds) id=$($entry.Element.Current.AutomationId)"
            $rightEdge = $entry.Bounds.Right
            $selectedComboCount++
            if ($selectedComboCount -ge 2) { break }
        }
        if ($selectedComboCount -eq 0) {
            $rightEdge = $searchBounds.Right
        }

        if ($selectedComboCount -eq 1) {
            foreach ($entry in @($alignedCombos | Sort-Object { $_.Bounds.Left })) {
                if ($entry.Bounds.Left -lt ($rightEdge - $overlapTolerance)) { continue }
                $rightEdge = $entry.Bounds.Right
                break
            }
        }

        if ($selectedComboCount -lt 2) { return $false }

        $windowBounds = $Window.Current.BoundingRectangle
        $submitOffset = [Math]::Max($searchBounds.Height, $searchBounds.Height * 1.35)
        $edgeMargin = [Math]::Max(10, $searchBounds.Height)
        $x = [int]($rightEdge + $submitOffset)
        $y = [int]($searchBounds.Top + ($searchBounds.Height / 2))
        if ($x -le $rightEdge -or $x -ge ($windowBounds.Right - $edgeMargin) -or
            $y -lt $windowBounds.Top -or $y -gt $windowBounds.Bottom) {
            return $false
        }

        Prepare-SantaCruzWindowForInput $Window
        Write-SantaCruzTrace "click search magnifier x=$x y=$y rightEdge=$rightEdge"
        [SantaCruzMouse]::SetCursorPos($x, $y) | Out-Null
        [SantaCruzMouse]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
        [SantaCruzMouse]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
        return $true
    } catch {
        Write-SantaCruzTrace "search magnifier click failed: $_"
    }
    return $false
}

function Invoke-AutomationControl {
    param($Element)
    if (-not $Element) { return $false }

    try {
        $bounds = $Element.Current.BoundingRectangle
        $centerX = $bounds.Left + ($bounds.Width / 2)
        $centerY = $bounds.Top + ($bounds.Height / 2)
        $windowHandle = 0
        $topWindows = $desktop.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::TrueCondition
        )
        $containingWindows = @()
        foreach ($topWindow in $topWindows) {
            $topBounds = $topWindow.Current.BoundingRectangle
            if ($topWindow.Current.ProcessId -ne $Element.Current.ProcessId -or $topWindow.Current.NativeWindowHandle -eq 0) { continue }
            if ($centerX -lt $topBounds.Left -or $centerX -gt $topBounds.Right -or
                $centerY -lt $topBounds.Top -or $centerY -gt $topBounds.Bottom) { continue }
            $containingWindows += [PSCustomObject]@{
                Handle = $topWindow.Current.NativeWindowHandle
                Area = $topBounds.Width * $topBounds.Height
            }
        }
        $topMatch = $containingWindows | Sort-Object Area | Select-Object -First 1
        if ($topMatch) { $windowHandle = $topMatch.Handle }

        if ($windowHandle -eq 0) {
            $ancestor = $Element
            for ($level = 0; $level -lt 12 -and $ancestor; $level++) {
                if ($ancestor.Current.NativeWindowHandle -ne 0) { $windowHandle = $ancestor.Current.NativeWindowHandle }
                $ancestor = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($ancestor)
            }
        }
        if ($windowHandle -ne 0) {
            Write-SantaCruzTrace "activate handle=$windowHandle id=$($Element.Current.AutomationId) name=$($Element.Current.Name)"
            [SantaCruzMouse]::ShowWindow([System.IntPtr]$windowHandle, 5) | Out-Null
            [SantaCruzMouse]::SwitchToThisWindow([System.IntPtr]$windowHandle, $true)
            [SantaCruzMouse]::SetForegroundWindow([System.IntPtr]$windowHandle) | Out-Null
            Start-Sleep -Milliseconds 200
            try { $bounds = $Element.Current.BoundingRectangle } catch {}
        }
        try { $Element.SetFocus() } catch {}
        if ($bounds.Width -gt 0 -and $bounds.Height -gt 0 -and $bounds.Left -gt 0) {
            $x = [int]($bounds.Left + ($bounds.Width / 2))
            $y = [int]($bounds.Top + ($bounds.Height / 2))
            Write-SantaCruzTrace "click x=$x y=$y bounds=$bounds"
            [SantaCruzMouse]::SetCursorPos($x, $y) | Out-Null
            [SantaCruzMouse]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
            [SantaCruzMouse]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
            return $true
        }
    } catch {}

    foreach ($patternId in @(
        [System.Windows.Automation.InvokePattern]::Pattern,
        [System.Windows.Automation.SelectionItemPattern]::Pattern
    )) {
        try {
            $pattern = $Element.GetCurrentPattern($patternId)
            if ($patternId -eq [System.Windows.Automation.InvokePattern]::Pattern) { $pattern.Invoke() }
            else { $pattern.Select() }
            return $true
        } catch {}
    }
    return $false
}

function Find-TopActionImage {
    param($Window)
    if (-not $Window) { return $null }
    try {
        $imageCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Image
        )
        $images = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $imageCondition)
        $windowBounds = $Window.Current.BoundingRectangle
        $candidates = @()
        foreach ($image in $images) {
            if ($image.Current.IsOffscreen -or -not $image.Current.IsEnabled) { continue }
            $bounds = $image.Current.BoundingRectangle
            if ($bounds.Top -lt $windowBounds.Top + 25 -or $bounds.Top -gt $windowBounds.Top + 140) { continue }
            if ($bounds.Width -lt 50 -or $bounds.Width -gt 125 -or $bounds.Height -lt 35 -or $bounds.Height -gt 85) { continue }
            if ($bounds.Left -lt $windowBounds.Left + ($windowBounds.Width * 0.35)) { continue }
            $candidates += [PSCustomObject]@{ Element = $image; Left = $bounds.Left }
        }
        $winner = $candidates | Sort-Object Left | Select-Object -First 1
        if ($winner) { return $winner.Element }
    } catch {}
    return $null
}

function Test-SantaCruzUpdating {
    param($Window)
    $summary = Get-WindowTextSummary $Window
    return $summary -match '(?i)atualizando|aguarde.{0,40}atualiza|baixando|importando\s+dados|sincronizando|download\s+\d+\s*%'
}

function Invoke-NewOrderDialog {
    param($Window)
    if (-not $Window -or ([string]$Window.Current.Name).Trim() -ne "Pedidos") { return $false }
    try {
        $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button
        )
        $buttons = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
        $applyButton = $buttons | Where-Object {
            $_.Current.IsEnabled -and -not $_.Current.IsOffscreen -and $_.Current.Name -match '(?i)^aplicar$'
        } | Select-Object -First 1
        if ($applyButton) {
            Write-SantaCruzTrace "dialog apply id=$($applyButton.Current.AutomationId) bounds=$($applyButton.Current.BoundingRectangle)"
            return Invoke-AutomationControl $applyButton
        }
    } catch {}
    return $false
}

function Invoke-LoginIfPresent {
    param($Window)
    if (-not $Window) { return "not-login" }

    try {
        $editCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        $passwordEdit = $null
        foreach ($edit in $edits) {
            if ($edit.Current.IsPassword) { $passwordEdit = $edit; break }
        }
        $summary = Get-WindowTextSummary $Window
        $isLogin = $passwordEdit -or $summary -match '(?i)login|conectar|entrar|acesso'
        if (-not $isLogin -or $edits.Count -lt 2) { return "not-login" }
        if (-not $SantaUser -or -not $SantaPassword) { return "missing-credentials" }

        $usernameEdit = $null
        $clientEdit = $null
        foreach ($edit in $edits) {
            $identity = "$($edit.Current.Name) $($edit.Current.AutomationId) $($edit.Current.HelpText)"
            if (-not $usernameEdit -and -not $edit.Current.IsPassword -and $identity -match '(?i)usuario|login') {
                $usernameEdit = $edit
            }
            if (-not $clientEdit -and -not $edit.Current.IsPassword -and $identity -match '(?i)cliente|codigo') {
                $clientEdit = $edit
            }
        }
        if (-not $usernameEdit) { $usernameEdit = $edits[0] }
        if (-not $passwordEdit) { $passwordEdit = $edits[1] }
        if (-not $clientEdit -and $edits.Count -ge 3) { $clientEdit = $edits[2] }

        Set-AutomationValue $usernameEdit $SantaUser | Out-Null
        Set-AutomationValue $passwordEdit $SantaPassword | Out-Null
        if ($clientEdit -and $SantaClientCode) { Set-AutomationValue $clientEdit $SantaClientCode | Out-Null }

        $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button
        )
        $buttons = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
        $loginButton = $buttons | Where-Object {
            $_.Current.IsEnabled -and $_.Current.Name -match '(?i)entrar|login|conectar|acessar|confirmar'
        } | Select-Object -First 1
        if (-not $loginButton) { $loginButton = $buttons | Where-Object { $_.Current.IsEnabled } | Select-Object -First 1 }
        if (-not $loginButton) { return "login-button-not-found" }

        $invoke = $loginButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
        return "submitted"
    } catch { return "login-failed" }
}

function Test-LoginScreenPresent {
    param($Window)
    if (-not $Window) { return $false }
    try {
        $editCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        foreach ($edit in $edits) {
            if ($edit.Current.IsPassword) { return $true }
        }
        $summary = Get-WindowTextSummary $Window
        return $edits.Count -ge 2 -and $summary -match '(?i)login|conectar|entrar|acesso'
    } catch { return $false }
}

function Get-TableSignature {
    param($Table, $Columns = $null)
    if (-not $Table) { return "" }
    try {
        $grid = $Table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
        $signatureColumns = @(0)
        if ($Columns) {
            $signatureColumns += @($Columns.Name, $Columns.PriceNf)
        } else {
            $signatureColumns += @(2)
        }
        $signatureColumns = @($signatureColumns | Select-Object -Unique)
        $parts = @()
        for ($row = 0; $row -lt [Math]::Min($grid.Current.RowCount, 5); $row++) {
            foreach ($column in $signatureColumns) {
                if ($column -lt $grid.Current.ColumnCount) {
                    $parts += Get-GridCellText $grid $row $column
                }
            }
        }
        return "$($grid.Current.RowCount):$($parts -join '|')"
    } catch { return "" }
}

function Get-GridCellText {
    param($Grid, [int]$Row, [int]$Column)
    try {
        $cell = $Grid.GetItem($Row, $Column)
        $value = [string]$cell.Current.Name
        if ($value) { return $value.Trim() }
        $text = $cell.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Text
            ))
        )
        if ($text) { return ([string]$text.Current.Name).Trim() }
    } catch {}
    return ""
}

function Get-GridCellStatus {
    param($Grid, [int]$Row, [int]$Column)
    try {
        $cell = $Grid.GetItem($Row, $Column)
        $parts = New-Object System.Collections.Generic.List[string]
        foreach ($value in @($cell.Current.Name, $cell.Current.ItemStatus, $cell.Current.HelpText, $cell.Current.AutomationId)) {
            if ($value) { $parts.Add([string]$value) }
        }
        $descendants = $cell.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.PropertyCondition]::TrueCondition
        )
        foreach ($element in $descendants) {
            foreach ($value in @($element.Current.Name, $element.Current.ItemStatus, $element.Current.HelpText, $element.Current.AutomationId)) {
                if ($value) { $parts.Add([string]$value) }
            }
        }
        return ($parts | Select-Object -Unique) -join " "
    } catch { return "" }
}

function Get-SantaCruzGridAvailability {
    param($Table, $Grid, [int]$Row, [int]$Column)
    try {
        $cell = $Grid.GetItem($Row, $Column)
        if ($cell.Current.IsOffscreen) { return "" }
        $bounds = $cell.Current.BoundingRectangle
        $tableBounds = $Table.Current.BoundingRectangle
        if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { return "" }

        $centerX = [int]($bounds.Left + ($bounds.Width / 2))
        $centerY = [int]($bounds.Top + ($bounds.Height / 2))
        if ($centerX -lt $tableBounds.Left -or $centerX -gt $tableBounds.Right -or
            $centerY -lt $tableBounds.Top -or $centerY -gt $tableBounds.Bottom) {
            return ""
        }
        $offset = [Math]::Max(1, [int]($bounds.Height * 0.08))
        $points = @(
            [PSCustomObject]@{ X = $centerX; Y = $centerY },
            [PSCustomObject]@{ X = ($centerX - $offset); Y = $centerY },
            [PSCustomObject]@{ X = ($centerX + $offset); Y = $centerY },
            [PSCustomObject]@{ X = $centerX; Y = ($centerY - $offset) },
            [PSCustomObject]@{ X = $centerX; Y = ($centerY + $offset) }
        )

        $greenPixels = 0
        $redPixels = 0
        $dc = [SantaCruzMouse]::GetDC([System.IntPtr]::Zero)
        if ($dc -eq [System.IntPtr]::Zero) { return "" }
        try {
            foreach ($point in $points) {
                $color = [SantaCruzMouse]::GetPixel($dc, $point.X, $point.Y)
                if ($color -eq [uint32]::MaxValue) { continue }
                $red = [int]($color -band 0xFF)
                $green = [int](($color -shr 8) -band 0xFF)
                $blue = [int](($color -shr 16) -band 0xFF)
                if ($green -gt 80 -and $green -gt ($red * 1.25) -and $green -gt ($blue * 1.25)) {
                    $greenPixels++
                } elseif ($red -gt 80 -and $red -gt ($green * 1.5) -and $red -gt ($blue * 1.5)) {
                    $redPixels++
                }
            }
        } finally {
            [void][SantaCruzMouse]::ReleaseDC([System.IntPtr]::Zero, $dc)
        }

        if ($greenPixels -gt $redPixels -and $greenPixels -gt 0) { return "Disponivel" }
        if ($redPixels -gt $greenPixels -and $redPixels -gt 0) { return "sem estoque" }
    } catch {
        Write-SantaCruzTrace "availability pixel inspection unavailable row=$Row column=$Column error=$_"
    }
    return ""
}

function Parse-DoubleSafe {
    param([string]$Value)
    if (-not $Value) { return 0 }
    $clean = $Value.Replace("R$", "").Replace(" ", "").Trim()
    if ($clean -like "*.*" -and $clean -like "*,*") {
        $clean = $clean.Replace(".", "").Replace(",", ".")
    } elseif ($clean -like "*,*") {
        $clean = $clean.Replace(",", ".")
    }
    $result = [double]0
    if ([double]::TryParse($clean, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$result)) {
        return $result
    }
    return 0
}

function ConvertTo-SantaCruzHeaderKey {
    param([string]$Value)
    return ((ConvertTo-NormalizedText $Value) -replace '[^a-z0-9]+', ' ').Trim()
}

function Add-SantaCruzHeaderPosition {
    param(
        [hashtable]$Positions,
        [string]$HeaderName,
        [int]$Column
    )
    $headerKey = ConvertTo-SantaCruzHeaderKey $HeaderName
    if (-not $headerKey) { return }
    if (-not $Positions.ContainsKey($headerKey)) { $Positions[$headerKey] = @() }
    if ($Positions[$headerKey] -notcontains $Column) {
        $Positions[$headerKey] += $Column
    }
}

function Add-SantaCruzVisibleHeaderPositions {
    param(
        $Table,
        $Grid,
        [hashtable]$Positions
    )
    if (-not $Table -or -not $Grid) { return }

    try {
        $tableBounds = $Table.Current.BoundingRectangle
        if ($tableBounds.IsEmpty -or $Grid.Current.RowCount -le 0) { return }

        $columnBounds = @()
        $firstRowTop = [double]::PositiveInfinity
        for ($column = 0; $column -lt $Grid.Current.ColumnCount; $column++) {
            try {
                $bounds = $Grid.GetItem(0, $column).Current.BoundingRectangle
                $columnBounds += $bounds
                if (-not $bounds.IsEmpty -and $bounds.Top -lt $firstRowTop) {
                    $firstRowTop = $bounds.Top
                }
            } catch {
                $columnBounds += [System.Windows.Rect]::Empty
            }
        }
        if ([double]::IsPositiveInfinity($firstRowTop)) { return }

        $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
        $container = $walker.GetParent($Table)
        if (-not $container) { return }
        $textCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text
        )
        $texts = @($container.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            $textCondition
        ))
        $seen = @{}
        foreach ($text in $texts) {
            try {
                $name = [string]$text.Current.Name
                $headerKey = ConvertTo-SantaCruzHeaderKey $name
                $bounds = $text.Current.BoundingRectangle
                if (-not $headerKey -or $bounds.IsEmpty) { continue }
                if ($bounds.Top -lt ($tableBounds.Top - 2) -or $bounds.Bottom -gt ($firstRowTop + 1)) { continue }
                if ($bounds.Right -le $tableBounds.Left -or $bounds.Left -ge $tableBounds.Right) { continue }

                $bestColumn = -1
                $bestOverlap = 0.0
                for ($column = 0; $column -lt $columnBounds.Count; $column++) {
                    $cellBounds = $columnBounds[$column]
                    if ($cellBounds.IsEmpty) { continue }
                    $overlap = [Math]::Min($bounds.Right, $cellBounds.Right) -
                        [Math]::Max($bounds.Left, $cellBounds.Left)
                    if ($overlap -gt $bestOverlap) {
                        $bestOverlap = $overlap
                        $bestColumn = $column
                    }
                }
                if ($bestColumn -lt 0 -or $bestOverlap -le 0) { continue }

                $candidateKey = "$headerKey|$bestColumn"
                if ($seen.ContainsKey($candidateKey)) { continue }
                $seen[$candidateKey] = $true
                Add-SantaCruzHeaderPosition $Positions $name $bestColumn
            } catch {}
        }
    } catch {
        Write-SantaCruzTrace "visible header inspection unavailable: $_"
    }
}

function Get-SantaCruzColumnMap {
    param($Table)
    if (-not $Table) { return $null }

    try {
        $grid = $Table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
        $headers = @()
        $positions = @{}
        try {
            $tablePattern = $Table.GetCurrentPattern([System.Windows.Automation.TablePattern]::Pattern)
            $headers = @($tablePattern.Current.GetColumnHeaders())
        } catch {}

        if ($headers.Count -ne $grid.Current.ColumnCount) {
            $headerCondition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::HeaderItem
            )
            $headerItems = @($Table.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                $headerCondition
            ))
            $uniqueHeaders = [ordered]@{}
            foreach ($header in @($headerItems | Sort-Object { $_.Current.BoundingRectangle.Left })) {
                $bounds = $header.Current.BoundingRectangle
                $key = "$(ConvertTo-SantaCruzHeaderKey $header.Current.Name)|$([Math]::Round($bounds.Left, 0))"
                if ($key -and -not $uniqueHeaders.Contains($key)) {
                    $uniqueHeaders[$key] = $header
                }
            }
            $headers = @($uniqueHeaders.Values)
        }

        if ($headers.Count -eq $grid.Current.ColumnCount) {
            for ($column = 0; $column -lt $headers.Count; $column++) {
                Add-SantaCruzHeaderPosition $positions $headers[$column].Current.Name $column
            }
        } else {
            $scroll = $null
            $originalHorizontalPercent = [System.Windows.Automation.ScrollPattern]::NoScroll
            try {
                $scroll = $Table.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
                if ($scroll.Current.HorizontallyScrollable) {
                    $originalHorizontalPercent = $scroll.Current.HorizontalScrollPercent
                } else {
                    $scroll = $null
                }
            } catch {
                $scroll = $null
            }

            try {
                $horizontalStops = if ($scroll) { @(0, 25, 50, 75, 100) } else { @(0) }
                foreach ($horizontalPercent in $horizontalStops) {
                    if ($scroll) {
                        try {
                            $scroll.SetScrollPercent(
                                $horizontalPercent,
                                [System.Windows.Automation.ScrollPattern]::NoScroll
                            )
                            Start-Sleep -Milliseconds 120
                        } catch {}
                    }
                    Add-SantaCruzVisibleHeaderPositions $Table $grid $positions
                }
            } finally {
                if ($scroll -and $originalHorizontalPercent -ne [System.Windows.Automation.ScrollPattern]::NoScroll) {
                    try {
                        $scroll.SetScrollPercent(
                            $originalHorizontalPercent,
                            [System.Windows.Automation.ScrollPattern]::NoScroll
                        )
                    } catch {}
                }
            }
        }

        $requiredHeaders = [ordered]@{
            Ean = "codigo ean"
            Name = "descricao"
            Availability = "disp"
            St = "st"
            PriceNf = "preco nf"
        }
        $resolved = @{}
        foreach ($entry in $requiredHeaders.GetEnumerator()) {
            $matches = @($positions[$entry.Value])
            if ($matches.Count -ne 1) {
                Write-SantaCruzTrace "required column '$($entry.Value)' count=$($matches.Count); price extraction blocked"
                return $null
            }
            $resolved[$entry.Key] = [int]$matches[0]
        }

        $optionalHeaders = [ordered]@{
            StockQuantity = "qtd caixa"
            FactoryPrice = "preco fabrica"
            Category = "categoria"
            ListType = "tipo lista"
            Laboratory = "laboratorio"
        }
        foreach ($entry in $optionalHeaders.GetEnumerator()) {
            $matches = @($positions[$entry.Value])
            $resolved[$entry.Key] = if ($matches.Count -eq 1) { [int]$matches[0] } else { -1 }
        }

        Write-SantaCruzTrace "validated Preco NF column=$($resolved.PriceNf)"
        return [PSCustomObject]$resolved
    } catch {
        Write-SantaCruzTrace "column validation error: $_"
        return $null
    }
}

function Read-SantaCruzRows {
    param(
        $Table,
        $Columns = $null,
        [int]$StartRow = 0,
        [int]$RowLimit = 500,
        [DateTime]$Deadline = [DateTime]::MaxValue,
        [hashtable]$ObservedRows = $null
    )
    if (-not $Table) { return @() }
    if (-not $Columns) { $Columns = Get-SantaCruzColumnMap $Table }
    if (-not $Columns) { return @() }
    $output = New-Object System.Collections.ArrayList
    try {
        $grid = $Table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
        $firstRow = [Math]::Max(0, $StartRow)
        $lastRow = if ($RowLimit -le 0) {
            $grid.Current.RowCount
        } else {
            [Math]::Min($grid.Current.RowCount, $firstRow + $RowLimit)
        }
        for ($row = $firstRow; $row -lt $lastRow; $row++) {
            if ([DateTime]::UtcNow -ge $Deadline) { break }
            try {
                [void]$grid.GetItem($row, $Columns.Ean)
            } catch {
                continue
            }
            $ean = [string](Get-GridCellText $grid $row $Columns.Ean)
            $name = [string](Get-GridCellText $grid $row $Columns.Name)
            if ($ean -notmatch '^\d{13}$' -or -not $name) { continue }

            $priceNfRaw = [string](Get-GridCellText $grid $row $Columns.PriceNf)
            $pixelAvailability = [string](Get-SantaCruzGridAvailability $Table $grid $row $Columns.Availability)
            $availabilityEvidence = [string](Get-GridCellStatus $grid $row $Columns.Availability)
            $stRaw = [string](Get-GridCellText $grid $row $Columns.St)
            if (
                -not $priceNfRaw -or
                (-not $pixelAvailability -and -not $availabilityEvidence) -or
                -not $stRaw
            ) {
                continue
            }
            if ($null -ne $ObservedRows) { $ObservedRows[$row] = $true }

            $priceNf = Parse-DoubleSafe $priceNfRaw
            if ($priceNf -le 0) { continue }

            $normalizedAvailability = ConvertTo-NormalizedText $availabilityEvidence
            $stock = if ($pixelAvailability) {
                $pixelAvailability
            } elseif ($normalizedAvailability -match 'indispon|sem estoque|vermelh|nao dispon') {
                "sem estoque"
            } elseif ($normalizedAvailability -match 'dispon|verde|em estoque') {
                "Disponivel"
            } else {
                "estoque desconhecido"
            }
            $lab = if ($Columns.Laboratory -ge 0) { [string](Get-GridCellText $grid $row $Columns.Laboratory) } else { "" }
            $cat = if ($Columns.Category -ge 0) { [string](Get-GridCellText $grid $row $Columns.Category) } else { "" }
            $listType = if ($Columns.ListType -ge 0) { [string](Get-GridCellText $grid $row $Columns.ListType) } else { "" }
            $qBox = if ($Columns.StockQuantity -ge 0) { [string](Get-GridCellText $grid $row $Columns.StockQuantity) } else { "" }
            $fPrice = if ($Columns.FactoryPrice -ge 0) { Parse-DoubleSafe (Get-GridCellText $grid $row $Columns.FactoryPrice) } else { 0 }
            $stVal = Parse-DoubleSafe $stRaw

            $item = [PSCustomObject]@{
                ean = $ean
                name = $name
                price = $priceNf
                priceNf = $priceNf
                factoryPrice = $fPrice
                st = $stVal
                stRaw = $stRaw
                unitCostWithSt = $priceNf
                stock = $stock
                stockEvidence = if ($pixelAvailability) { "indicador visual: $pixelAvailability" } else { $availabilityEvidence }
                laboratory = $lab
                quantityBox = $qBox
                category = $cat
                listType = $listType
            }
            [void]$output.Add($item)
        }
    } catch {
        Write-SantaCruzTrace "Read-SantaCruzRows error: $_"
        return @()
    }
    return $output.ToArray()
}

function Read-AllSantaCruzRowsWithScroll {
    param(
        $Table,
        $Columns = $null,
        [DateTime]$Deadline = [DateTime]::UtcNow.AddSeconds(45)
    )
    if (-not $Table) {
        return [PSCustomObject]@{ Rows = @(); Complete = $false; Reason = "table-not-found" }
    }
    if (-not $Columns) { $Columns = Get-SantaCruzColumnMap $Table }
    if (-not $Columns) {
        return [PSCustomObject]@{ Rows = @(); Complete = $false; Reason = "columns-not-found" }
    }

    $deduplicated = [ordered]@{}
    $observedRows = @{}
    $collectRows = {
        param([int]$PageStart, [int]$PageCount)
        $readAny = $false
        foreach ($row in @(Read-SantaCruzRows $Table $Columns $PageStart $PageCount $Deadline $observedRows)) {
            $readAny = $true
            $key = "$($row.ean)|$($row.priceNf)|$($row.name)"
            if (-not $deduplicated.Contains($key)) {
                $deduplicated[$key] = $row
            } elseif ($deduplicated[$key].stock -eq "estoque desconhecido" -and
                $row.stock -ne "estoque desconhecido") {
                $deduplicated[$key] = $row
            }
        }
        return $readAny
    }
    $gridItemCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::IsGridItemPatternAvailableProperty,
        $true
    )
    $collectVisibleRows = {
        $tableBounds = $Table.Current.BoundingRectangle
        $pageRows = @{}
        foreach ($cell in @($Table.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            $gridItemCondition
        ))) {
            try {
                $item = $cell.GetCurrentPattern([System.Windows.Automation.GridItemPattern]::Pattern)
                if ($item.Current.Column -ne $Columns.Ean) { continue }
                if ($cell.Current.IsOffscreen) { continue }
                $bounds = $cell.Current.BoundingRectangle
                if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
                if ($bounds.Bottom -le $tableBounds.Top -or $bounds.Top -ge $tableBounds.Bottom) { continue }
                $rowIndex = [int]$item.Current.Row
                if ($rowIndex -ge 0) { $pageRows[$rowIndex] = $true }
            } catch {}
        }
        foreach ($rowIndex in @($pageRows.Keys | Sort-Object)) {
            if ([DateTime]::UtcNow -ge $Deadline) { break }
            [void](& $collectRows $rowIndex 1)
        }
    }

    $scrollPattern = $null
    $originalHorizontalPercent = [System.Windows.Automation.ScrollPattern]::NoScroll
    $originalVerticalPercent = [System.Windows.Automation.ScrollPattern]::NoScroll
    $scanComplete = $false
    $scanReason = ""
    $totalRows = 0
    try {
        $grid = $Table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
        $totalRows = [int]$grid.Current.RowCount
        if ($totalRows -eq 0) {
            $scanComplete = $true
            return [PSCustomObject]@{ Rows = @(); Complete = $true; Reason = "" }
        }

        [void]$Table.TryGetCurrentPattern(
            [System.Windows.Automation.ScrollPattern]::Pattern,
            [ref]$scrollPattern
        )
        if ($scrollPattern -and $scrollPattern.Current.HorizontallyScrollable) {
            $originalHorizontalPercent = [double]$scrollPattern.Current.HorizontalScrollPercent
            $scrollPattern.SetScrollPercent(
                [double]0,
                [System.Windows.Automation.ScrollPattern]::NoScroll
            )
            Start-Sleep -Milliseconds 180
        }

        if ($scrollPattern -and $scrollPattern.Current.VerticallyScrollable) {
            $originalVerticalPercent = [double]$scrollPattern.Current.VerticalScrollPercent
            $viewSize = [Math]::Max(0.01, [double]$scrollPattern.Current.VerticalViewSize)
            $step = [Math]::Max(0.05, [Math]::Min(20, $viewSize * 0.75))
            $percent = [double]0
            while ($percent -le 100) {
                if ([DateTime]::UtcNow -ge $Deadline) {
                    $scanReason = "scan-deadline"
                    break
                }
                $scrollPattern.SetScrollPercent(
                    [System.Windows.Automation.ScrollPattern]::NoScroll,
                    $percent
                )
                Start-Sleep -Milliseconds 140
                & $collectVisibleRows
                if ([DateTime]::UtcNow -ge $Deadline) {
                    $scanReason = "scan-deadline"
                    break
                }
                if ($percent -eq 100) { break }
                $percent = [Math]::Min(100, $percent + $step)
            }
            $scanComplete = $scanReason -eq "" -and $observedRows.Count -ge $totalRows
            if (-not $scanComplete -and -not $scanReason) {
                $scanReason = "incomplete-row-coverage"
            }
        } else {
            for ($rowIndex = 0; $rowIndex -lt $totalRows; $rowIndex++) {
                if ([DateTime]::UtcNow -ge $Deadline) { break }
                [void](& $collectRows $rowIndex 1)
            }
            $scanComplete = [DateTime]::UtcNow -lt $Deadline -and $observedRows.Count -ge $totalRows
            if (-not $scanComplete) {
                $scanReason = if ([DateTime]::UtcNow -ge $Deadline) {
                    "scan-deadline"
                } else {
                    "incomplete-row-coverage"
                }
            }
        }
    } catch {
        Write-SantaCruzTrace "grid scroll inspection unavailable: $_"
        $scanComplete = $false
        $scanReason = "scroll-error"
    } finally {
        if ($scrollPattern -and
            $originalVerticalPercent -ne [System.Windows.Automation.ScrollPattern]::NoScroll) {
            try {
                $scrollPattern.SetScrollPercent(
                    [System.Windows.Automation.ScrollPattern]::NoScroll,
                    $originalVerticalPercent
                )
            } catch {}
        }
        if ($scrollPattern -and
            $originalHorizontalPercent -ne [System.Windows.Automation.ScrollPattern]::NoScroll) {
            try {
                $scrollPattern.SetScrollPercent(
                    $originalHorizontalPercent,
                    [System.Windows.Automation.ScrollPattern]::NoScroll
                )
            } catch {}
        }
    }
    Write-SantaCruzTrace "grid scan rows=$($observedRows.Count)/$totalRows complete=$scanComplete reason='$scanReason'"
    return [PSCustomObject]@{
        Rows = @($deduplicated.Values)
        Complete = $scanComplete
        Reason = $scanReason
    }
}

Write-SantaCruzTrace "start query=$SearchQuery"
if (-not $DiscoveryOnly -and -not $StatusOnly -and -not (Enter-SantaCruzAutomationMutex)) {
    Complete-SantaCruzResult "busy" "Outra cotacao ja esta controlando a Santa Cruz; aguarde a conclusao"
}
if ($CleanupOnly) {
    $cleanupWindow = Find-SantaCruzWindow
    if (-not $cleanupWindow -or -not (Test-SantaCruzWindowResponsive $cleanupWindow)) {
        Complete-SantaCruzResult "cleanup-skipped" "Janela pronta da Santa Cruz nao localizada para limpeza" @() "" "" "" @{
            searchCleared = $false
        }
    }
    $cleanupTable = Find-TableControl $cleanupWindow
    $cleanupSearchControl = Find-SearchControl $cleanupWindow $cleanupTable
    $cleanupCleared = Clear-SantaCruzSearchInput $cleanupSearchControl $cleanupWindow
    if ($cleanupTable) {
        try {
            $cleanupScroll = $cleanupTable.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
            $horizontal = if ($cleanupScroll.Current.HorizontallyScrollable) { [double]0 } else { [System.Windows.Automation.ScrollPattern]::NoScroll }
            $vertical = if ($cleanupScroll.Current.VerticallyScrollable) { [double]0 } else { [System.Windows.Automation.ScrollPattern]::NoScroll }
            $cleanupScroll.SetScrollPercent($horizontal, $vertical)
        } catch {}
    }
    Complete-SantaCruzResult `
        $(if ($cleanupCleared) { "cleanup-ok" } else { "cleanup-failed" }) `
        $(if ($cleanupCleared) { "Campo de pesquisa limpo apos interrupcao" } else { "Campo de pesquisa nao pode ser limpo apos interrupcao" }) `
        @() "" "" "" @{ searchCleared = $cleanupCleared }
}

$installation = Find-SantaCruzInstallation
Write-SantaCruzTrace "installation path=$($installation.LaunchPath) source=$($installation.Source)"
if ($DiscoveryOnly) {
    if ($installation) {
        Complete-SantaCruzResult "discovered" "Aplicativo localizado" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
    }
    Complete-SantaCruzResult "not-installed" "Aplicativo Santa Cruz nao localizado"
}

if ($StatusOnly) {
    # ALWAYS check process and window FIRST, even if installation path is unknown.
    # On some PCs the installation path varies, but the software may already be running.
    $statusWindowProcess = Find-SantaCruzMainWindowProcess
    $statusProcess = if ($statusWindowProcess) { $statusWindowProcess } else { Find-SantaCruzProcess }
    if ($statusWindowProcess -and -not $statusWindowProcess.Responding) {
        Complete-SantaCruzResult "not-responding" "Santa Cruz esta aberta, mas nao esta respondendo; a cotacao foi interrompida sem fechar o aplicativo" @() `
            $(if ($installation) { $installation.InstallRoot } else { "" }) `
            $(if ($installation) { $installation.LaunchPath } else { "" }) `
            $(if ($installation) { $installation.Source } else { "" }) `
            @{
                ready = $false
                processRunning = $true
                windowDetected = $true
                windowTitle = [string]$statusWindowProcess.MainWindowTitle
                requiresOperator = $true
                canAutoPrepare = $false
            }
    }
    $statusWindow = Find-SantaCruzWindow

    # If both process and window are absent, then check installation
    if (-not $statusProcess -and -not $statusWindow) {
        if (-not $installation) {
            Complete-SantaCruzResult "not-installed" "Aplicativo Santa Cruz nao localizado neste computador" @() "" "" "" @{
                ready = $false
                processRunning = $false
                windowDetected = $false
                requiresOperator = $true
                canAutoPrepare = $false
            }
        }
        Complete-SantaCruzResult "closed" "Abra a Santa Cruz para o sistema cotar; o robo tambem pode abrir e entrar sozinho" @() $installation.InstallRoot $installation.LaunchPath $installation.Source @{
            ready = $false
            processRunning = $false
            windowDetected = $false
            requiresOperator = $false
            canAutoPrepare = $true
        }
    }

    # Process running but no window accessible
    if ($statusProcess -and -not $statusWindow) {
        $statusIssue = Get-RecentSantaCruzStartupIssue $(if ($installation) { $installation.InstallRoot } else { "" })
        $statusReason = if ($statusIssue) {
            "$statusIssue; o processo ficou sem janela. Aguarde o fornecedor e tente preparar novamente"
        } else {
            "Santa Cruz esta em execucao, mas sem janela acessivel; tente preparar novamente"
        }
        $installRoot = if ($installation) { $installation.InstallRoot } else { "" }
        $launchPath = if ($installation) { $installation.LaunchPath } else { "" }
        $discoverySource = if ($installation) { $installation.Source } else { "" }
        Complete-SantaCruzResult "running-without-window" $statusReason @() $installRoot $launchPath $discoverySource @{
            ready = $false
            processRunning = $true
            windowDetected = $false
            requiresOperator = $true
            canAutoPrepare = $true
        }
    }

    # Window found — analyze its state
    $statusTitle = [string]$statusWindow.Current.Name
    $installRoot = if ($installation) { $installation.InstallRoot } else { "" }
    $launchPath = if ($installation) { $installation.LaunchPath } else { "" }
    $discoverySource = if ($installation) { $installation.Source } else { "" }
    $statusDetails = @{
        ready = $false
        processRunning = [bool]$statusProcess
        windowDetected = $true
        windowTitle = $statusTitle
        requiresOperator = $false
        canAutoPrepare = $true
    }
    if (-not (Test-SantaCruzWindowResponsive $statusWindow)) {
        Complete-SantaCruzResult "not-responding" "Santa Cruz esta aberta, mas nao esta respondendo; a cotacao foi interrompida sem fechar o aplicativo" @() $installRoot $launchPath $discoverySource $statusDetails
    }
    if (Test-SantaCruzUpdating $statusWindow) {
        Complete-SantaCruzResult "updating" "Santa Cruz esta atualizando; aguarde a tela concluir" @() $installRoot $launchPath $discoverySource $statusDetails
    }

    $statusTable = Find-TableControl $statusWindow
    $statusSearch = Find-SearchControl $statusWindow $statusTable
    if ($statusTable -and $statusSearch) {
        $statusDetails.ready = $true
        $statusDetails.canAutoPrepare = $false
        Complete-SantaCruzResult "ready" "Santa Cruz pronta; a cotacao reutilizara a tela de pesquisa ja aberta" @() $installRoot $launchPath $discoverySource $statusDetails
    }
    if (Test-LoginScreenPresent $statusWindow) {
        Complete-SantaCruzResult "login-required" "Santa Cruz aberta na tela de login; o robo usara as credenciais salvas" @() $installRoot $launchPath $discoverySource $statusDetails
    }
    if ($statusTitle -match '(?i)\s-\sHome\s-') {
        Complete-SantaCruzResult "logged-in-home" "Santa Cruz aberta e conectada; o robo abrira o Digitalizador" @() $installRoot $launchPath $discoverySource $statusDetails
    }
    if ($statusTitle -match '(?i)\s-\sPedidos\s-' -or $statusTitle.Trim() -eq "Pedidos") {
        Complete-SantaCruzResult "logged-in-orders" "Santa Cruz aberta em Pedidos; o robo abrira ou aplicara o Novo Pedido" @() $installRoot $launchPath $discoverySource $statusDetails
    }
    Complete-SantaCruzResult "open-not-ready" "Santa Cruz esta aberta, mas a rota de pesquisa ainda nao foi reconhecida" @() $installRoot $launchPath $discoverySource $statusDetails
}

if (-not $SearchQuery -and -not $PrepareOnly) {
    Complete-SantaCruzResult "invalid-query" "Medicamento nao informado" @() $(if ($installation) { $installation.InstallRoot }) $(if ($installation) { $installation.LaunchPath }) $(if ($installation) { $installation.Source })
}

$windowProcess = Find-SantaCruzMainWindowProcess
$existingProcess = if ($windowProcess) { $windowProcess } else { Find-SantaCruzProcess }
$window = $null
if ($windowProcess -and -not $windowProcess.Responding) {
    Complete-SantaCruzResult "not-responding" "Santa Cruz esta aberta, mas nao esta respondendo; a cotacao foi interrompida sem fechar o aplicativo" @() `
        $(if ($installation) { $installation.InstallRoot } else { "" }) `
        $(if ($installation) { $installation.LaunchPath } else { "" }) `
        $(if ($installation) { $installation.Source } else { "" }) `
        @{
            ready = $false
            processRunning = $true
            windowDetected = $true
            windowTitle = [string]$windowProcess.MainWindowTitle
            requiresOperator = $true
            canAutoPrepare = $false
        }
}
$window = Find-SantaCruzWindow
if ($window -and -not $existingProcess) {
    try { $existingProcess = Get-Process -Id $window.Current.ProcessId -ErrorAction SilentlyContinue } catch {}
}
$launchAttempted = $false

if ($PrepareOnly -and $existingProcess -and -not $window) {
    Write-SantaCruzTrace "prepare found process without a recognized window; preserving process id=$($existingProcess.Id) while waiting for recovery"
}

# CRITICAL: NEVER launch a second validated Santa Cruz process.
# Unrelated Java applications must not block portable startup on another computer.
$anyRunningProcess = if ($existingProcess) { $existingProcess } else { Find-SantaCruzProcess }

if (-not $window -and -not $existingProcess -and -not $anyRunningProcess -and $installation) {
    try {
        Write-SantaCruzTrace "launching single Santa Cruz process (no existing process or window found)"
        $startArguments = @{
            FilePath = $installation.LaunchPath
            WorkingDirectory = $installation.WorkingDirectory
            PassThru = $true
        }
        if ($installation.Arguments) { $startArguments.ArgumentList = $installation.Arguments }
        Start-Process @startArguments | Out-Null
        $launchAttempted = $true
    } catch {
        Complete-SantaCruzResult "launch-failed" "Falha ao abrir o aplicativo Santa Cruz" $(if ($installation) { $installation.InstallRoot }) $(if ($installation) { $installation.LaunchPath }) $(if ($installation) { $installation.Source })
    }
}

if (-not $window -and -not $existingProcess -and -not $anyRunningProcess -and -not $installation) {
    Complete-SantaCruzResult "not-installed" "Aplicativo Santa Cruz nao localizado"
}

$readyWindow = $null
$searchControl = $null
$lastState = if ($existingProcess -and -not $window -and -not $launchAttempted) { "running-without-window" } else { "starting" }
$loginSubmitted = $false
$updateDeadlineExtended = $false
$digitadorOpened = $false
$newOrderOpened = $false
$productListOpened = $false
$headlessSeenAt = [DateTime]::UtcNow
$deadline = [DateTime]::UtcNow.AddSeconds($StartupWaitSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
    $window = Find-SantaCruzWindow
    if ($window) {
        Write-SantaCruzTrace "window title=$($window.Current.Name) id=$($window.Current.AutomationId)"
        $headlessSeenAt = [DateTime]::UtcNow
        if (-not (Test-SantaCruzWindowResponsive $window)) {
            $lastState = "not-responding"
            Start-Sleep -Seconds 1
            continue
        }
        if (Invoke-NewOrderDialog $window) {
            $lastState = "applying-new-order"
            Start-Sleep -Seconds 2
            continue
        }

        if (Test-SantaCruzUpdating $window) {
            $lastState = "updating"
            if (-not $updateDeadlineExtended) {
                $deadline = [DateTime]::UtcNow.AddSeconds($UpdateWaitSeconds)
                $updateDeadlineExtended = $true
            }
            Start-Sleep -Seconds 1
            continue
        }

        if (-not $loginSubmitted) {
            $loginState = Invoke-LoginIfPresent $window
            if ($loginState -eq "submitted") {
                $loginSubmitted = $true
                $lastState = "login-submitted"
                Start-Sleep -Seconds 3
                continue
            }
            if ($loginState -eq "missing-credentials") {
                Complete-SantaCruzResult "login-required" "Credenciais da Santa Cruz nao configuradas" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
            }
        }

        $table = Find-TableControl $window
        $searchControl = Find-SearchControl $window $table
        if ($table -and $searchControl) {
            $readyWindow = $window
            break
        }

        $title = [string]$window.Current.Name
        if ($title -match '(?i)\s-\sHome\s-' -and -not $digitadorOpened) {
            $digitadorControl = Find-TopActionImage $window
            if ($digitadorControl -and (Invoke-AutomationControl $digitadorControl)) {
                $digitadorOpened = $true
                $lastState = "opening-digitador"
                Start-Sleep -Seconds 2
                continue
            }
        }
        if (($title -match '(?i)\s-\sPedidos\s-' -or $title.Trim() -eq "Pedidos") -and -not $productListOpened) {
            if (Invoke-SantaCruzProductList $window) {
                $productListOpened = $true
                $lastState = "opening-product-list"
                Start-Sleep -Seconds 2
                continue
            }
        }

    } else {
        Write-SantaCruzTrace "window not found"
        $headlessProcess = Find-SantaCruzProcess
        if ($headlessProcess) {
            $lastState = "running-without-window"
            $headlessSeconds = ([DateTime]::UtcNow - $headlessSeenAt).TotalSeconds
            $startupIssue = Get-RecentSantaCruzStartupIssue $installation.InstallRoot
            $headlessLimit = if ($startupIssue) { [Math]::Min($HeadlessGraceSeconds, 15) } else { $HeadlessGraceSeconds }
            if ($headlessSeconds -ge $headlessLimit) {
                $headlessReason = if ($startupIssue) {
                    "$startupIssue; o processo continua sem janela. Aguarde o fornecedor e tente preparar novamente"
                } else {
                    "Processo Santa Cruz ativo sem janela de pesquisa; tente preparar novamente"
                }
                Complete-SantaCruzResult "running-without-window" $headlessReason @() `
                    $installation.InstallRoot $installation.LaunchPath $installation.Source @{
                        ready = $false
                        processRunning = $true
                        windowDetected = $false
                        requiresOperator = $false
                        canAutoPrepare = $true
                    }
            }
        } elseif ($launchAttempted -and $lastState -eq "running-without-window") {
            $startupIssue = Get-RecentSantaCruzStartupIssue $installation.InstallRoot
            if ($startupIssue) {
                Complete-SantaCruzResult "launch-failed" "$startupIssue; o processo encerrou antes de abrir a janela de pesquisa" @() `
                    $installation.InstallRoot $installation.LaunchPath $installation.Source @{
                        ready = $false
                        processRunning = $false
                        windowDetected = $false
                        requiresOperator = $false
                        canAutoPrepare = $true
                    }
            }
        }
    }
    Start-Sleep -Seconds 1
}

if (-not $readyWindow -or -not $searchControl) {
    $finalProcess = Find-SantaCruzProcess
    $finalWindow = Find-SantaCruzWindow
    $status = if ($lastState -eq "running-without-window" -and -not $finalProcess) {
        "launch-failed"
    } elseif ($lastState -eq "updating") {
        "updating"
    } elseif ($lastState -eq "not-responding") {
        "not-responding"
    } elseif ($lastState -eq "running-without-window") {
        "running-without-window"
    } else {
        "search-control-not-found"
    }
    $reason = if ($status -eq "launch-failed") {
        $startupIssue = Get-RecentSantaCruzStartupIssue $installation.InstallRoot
        if ($startupIssue) { "$startupIssue; a Santa Cruz nao abriu" }
        else { "O processo da Santa Cruz encerrou antes de abrir a janela de pesquisa" }
    } elseif ($lastState -eq "updating") {
        "Aplicativo Santa Cruz permanece em atualizacao"
    } elseif ($lastState -eq "not-responding") {
        "Santa Cruz permaneceu sem responder; a cotacao foi interrompida sem fechar o aplicativo"
    } elseif ($lastState -eq "running-without-window") {
        $startupIssue = Get-RecentSantaCruzStartupIssue $installation.InstallRoot
        if ($startupIssue) { "$startupIssue; processo ativo sem janela de pesquisa" }
        else { "Processo Santa Cruz ativo sem janela de pesquisa" }
    } else {
        "Campo de pesquisa da Santa Cruz nao encontrado"
    }
    Complete-SantaCruzResult $status $reason @() $installation.InstallRoot $installation.LaunchPath $installation.Source @{
        ready = $false
        processRunning = [bool]$finalProcess
        windowDetected = [bool]$finalWindow
        requiresOperator = $status -notin @("launch-failed", "updating")
        canAutoPrepare = $status -in @("launch-failed", "updating")
    }
}

if ($PrepareOnly) {
    Complete-SantaCruzResult "ready" "Santa Cruz aberta, conectada e pronta para pesquisar" @() $installation.InstallRoot $installation.LaunchPath $installation.Source @{
        ready = $true
        processRunning = $true
        windowDetected = $true
        windowTitle = [string]$readyWindow.Current.Name
        requiresOperator = $false
        canAutoPrepare = $false
    }
}

$table = Find-TableControl $readyWindow
$columns = Get-SantaCruzColumnMap $table
if (-not $columns) {
    Complete-SantaCruzSearchResult "price-column-not-found" "Cabecalho literal Preco NF nao encontrado ou ambiguo; nenhum preco foi considerado" @() $searchControl $readyWindow $installation
}

function Get-SantaCruzDosageTokens {
    param([string]$Value)
    if (-not $Value) { return @() }
    $tokens = @()
    foreach ($match in [regex]::Matches($Value, '(?i)(?<!\d)(\d+(?:[.,]\d+)?)\s*(mcg|mg|g|ml)\b')) {
        $number = $match.Groups[1].Value.Replace(",", ".")
        $unit = $match.Groups[2].Value.ToLowerInvariant()
        $token = "$number$unit"
        if ($tokens -notcontains $token) { $tokens += $token }
    }
    return @($tokens)
}

function Test-SantaCruzSearchRow {
    param(
        $Row,
        [string]$Query,
        [string]$QueryToken,
        [bool]$IsEanSearch,
        [string[]]$RequiredDosages
    )
    if ($IsEanSearch) { return $Row.ean -eq $Query }

    $normalizedName = ConvertTo-NormalizedText $Row.name
    if (-not $QueryToken -or -not $normalizedName.Contains($QueryToken)) { return $false }

    $compactName = $normalizedName.Replace(",", ".") -replace '\s+', ''
    foreach ($dosage in @($RequiredDosages)) {
        if ($dosage -and -not $compactName.Contains($dosage)) { return $false }
    }
    return $true
}

function Invoke-SantaCruzSearchAttempt {
    param(
        $InitialTable,
        $Columns,
        $SearchControl,
        $ReadyWindow,
        [string]$Query,
        [bool]$UseEnter,
        [string[]]$RequiredDosages
    )

    $attemptTable = $InitialTable
    $previousSignature = Get-TableSignature $attemptTable $Columns
    if (-not (Ensure-SantaCruzSearchInput $SearchControl $Query $ReadyWindow $UseEnter)) {
        return [PSCustomObject]@{ Status = "search-input-failed"; Results = @(); Table = $attemptTable }
    }

    $normalizedQuery = ConvertTo-NormalizedText $Query
    $queryToken = @($normalizedQuery -split '\s+' | Where-Object { $_.Length -ge 3 } | Select-Object -First 1)
    $isEanSearch = $Query -match '^\d{13}$'
    $readDeadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(8, $ResultWaitSeconds))
    $lastObservedSignature = ""
    $supplierStoppedResponding = $false
    $stableFreshSignature = ""
    $stableFreshCount = 0
    $emptyStableSignature = ""
    $emptyStableCount = 0
    $freshStableGridObserved = $false
    $confirmedEmpty = $false
    $scanTimedOut = $false
    $stockUnresolved = $false
    $results = @()

    Start-Sleep -Milliseconds 800
    while ([DateTime]::UtcNow -lt $readDeadline) {
        $window = $ReadyWindow
        if ($window) {
            if (-not (Test-SantaCruzWindowResponsive $window)) {
                $supplierStoppedResponding = $true
                Write-SantaCruzTrace "Santa Cruz stopped responding while waiting for search results"
                Start-Sleep -Seconds 1
                continue
            }
            $refreshedWindow = Find-SantaCruzWindow
            if ($refreshedWindow) { $window = $refreshedWindow }
            $candidateTable = Find-TableControl $window
            if ($candidateTable) { $attemptTable = $candidateTable }
        }
        if ($attemptTable) {
            $currentSignature = Get-TableSignature $attemptTable $Columns
            if ($currentSignature -ne $lastObservedSignature) {
                Write-SantaCruzTrace "table signature changed previous='$lastObservedSignature' current='$currentSignature'"
                $lastObservedSignature = $currentSignature
            }

            if ($currentSignature -match '^0:') {
                if ($currentSignature -eq $emptyStableSignature) {
                    $emptyStableCount++
                } else {
                    $emptyStableSignature = $currentSignature
                    $emptyStableCount = 1
                }
            } else {
                $emptyStableSignature = ""
                $emptyStableCount = 0
            }
            $confirmedEmpty = $emptyStableCount -ge 2

            if ($currentSignature -and $currentSignature -ne $previousSignature) {
                if ($currentSignature -eq $stableFreshSignature) {
                    $stableFreshCount++
                } else {
                    $stableFreshSignature = $currentSignature
                    $stableFreshCount = 1
                }
            } else {
                $stableFreshSignature = ""
                $stableFreshCount = 0
            }
            $freshStableGridObserved = $stableFreshCount -ge 2
            if ($confirmedEmpty) { break }

            if ($freshStableGridObserved) {
                $scanSeconds = [Math]::Max(15, [Math]::Min(45, $ResultWaitSeconds * 2))
                $scanDeadline = [DateTime]::UtcNow.AddSeconds($scanSeconds)
                $scanResult = Read-AllSantaCruzRowsWithScroll $attemptTable $Columns $scanDeadline
                if (-not $scanResult.Complete) {
                    $scanTimedOut = $true
                    Write-SantaCruzTrace "complete grid scan blocked reason=$($scanResult.Reason)"
                } else {
                    $results = @($scanResult.Rows | Where-Object {
                        Test-SantaCruzSearchRow $_ $Query $queryToken[0] $isEanSearch $RequiredDosages
                    })
                    $stockUnresolved = @($results | Where-Object {
                        $_.stock -eq "estoque desconhecido"
                    }).Count -gt 0
                    if ($stockUnresolved) {
                        Write-SantaCruzTrace "matching rows contain unresolved Disp. evidence; supplier result blocked"
                    }
                }
                break
            }
        }
        Start-Sleep -Milliseconds 500
    }

    $status = if (-not $attemptTable) {
        "table-not-found"
    } elseif ($supplierStoppedResponding -and $results.Count -eq 0) {
        "not-responding"
    } elseif ($confirmedEmpty -and $lastObservedSignature -ne $previousSignature) {
        "empty"
    } elseif ($confirmedEmpty) {
        "stale-empty"
    } elseif ($scanTimedOut) {
        "scan-timeout"
    } elseif ($stockUnresolved) {
        "stock-unresolved"
    } elseif (-not $freshStableGridObserved) {
        "stale-results"
    } elseif ($results.Count -eq 0) {
        "empty"
    } else {
        "ok"
    }
    return [PSCustomObject]@{ Status = $status; Results = @($results); Table = $attemptTable }
}

$attempts = New-Object System.Collections.ArrayList
[void]$attempts.Add([PSCustomObject]@{ Query = $SearchQuery; UseEnter = $false })
$requiredDosages = @(Get-SantaCruzDosageTokens $SearchQuery)
if ($FallbackSearchQuery -and
    (ConvertTo-NormalizedText $FallbackSearchQuery) -ne (ConvertTo-NormalizedText $SearchQuery) -and
    $SearchQuery -notmatch '^\d{13}$') {
    [void]$attempts.Add([PSCustomObject]@{ Query = $FallbackSearchQuery; UseEnter = $true })
}

$attemptResult = $null
for ($attemptIndex = 0; $attemptIndex -lt $attempts.Count; $attemptIndex++) {
    $attempt = $attempts[$attemptIndex]
    Write-SantaCruzTrace "search attempt=$($attemptIndex + 1) query='$($attempt.Query)' enter=$($attempt.UseEnter)"
    $attemptResult = Invoke-SantaCruzSearchAttempt `
        $table $columns $searchControl $readyWindow $attempt.Query $attempt.UseEnter $requiredDosages
    if ($attemptResult.Table) { $table = $attemptResult.Table }
    if ($attemptResult.Status -eq "ok") { break }
    if ($attemptResult.Status -in @("empty", "stale-empty") -and
        $attemptIndex -lt ($attempts.Count - 1)) {
        Write-SantaCruzTrace "empty result; retrying with active ingredient in the same Santa Cruz session"
        continue
    }
    break
}

if (-not $attemptResult -or $attemptResult.Status -eq "table-not-found") {
    Complete-SantaCruzSearchResult "table-not-found" "Grade de resultados da Santa Cruz nao encontrada" @() $searchControl $readyWindow $installation
}
if ($attemptResult.Status -eq "search-input-failed") {
    Complete-SantaCruzSearchResult "search-input-failed" "Nao foi possivel escrever o medicamento" @() $searchControl $readyWindow $installation
}
if ($attemptResult.Status -eq "not-responding") {
    Complete-SantaCruzSearchResult "not-responding" "Santa Cruz travou durante a pesquisa; nenhum preco foi considerado" @() $searchControl $readyWindow $installation
}
if ($attemptResult.Status -in @("stale-results", "stale-empty")) {
    Complete-SantaCruzSearchResult "stale-results" "A grade da Santa Cruz nao confirmou uma atualizacao nova e estavel para esta pesquisa" @() $searchControl $readyWindow $installation
}
if ($attemptResult.Status -eq "scan-timeout") {
    Complete-SantaCruzSearchResult "scan-timeout" "A grade da Santa Cruz excedeu o prazo da varredura completa; nenhum preco parcial foi considerado" @() $searchControl $readyWindow $installation
}
if ($attemptResult.Status -eq "empty") {
    Complete-SantaCruzSearchResult "empty" "Pesquisa concluida sem produtos relacionados, inclusive na tentativa pelo principio ativo" @() $searchControl $readyWindow $installation
}

$results = @($attemptResult.Results)

# CRITICAL: The Santa Cruz GUI application window is ALWAYS left OPEN on screen after a search.
# It is NEVER closed, terminated, or hidden by the automation script so the operator can continue quoting.
Complete-SantaCruzSearchResult "ok" "Pesquisa concluida e campo limpo para o proximo medicamento" $results $searchControl $readyWindow $installation
