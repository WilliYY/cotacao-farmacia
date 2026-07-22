Add-Type -AssemblyName System.Drawing

function Draw-WimifarmaIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Clear background to transparent (no black box!)
    $g.Clear([System.Drawing.Color]::Transparent)

    $scale = $size / 256.0

    # 1. Outer Squircle Badge with rich gradient
    $margin = [int](12 * $scale)
    $badgeSize = $size - (2 * $margin)
    $badgeRect = New-Object System.Drawing.Rectangle $margin, $margin, $badgeSize, $badgeSize

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $badgeRect, 
        ([System.Drawing.Color]::FromArgb(255, 11, 140, 96)), 
        ([System.Drawing.Color]::FromArgb(255, 2, 132, 199)), 45

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = [int](52 * $scale)
    $path.AddArc($badgeRect.X, $badgeRect.Y, $r, $r, 180, 90)
    $path.AddArc(($badgeRect.Right - $r), $badgeRect.Y, $r, $r, 270, 90)
    $path.AddArc(($badgeRect.Right - $r), ($badgeRect.Bottom - $r), $r, $r, 0, 90)
    $path.AddArc($badgeRect.X, ($badgeRect.Bottom - $r), $r, $r, 90, 90)
    $path.CloseFigure()

    $g.FillPath($brush, $path)

    # 2. Subtle Glowing Inner Border
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(160, 255, 255, 255)), ([float](3 * $scale))
    $g.DrawPath($pen, $path)

    # 3. Clean, Bold White Pharmacy Cross + Capsule Symbol
    $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 6, 182, 212))

    # Cross Vertical Bar
    $vWidth = [int](38 * $scale)
    $vHeight = [int](116 * $scale)
    $vX = [int](( $size - $vWidth ) / 2)
    $vY = [int](( $size - $vHeight ) / 2)
    $vRect = New-Object System.Drawing.Rectangle $vX, $vY, $vWidth, $vHeight
    $vPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $vRadius = [int]($vWidth)
    $vPath.AddArc($vRect.X, $vRect.Y, $vRadius, $vRadius, 180, 180)
    $vPath.AddArc($vRect.X, ($vRect.Bottom - $vRadius), $vRadius, $vRadius, 0, 180)
    $vPath.CloseFigure()
    $g.FillPath($whiteBrush, $vPath)

    # Cross Horizontal Bar
    $hWidth = [int](116 * $scale)
    $hHeight = [int](38 * $scale)
    $hX = [int](( $size - $hWidth ) / 2)
    $hY = [int](( $size - $hHeight ) / 2)
    $hRect = New-Object System.Drawing.Rectangle $hX, $hY, $hWidth, $hHeight
    $hPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $hRadius = [int]($hHeight)
    $hPath.AddArc($hRect.X, $hRect.Y, $hRadius, $hRadius, 90, 180)
    $hPath.AddArc(($hRect.Right - $hRadius), $hRect.Y, $hRadius, $hRadius, 270, 180)
    $hPath.CloseFigure()
    $g.FillPath($whiteBrush, $hPath)

    # Center Cyan Pill Accent Dot / Ring for high-end look
    $dotSize = [int](22 * $scale)
    $dotX = [int](( $size - $dotSize ) / 2)
    $dotY = [int](( $size - $dotSize ) / 2)
    $g.FillEllipse($accentBrush, $dotX, $dotY, $dotSize, $dotSize)

    $g.Dispose()
    return $bmp
}

# Generate 256x256 Master PNG and ICO
if (-not (Test-Path 'assets')) { New-Item -ItemType Directory -Path 'assets' | Out-Null }

$master256 = Draw-WimifarmaIcon 256
$master256.Save('assets/icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$master256.Save('public/icon.png', [System.Drawing.Imaging.ImageFormat]::Png)

$hIcon = $master256.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)

$fs = [System.IO.File]::Create((Join-Path (Get-Location) 'assets/icon.ico'))
$icon.Save($fs)
$fs.Close()

$fs2 = [System.IO.File]::Create((Join-Path (Get-Location) 'public/favicon.ico'))
$icon.Save($fs2)
$fs2.Close()

# Update Desktop shortcut
$WshShell = New-Object -ComObject WScript.Shell
$desktopPath = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'wimi cotacao.lnk'
$projectPath = (Get-Location).Path
$iconPath = Join-Path $projectPath 'assets\icon.ico'
$vbsPath = Join-Path $projectPath 'wimi cotacao.vbs'

$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = $vbsPath
$Shortcut.WorkingDirectory = $projectPath
$Shortcut.IconLocation = "$iconPath, 0"
$Shortcut.Description = 'Wimifarma Cotação - Sistema Inteligente de Cotação de Medicamentos'
$Shortcut.Save()

$localShortcutPath = Join-Path $projectPath 'wimi cotacao.lnk'
$LocalShortcut = $WshShell.CreateShortcut($localShortcutPath)
$LocalShortcut.TargetPath = $vbsPath
$LocalShortcut.WorkingDirectory = $projectPath
$LocalShortcut.IconLocation = "$iconPath, 0"
$LocalShortcut.Description = 'Wimifarma Cotação'
$LocalShortcut.Save()

Write-Host 'Ultra-clean transparent icon generated and desktop shortcut updated!'
