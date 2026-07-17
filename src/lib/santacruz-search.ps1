[System.Reflection.Assembly]::LoadFile("C:\Windows\Microsoft.NET\Framework\v4.0.30319\WPF\UIAutomationClient.dll") | Out-Null
[System.Reflection.Assembly]::LoadFile("C:\Windows\Microsoft.NET\Framework\v4.0.30319\WPF\UIAutomationTypes.dll") | Out-Null
[System.Reflection.Assembly]::LoadFile("C:\Windows\Microsoft.NET\Framework\v4.0.30319\System.Windows.Forms.dll") | Out-Null

$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$SearchQuery = if ($args.Count -gt 0) { [string]$args[0] } else { "" }
$SantaUser = if ($args.Count -gt 1) { [string]$args[1] } else { "" }
$SantaPassword = if ($args.Count -gt 2) { [string]$args[2] } else { "" }
$SantaClientCode = if ($args.Count -gt 3) { [string]$args[3] } else { "" }
$DiscoveryOnly = $SearchQuery -eq "--discover-only" -or $env:SANTACRUZ_DISCOVERY_ONLY -eq "true"

$StartupWaitSeconds = 180
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

$HeadlessGraceSeconds = 90
if ($env:SANTACRUZ_HEADLESS_GRACE_SECONDS) {
    $parsedHeadlessGrace = 0
    if ([int]::TryParse($env:SANTACRUZ_HEADLESS_GRACE_SECONDS, [ref]$parsedHeadlessGrace) -and $parsedHeadlessGrace -gt 0) {
        $HeadlessGraceSeconds = $parsedHeadlessGrace
    }
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$cacheDirectory = Join-Path $env:LOCALAPPDATA "WimifarmaCotacao"
$discoveryCachePath = Join-Path $cacheDirectory "santacruz-install.json"

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
    $windows = $desktop.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.PropertyCondition]::TrueCondition
    )
    foreach ($candidateWindow in $windows) {
        try {
            $title = [string]$candidateWindow.Current.Name
            $processPath = Get-ProcessPath $candidateWindow.Current.ProcessId
            if ($title -match '(?i)santa\s*-?\s*cruz|pedido\s+eletr' -or
                $processPath -match '(?i)santa\s*-?\s*cruz|digitador-sd') {
                return $candidateWindow
            }
        } catch {}
    }
    return $null
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
    $knownTable = Find-ControlByAutomationId $Window "JavaFX1172"
    if ($knownTable) { return $knownTable }
    try {
        return $Window.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Table
            ))
        )
    } catch { return $null }
}

function Find-SearchControl {
    param($Window)
    $knownSearch = Find-ControlByAutomationId $Window "JavaFX272"
    if ($knownSearch -and $knownSearch.Current.IsEnabled -and -not $knownSearch.Current.IsOffscreen) {
        return $knownSearch
    }

    try {
        $editCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        $scored = @()
        foreach ($edit in $edits) {
            if (-not $edit.Current.IsEnabled -or $edit.Current.IsOffscreen -or $edit.Current.IsPassword) { continue }
            $identity = "$($edit.Current.Name) $($edit.Current.AutomationId) $($edit.Current.HelpText)"
            if ($identity -match '(?i)senha|password|usuario|login|cliente') { continue }
            $score = 0
            if ($identity -match '(?i)busca|pesquis|produto|ean|descri|codigo') { $score += 100 }
            $bounds = $edit.Current.BoundingRectangle
            if ($bounds.Width -ge 220) { $score += 20 }
            if ($bounds.Top -gt $Window.Current.BoundingRectangle.Top + 50) { $score += 5 }
            $scored += [PSCustomObject]@{ Element = $edit; Score = $score }
        }
        return ($scored | Sort-Object Score -Descending | Select-Object -First 1).Element
    } catch { return $null }
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
        $dataCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::DataItem
        )
        $items = $Table.FindAll([System.Windows.Automation.TreeScope]::Descendants, $dataCondition)
        $parts = @()
        for ($index = 0; $index -lt [Math]::Min($items.Count, 30); $index++) {
            $parts += [string]$items[$index].Current.Name
        }
        return "$($items.Count):$($parts -join '|')"
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

    $scrollPattern = $null
    try { $scrollPattern = $Table.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern) } catch {}
    $uniqueRows = @{}
    $dataCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::DataItem
    )

    for ($loop = 0; $loop -lt 12; $loop++) {
        $dataItems = $Table.FindAll([System.Windows.Automation.TreeScope]::Descendants, $dataCondition)
        $currentRow = @()
        foreach ($item in $dataItems) {
            $value = [string]$item.Current.Name
            if ($value -match '^\d{13}$') {
                if ($currentRow.Count -gt 0 -and $currentRow[0] -match '^\d{13}$') {
                    $key = "$($currentRow[0])|$($currentRow[1])"
                    if (-not $uniqueRows.ContainsKey($key)) { $uniqueRows[$key] = $currentRow }
                }
                $currentRow = @($value)
            } elseif ($currentRow.Count -gt 0) {
                $currentRow += $value
            }
        }
        if ($currentRow.Count -gt 0 -and $currentRow[0] -match '^\d{13}$') {
            $key = "$($currentRow[0])|$($currentRow[1])"
            if (-not $uniqueRows.ContainsKey($key)) { $uniqueRows[$key] = $currentRow }
        }

        if ($scrollPattern -and $scrollPattern.Current.VerticallyScrollable) {
            $oldPercent = $scrollPattern.Current.VerticalScrollPercent
            if ($oldPercent -ge 99.0) { break }
            try {
                $scrollPattern.Scroll(
                    [System.Windows.Automation.ScrollAmount]::NoAmount,
                    [System.Windows.Automation.ScrollAmount]::LargeIncrement
                )
                Start-Sleep -Milliseconds 350
                if ($scrollPattern.Current.VerticalScrollPercent -eq $oldPercent) { break }
            } catch { break }
        } else { break }
    }

    $output = New-Object System.Collections.Generic.List[object]
    foreach ($row in $uniqueRows.Values) {
        if ($row.Count -lt 14) { continue }
        $finalPrice = Parse-DoubleSafe $row[13]
        if ($finalPrice -le 0) { continue }
        $laboratory = if ($row.Count -gt 16) { $row[16] } else { "N/A" }
        $output.Add([PSCustomObject]@{
            ean = $row[0]
            name = $row[2]
            price = Parse-DoubleSafe $row[6]
            st = Parse-DoubleSafe $row[12]
            unitCostWithSt = $finalPrice
            stock = "Disponivel"
            laboratory = $laboratory
            listType = "N"
        })
    }
    return @($output)
}

$installation = Find-SantaCruzInstallation
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
if (-not $window -and -not $existingProcess -and $installation) {
    try {
        $startArguments = @{
            FilePath = $installation.LaunchPath
            WorkingDirectory = $installation.WorkingDirectory
            PassThru = $true
        }
        if ($installation.Arguments) { $startArguments.ArgumentList = $installation.Arguments }
        Start-Process @startArguments | Out-Null
    } catch {
        Complete-SantaCruzResult "launch-failed" "Falha ao abrir o aplicativo Santa Cruz" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
    }
}

if (-not $window -and -not $installation) {
    Complete-SantaCruzResult "not-installed" "Aplicativo Santa Cruz nao localizado"
}

$readyWindow = $null
$searchControl = $null
$lastState = if ($existingProcess -and -not $window) { "running-without-window" } else { "starting" }
$loginSubmitted = $false
$updateDeadlineExtended = $false
$deadline = [DateTime]::UtcNow.AddSeconds($StartupWaitSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
    $window = Find-SantaCruzWindow
    if ($window) {
        $searchControl = Find-SearchControl $window
        if ($searchControl) {
            $readyWindow = $window
            break
        }

        $summary = Get-WindowTextSummary $window
        if ($summary -match '(?i)atualiz|importando|sincroniz|download') {
            $lastState = "updating"
            if (-not $updateDeadlineExtended) {
                $deadline = [DateTime]::UtcNow.AddSeconds($UpdateWaitSeconds)
                $updateDeadlineExtended = $true
            }
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
    } else {
        $headlessProcess = Find-SantaCruzProcess
        if ($headlessProcess) {
            $lastState = "running-without-window"
            try {
                $headlessAgeSeconds = ([DateTime]::Now - $headlessProcess.StartTime).TotalSeconds
                if ($headlessAgeSeconds -ge $HeadlessGraceSeconds) {
                    Complete-SantaCruzResult "running-without-window" "Processo Santa Cruz ativo sem janela de pesquisa" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
                }
            } catch {}
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

try {
    $shell = New-Object -ComObject WScript.Shell
    $shell.AppActivate($readyWindow.Current.ProcessId) | Out-Null
    Start-Sleep -Milliseconds 250
} catch {}

$table = Find-TableControl $readyWindow
$previousSignature = Get-TableSignature $table
if (-not (Set-AutomationValue $searchControl $SearchQuery)) {
    Complete-SantaCruzResult "search-input-failed" "Nao foi possivel escrever o medicamento" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

try {
    $searchControl.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
} catch {
    Complete-SantaCruzResult "search-submit-failed" "Nao foi possivel iniciar a pesquisa" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

$resultDeadline = [DateTime]::UtcNow.AddSeconds($ResultWaitSeconds)
$currentSignature = ""
while ([DateTime]::UtcNow -lt $resultDeadline) {
    Start-Sleep -Milliseconds 500
    $window = Find-SantaCruzWindow
    if ($window) { $table = Find-TableControl $window }
    if (-not $table) { continue }
    $currentSignature = Get-TableSignature $table
    if ($currentSignature -and $currentSignature -ne "0:" -and
        ($currentSignature -ne $previousSignature -or ([DateTime]::UtcNow.AddSeconds(-2) -gt $resultDeadline.AddSeconds(-$ResultWaitSeconds)))) {
        break
    }
}

if (-not $table) {
    Complete-SantaCruzResult "table-not-found" "Grade de resultados da Santa Cruz nao encontrada" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

$results = Read-SantaCruzRows $table
if ($results.Count -eq 0) {
    Complete-SantaCruzResult "empty" "Pesquisa concluida sem produtos" @() $installation.InstallRoot $installation.LaunchPath $installation.Source
}

Complete-SantaCruzResult "ok" "Pesquisa concluida" $results $installation.InstallRoot $installation.LaunchPath $installation.Source
