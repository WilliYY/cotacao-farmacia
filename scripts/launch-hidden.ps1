Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$LauncherArguments = @($args)

function Show-LauncherError {
    param([string]$Message)

    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show(
            $Message,
            'Wimifarma Cotacao',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
    } catch {
        Write-Error $Message
    }
}

function Test-LauncherWorkspaceWritable {
    param([string]$Directory)

    $probePath = $null
    try {
        if (-not (Test-Path -LiteralPath $Directory)) {
            [void](New-Item -ItemType Directory -Path $Directory -Force)
        }

        $probePath = Join-Path $Directory ".launcher-write-$PID.tmp"
        [System.IO.File]::WriteAllText($probePath, 'ok')
        return $true
    } catch {
        return $false
    } finally {
        if ($probePath -and [System.IO.File]::Exists($probePath)) {
            [System.IO.File]::Delete($probePath)
        }
    }
}

function ConvertTo-CmdQuotedArgument {
    param([string]$Value)
    return '"' + $Value.Replace('"', '""') + '"'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
$logFileName = 'startup-{0}-{1}.log' -f ([DateTime]::Now.ToString('yyyyMMdd-HHmmss')), $PID
$logPath = Join-Path $logDirectory $logFileName
$batchPath = Join-Path $projectRoot 'cotacao.bat'

if ($LauncherArguments -contains '--launcher-self-test') {
    [pscustomobject]@{
        projectRoot = $projectRoot
        batchExists = Test-Path -LiteralPath $batchPath -PathType Leaf
        nodeAvailable = [bool](Get-Command node -ErrorAction SilentlyContinue)
        workspaceWritable = Test-LauncherWorkspaceWritable -Directory $logDirectory
        arguments = @($LauncherArguments)
    } | ConvertTo-Json -Compress
    exit 0
}

if (-not (Test-LauncherWorkspaceWritable -Directory $logDirectory)) {
    Show-LauncherError (
        "A pasta do Wimifarma Cotacao nao permite gravacao.`r`n`r`n" +
        "Copie a pasta completa do pendrive para a Area de Trabalho e tente novamente."
    )
    exit 2
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    [System.IO.File]::AppendAllText(
        $logPath,
        "[$([DateTime]::Now.ToString('s'))] Node.js nao encontrado.`r`n"
    )
    Show-LauncherError (
        "O Node.js LTS nao foi encontrado neste computador.`r`n`r`n" +
        "Instale o Node.js e abra novamente o Wimifarma Cotacao."
    )
    exit 3
}

$shortcutScript = Join-Path $PSScriptRoot 'update-shortcut.ps1'
if (Test-Path -LiteralPath $shortcutScript -PathType Leaf) {
    try {
        & $shortcutScript -ProjectRoot $projectRoot -Quiet
    } catch {
        [System.IO.File]::AppendAllText(
            $logPath,
            "[$([DateTime]::Now.ToString('s'))] Atalho nao atualizado: $($_.Exception.Message)`r`n"
        )
    }
}

if (-not (Test-Path -LiteralPath $batchPath -PathType Leaf)) {
    Show-LauncherError "O arquivo cotacao.bat nao foi encontrado na pasta do sistema."
    exit 4
}

$waitForExit = $false
$forwardedArguments = @()
foreach ($argument in $LauncherArguments) {
    if ($argument -ieq '--launcher-wait') {
        $waitForExit = $true
    } else {
        $forwardedArguments += $argument
    }
}

$batchInvocation = ConvertTo-CmdQuotedArgument -Value $batchPath
foreach ($argument in $forwardedArguments) {
    $batchInvocation += ' ' + (ConvertTo-CmdQuotedArgument -Value $argument)
}

$redirectedCommand = $batchInvocation +
    ' >> ' + (ConvertTo-CmdQuotedArgument -Value $logPath) +
    ' 2>&1'

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $env:ComSpec
$startInfo.Arguments = '/d /s /c "' + $redirectedCommand + '"'
$startInfo.WorkingDirectory = $projectRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.WindowStyle = 'Hidden'
$startInfo.EnvironmentVariables['WIMI_HIDDEN_LAUNCH'] = '1'

if ($env:WIMI_LAUNCHER_DEBUG -eq '1') {
    Write-Output ("LAUNCHER_COMMAND=" + $startInfo.Arguments)
}

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo
if (-not $process.Start()) {
    Show-LauncherError "Nao foi possivel iniciar o Wimifarma Cotacao."
    exit 5
}

if ($waitForExit) {
    $process.WaitForExit()
    if ($env:WIMI_LAUNCHER_DEBUG -eq '1') {
        Write-Output ("LAUNCHER_CHILD_EXIT=" + $process.ExitCode)
    }
    exit $process.ExitCode
}
