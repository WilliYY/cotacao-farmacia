$WshShell = New-Object -ComObject WScript.Shell
$desktopPath = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'wimi cotacao.lnk'
$projectPath = (Get-Location).Path
$iconPath = Join-Path $projectPath 'assets\icon.ico'
$vbsPath = Join-Path $projectPath 'wimi cotacao.vbs'

# 1. Update Desktop shortcut
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = $vbsPath
$Shortcut.WorkingDirectory = $projectPath
$Shortcut.IconLocation = "$iconPath, 0"
$Shortcut.Description = 'Wimifarma Cotação - Sistema Inteligente de Cotação de Medicamentos'
$Shortcut.Save()

# 2. Update local project shortcut
$localShortcutPath = Join-Path $projectPath 'wimi cotacao.lnk'
$LocalShortcut = $WshShell.CreateShortcut($localShortcutPath)
$LocalShortcut.TargetPath = $vbsPath
$LocalShortcut.WorkingDirectory = $projectPath
$LocalShortcut.IconLocation = "$iconPath, 0"
$LocalShortcut.Description = 'Wimifarma Cotação'
$LocalShortcut.Save()

Write-Host 'Desktop shortcut updated successfully with custom icon!'
