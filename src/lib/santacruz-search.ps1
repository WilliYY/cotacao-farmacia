[System.Reflection.Assembly]::LoadFile("C:\Windows\Microsoft.NET\Framework\v4.0.30319\WPF\UIAutomationClient.dll") | Out-Null
[System.Reflection.Assembly]::LoadFile("C:\Windows\Microsoft.NET\Framework\v4.0.30319\WPF\UIAutomationTypes.dll") | Out-Null
[System.Reflection.Assembly]::LoadFile("C:\Windows\Microsoft.NET\Framework\v4.0.30319\System.Windows.Forms.dll") | Out-Null

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
    public static extern void SwitchToThisWindow(System.IntPtr handle, bool useAltTab);
}
"@

$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$SearchQuery = if ($args.Count -gt 0) { [string]$args[0] } else { "" }
$SantaUser = if ($args.Count -gt 1) { [string]$args[1] } else { "" }
$SantaPassword = if ($args.Count -gt 2) { [string]$args[2] } else { "" }
$SantaClientCode = if ($args.Count -gt 3) { [string]$args[3] } else { "" }
$DiscoveryOnly = $SearchQuery -eq "--discover-only" -or $env:SANTACRUZ_DISCOVERY_ONLY -eq "true"

$StartupWaitSeconds = 240
if ($env:SANTACRUZ_STARTUP_WAIT_SECONDS) {
    $parsedWait = 0
    if ([int]::TryParse($env:SANTACRUZ_STARTUP_WAIT_SECONDS, [ref]$parsedWait) -and $parsedWait -gt 0) {
        $StartupWaitSeconds = $parsedWait
    }
}

$ResultWaitSeconds = 20
if ($env:SANTACRUZ_RESULT_WAIT_SECONDS) {
    $parsedResultWait = 0
    if ([int]::TryParse($env:SANTACRUZ_RESULT_WAIT_SECONDS, [ref]$parsedResultWait) -and $parsedResultWait -gt 0) {
        $ResultWaitSeconds = $parsedResultWait
    }
}

$UpdateWaitSeconds = 600
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
$cacheDirectory = Join-Path $env:LOCALAPPDATA "WimifarmaCotacao"
$discoveryCachePath = Join-Path $cacheDirectory "santacruz-install.json"
$tracePath = [string]$env:SANTACRUZ_TRACE_PATH
$originalForegroundWindow = [SantaCruzMouse]::GetForegroundWindow()

function Write-SantaCruzTrace {
    param([string]$Message)
    if (-not $tracePath) { return }
    try {
        "$(Get-Date -Format 'HH:mm:ss.fff') $Message" | Add-Content -LiteralPath $tracePath -Encoding UTF8
    } catch {}
}

function Complete-SantaCruzResult {
    param(
        [string]$Status,
        [string]$Reason = "",
        [object[]]$Results = @(),
        [string]$InstallRoot = "",
        [string]$LaunchPath = "",
        [string]$DiscoverySource = ""
    )

    $payload = [ordered]@{
        status = $Status
        reason = $Reason
        installRoot = $InstallRoot
        launchPath = $LaunchPath
        discoverySource = $DiscoverySource
        results = @($Results)
    }
    if ($env:SANTACRUZ_RESTORE_FOCUS -ne "false" -and $originalForegroundWindow -ne [System.IntPtr]::Zero) {
        try { [SantaCruzMouse]::SetForegroundWindow($originalForegroundWindow) | Out-Null } catch {}
    }
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
    $candidate = [Environment]::ExpandEnvironmentVariables($CandidatePath.Trim().Trim('"'))
    $candidate = $candidate -replace ',\d+$', ''

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
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Programs\Pe - SantaCruz" }),
        "C:\Pe - SantaCruz"
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
    } catch { return $null }

    $candidates = @()
    foreach ($candidateWindow in $windows) {
        try {
            $title = [string]$candidateWindow.Current.Name
            if ($title -match '(?i)santa\s*-?\s*cruz|pedido\s+eletr' -or $title -eq "Pedidos") {
                $bounds = $candidateWindow.Current.BoundingRectangle
                $score = [double]($bounds.Width * $bounds.Height)
                if ($title -eq "Pedidos") { $score += 10000000 }
                if ($title -match '(?i)^Pedido Eletr.nico SantaCruz') { $score += 1000000 }
                $candidates += [PSCustomObject]@{ Window = $candidateWindow; Score = $score }
            }
        } catch {}
    }
    $winner = $candidates | Sort-Object Score -Descending | Select-Object -First 1
    return $(if ($winner) { $winner.Window } else { $null })
}

function Find-SantaCruzProcess {
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
        try {
            if ($process.ProcessName -match '^(?i:javaw|digitador-sd|Pe - SantaCruz)$' -and
                $process.Path -match '(?i)santa\s*-?\s*cruz|digitador-sd') {
                return $process
            }
        } catch {}
    }
    return $null
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
    try {
        $tableCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Table
        )
        $tables = $Window.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            $tableCondition
        )

        foreach ($table in $tables) {
            $names = New-Object System.Collections.Generic.HashSet[string]
            $elements = $table.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::TrueCondition
            )
            foreach ($element in $elements) {
                $name = [string]$element.Current.Name
                if ($name) { $names.Add((ConvertTo-NormalizedText $name)) | Out-Null }
            }
            if ($names.Contains("codigo ean") -and $names.Contains("descricao") -and
                $names.Contains("preco nf") -and $names.Contains("entrega") -and
                $names.Contains("ofertaol") -and $names.Contains("laboratorio")) {
                try {
                    $grid = $table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
                    if ($grid.Current.ColumnCount -eq 18) { return $table }
                } catch {}
            }
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
    } catch { return $null }
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

function Find-SearchSubmitControl {
    param($Window, $SearchControl)
    if (-not $Window -or -not $SearchControl) { return $null }
    try {
        $searchBounds = $SearchControl.Current.BoundingRectangle
        $comboCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ComboBox
        )
        $combos = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $comboCondition)
        $rightEdge = $searchBounds.Right
        foreach ($combo in $combos) {
            $bounds = $combo.Current.BoundingRectangle
            if (-not $combo.Current.IsOffscreen -and [Math]::Abs($bounds.Top - $searchBounds.Top) -le 15) {
                $rightEdge = [Math]::Max($rightEdge, $bounds.Right)
            }
        }

        $imageCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Image
        )
        $images = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $imageCondition)
        $candidates = @()
        foreach ($image in $images) {
            $bounds = $image.Current.BoundingRectangle
            if ($image.Current.IsOffscreen -or -not $image.Current.IsEnabled) { continue }
            if ([Math]::Abs($bounds.Top - $searchBounds.Top) -gt 20) { continue }
            if ($bounds.Left -lt $rightEdge -or $bounds.Width -lt 20 -or $bounds.Width -gt 50) { continue }
            $candidates += [PSCustomObject]@{ Element = $image; Distance = $bounds.Left - $rightEdge }
        }
        $winner = $candidates | Sort-Object Distance | Select-Object -First 1
        if ($winner) { return $winner.Element }
    } catch {}
    return $null
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
            Start-Sleep -Milliseconds 180
        }
        try { $Element.SetFocus() } catch {}
        if ($bounds.Width -gt 0 -and $bounds.Height -gt 0) {
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

function Get-TableSignature {
    param($Table)
    if (-not $Table) { return "" }
    try {
        $grid = $Table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
        $parts = @()
        for ($row = 0; $row -lt [Math]::Min($grid.Current.RowCount, 5); $row++) {
            foreach ($column in @(0, 2, 13)) {
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

function Read-SantaCruzRows {
    param($Table)
    if (-not $Table) { return @() }
    $output = New-Object System.Collections.Generic.List[object]
    try {
        $grid = $Table.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
        if ($grid.Current.ColumnCount -lt 18) { return @() }
        for ($row = 0; $row -lt $grid.Current.RowCount; $row++) {
            $ean = Get-GridCellText $grid $row 0
            $name = Get-GridCellText $grid $row 2
            $priceNf = Parse-DoubleSafe (Get-GridCellText $grid $row 13)
            if ($ean -notmatch '^\d{13}$' -or -not $name -or $priceNf -le 0) { continue }
            $availabilityEvidence = Get-GridCellStatus $grid $row 3
            $normalizedAvailability = ConvertTo-NormalizedText $availabilityEvidence
            $stock = if ($normalizedAvailability -match 'indispon|sem estoque|vermelh|nao dispon') {
                "sem estoque"
            } elseif ($normalizedAvailability -match 'dispon|verde|em estoque') {
                "Disponivel"
            } else {
                "estoque desconhecido"
            }
            $output.Add([PSCustomObject]@{
                ean = $ean
                name = $name
                price = $priceNf
                priceNf = $priceNf
                factoryPrice = Parse-DoubleSafe (Get-GridCellText $grid $row 6)
                st = Parse-DoubleSafe (Get-GridCellText $grid $row 12)
                unitCostWithSt = $priceNf
                stock = $stock
                stockEvidence = $availabilityEvidence
                laboratory = Get-GridCellText $grid $row 17
                quantityBox = Get-GridCellText $grid $row 5
                category = Get-GridCellText $grid $row 14
                listType = Get-GridCellText $grid $row 15
            })
        }
    } catch { return @() }
    return @($output)
}

Write-SantaCruzTrace "start query=$SearchQuery"
$installation = Find-SantaCruzInstallation
Write-SantaCruzTrace "installation path=$($installation.LaunchPath) source=$($installation.Source)"
if ($DiscoveryOnly) {
    if ($installation) {
        Complete-SantaCruzResult "discovered" "Aplicativo localizado" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
    }
    Complete-SantaCruzResult "not-installed" "Aplicativo Santa Cruz nao localizado"
}

if (-not $SearchQuery) {
    Complete-SantaCruzResult "invalid-query" "Medicamento nao informado" @() $(if ($installation) { $installation.InstallRoot }) $(if ($installation) { $installation.LaunchPath }) $(if ($installation) { $installation.Source })
}

$window = Find-SantaCruzWindow
$existingProcess = Find-SantaCruzProcess
$launchAttempted = $false
if (-not $window -and $installation) {
    try {
        $startArguments = @{
            FilePath = $installation.LaunchPath
            WorkingDirectory = $installation.WorkingDirectory
            PassThru = $true
        }
        if ($installation.Arguments) { $startArguments.ArgumentList = $installation.Arguments }
        Start-Process @startArguments | Out-Null
        $launchAttempted = $true
    } catch {
        Complete-SantaCruzResult "launch-failed" "Falha ao abrir o aplicativo Santa Cruz" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
    }
}

if (-not $window -and -not $installation) {
    Complete-SantaCruzResult "not-installed" "Aplicativo Santa Cruz nao localizado"
}

$readyWindow = $null
$searchControl = $null
$lastState = if ($existingProcess -and -not $window -and -not $launchAttempted) { "running-without-window" } else { "starting" }
$loginSubmitted = $false
$updateDeadlineExtended = $false
$digitadorOpened = $false
$newOrderOpened = $false
$headlessSeenAt = [DateTime]::UtcNow
$deadline = [DateTime]::UtcNow.AddSeconds($StartupWaitSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
    $window = Find-SantaCruzWindow
    if ($window) {
        Write-SantaCruzTrace "window title=$($window.Current.Name) id=$($window.Current.AutomationId)"
        $headlessSeenAt = [DateTime]::UtcNow
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

        if ($title -match '(?i)\s-\sPedidos\s-' -and -not $newOrderOpened) {
            $newOrderControl = Find-TopActionImage $window
            if ($newOrderControl -and (Invoke-AutomationControl $newOrderControl)) {
                $newOrderOpened = $true
                $lastState = "opening-new-order"
                Start-Sleep -Seconds 2
                continue
            }
        }

        $table = Find-TableControl $window
        $searchControl = Find-SearchControl $window $table
        if ($table -and $searchControl) {
            $readyWindow = $window
            break
        }
    } else {
        Write-SantaCruzTrace "window not found"
        $headlessProcess = Find-SantaCruzProcess
        if ($headlessProcess) {
            $lastState = "running-without-window"
            $headlessSeconds = ([DateTime]::UtcNow - $headlessSeenAt).TotalSeconds
            if ($headlessSeconds -ge $HeadlessGraceSeconds) {
                Complete-SantaCruzResult "running-without-window" "Processo Santa Cruz ativo sem janela de pesquisa" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
            }
        }
    }
    Start-Sleep -Seconds 1
}

if (-not $readyWindow -or -not $searchControl) {
    $status = if ($lastState -eq "updating") {
        "updating"
    } elseif ($lastState -eq "running-without-window") {
        "running-without-window"
    } else {
        "search-control-not-found"
    }
    $reason = if ($lastState -eq "updating") {
        "Aplicativo Santa Cruz permanece em atualizacao"
    } elseif ($lastState -eq "running-without-window") {
        "Processo Santa Cruz ativo sem janela de pesquisa"
    } else {
        "Campo de pesquisa da Santa Cruz nao encontrado"
    }
    Complete-SantaCruzResult $status $reason @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

$table = Find-TableControl $readyWindow
$searchSubmitControl = Find-SearchSubmitControl $readyWindow $searchControl
$previousSignature = Get-TableSignature $table
$clearedSignature = $previousSignature

if (-not (Type-AutomationValue $searchControl $SearchQuery)) {
    Complete-SantaCruzResult "search-input-failed" "Nao foi possivel escrever o medicamento" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

if ($searchSubmitControl) {
    if (-not (Invoke-AutomationControl $searchSubmitControl)) {
        Complete-SantaCruzResult "search-submit-failed" "Nao foi possivel clicar na lupa de pesquisa" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
    }
} else {
    try {
        $searchControl.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    } catch {
        Complete-SantaCruzResult "search-submit-failed" "Nao foi possivel iniciar a pesquisa" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
    }
}

$resultDeadline = [DateTime]::UtcNow.AddSeconds($ResultWaitSeconds)
$currentSignature = ""
$lastCandidateSignature = ""
$stableSignatureReads = 0
while ([DateTime]::UtcNow -lt $resultDeadline) {
    Start-Sleep -Milliseconds 500
    $window = Find-SantaCruzWindow
    if ($window) {
        $candidateTable = Find-TableControl $window
        if ($candidateTable) { $table = $candidateTable }
    }
    if (-not $table) { continue }
    $currentSignature = Get-TableSignature $table
    if ($currentSignature -and $currentSignature -ne "0:" -and $currentSignature -ne $clearedSignature) {
        if ($currentSignature -eq $lastCandidateSignature) { $stableSignatureReads++ }
        else {
            $lastCandidateSignature = $currentSignature
            $stableSignatureReads = 1
        }
        if ($stableSignatureReads -ge 2) { break }
    }
}

if (-not $table) {
    Complete-SantaCruzResult "table-not-found" "Grade de resultados da Santa Cruz nao encontrada" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

$results = @()
$readDeadline = [DateTime]::UtcNow.AddSeconds(4)
while ([DateTime]::UtcNow -lt $readDeadline -and $results.Count -eq 0) {
    $window = Find-SantaCruzWindow
    if ($window) {
        $candidateTable = Find-TableControl $window
        if ($candidateTable) { $table = $candidateTable }
    }
    $results = @(Read-SantaCruzRows $table)
    if ($results.Count -eq 0) { Start-Sleep -Milliseconds 400 }
}
if ($results.Count -eq 0) {
    if ($currentSignature -eq "0:") {
        Complete-SantaCruzResult "empty" "Pesquisa concluida sem produtos" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
    }
    Complete-SantaCruzResult "stale-results" "A grade mudou, mas os produtos ainda nao puderam ser lidos" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

$normalizedQuery = ConvertTo-NormalizedText $SearchQuery
$queryToken = @($normalizedQuery -split '\s+' | Where-Object { $_.Length -ge 4 } | Select-Object -First 1)
$hasMatchingResult = $false
foreach ($result in $results) {
    $normalizedName = ConvertTo-NormalizedText $result.name
    if (($SearchQuery -match '^\d{13}$' -and $result.ean -eq $SearchQuery) -or
        ($queryToken.Count -gt 0 -and $normalizedName.Contains($queryToken[0]))) {
        $hasMatchingResult = $true
        break
    }
}
if (-not $hasMatchingResult) {
    Complete-SantaCruzResult "stale-results" "A grade exibida nao corresponde ao medicamento pesquisado" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

Complete-SantaCruzResult "ok" "Pesquisa concluida" $results $installation.InstallRoot $installation.LaunchPath $installation.Source
