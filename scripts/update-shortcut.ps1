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
$shortcutPath = Join-Path $desktopPath 'wimi cotacao.lnk'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

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
$shortcut.Arguments = (
    '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
    '-WindowStyle Hidden -File "' + $launcherPath + '"'
)
$shortcut.WorkingDirectory = $projectPath
if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
    $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Description = 'Wimifarma Cotacao - pesquisa inteligente de precos'
$shortcut.Save()

if (-not $Quiet) {
    Write-Output "Atalho atualizado: $shortcutPath"
}
