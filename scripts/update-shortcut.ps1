param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Quiet
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectPath = [System.IO.Path]::GetFullPath($ProjectRoot)
$launcherPath = Join-Path $projectPath 'scripts\launch-hidden.ps1'
$iconPath = Join-Path $projectPath 'assets\icon.ico'
$desktopPath = [System.Environment]::GetFolderPath('Desktop')
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcutArguments = (
    '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
    '-WindowStyle Hidden -File "' + $launcherPath + '"'
)

if ([string]::IsNullOrWhiteSpace($desktopPath) -or -not (Test-Path -LiteralPath $desktopPath -PathType Container)) {
    throw 'A pasta da Area de Trabalho nao foi encontrada neste computador.'
}

$shortcutPath = Join-Path $desktopPath 'wimi cotacao.lnk'

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "Inicializador nao encontrado: $launcherPath"
}

if (-not (Test-Path -LiteralPath $powershellPath -PathType Leaf)) {
    $powershellCommand = Get-Command powershell.exe -ErrorAction Stop
    $powershellPath = $powershellCommand.Source
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = $shortcutArguments
$shortcut.WorkingDirectory = $projectPath
if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
    $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Description = 'Wimifarma Cotacao - pesquisa inteligente de precos'
$shortcut.Save()

$verifiedShortcut = $shell.CreateShortcut($shortcutPath)
$targetMatches = [string]::Equals(
    [System.IO.Path]::GetFullPath($verifiedShortcut.TargetPath),
    [System.IO.Path]::GetFullPath($powershellPath),
    [System.StringComparison]::OrdinalIgnoreCase
)
$workingDirectoryMatches = [string]::Equals(
    [System.IO.Path]::GetFullPath($verifiedShortcut.WorkingDirectory),
    $projectPath,
    [System.StringComparison]::OrdinalIgnoreCase
)
$argumentsMatch = [string]::Equals(
    $verifiedShortcut.Arguments,
    $shortcutArguments,
    [System.StringComparison]::Ordinal
)

if (-not $targetMatches -or -not $workingDirectoryMatches -or -not $argumentsMatch) {
    throw 'Atalho criado, mas a verificacao falhou. Abra wimi cotacao.bat diretamente na pasta do sistema.'
}

if (-not $Quiet) {
    Write-Output "Atalho atualizado: $shortcutPath"
}
