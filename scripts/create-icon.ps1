Add-Type -AssemblyName System.Drawing

$width = 256
$height = 256

$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Outer background fill - Deep modern dark teal / navy
$bgRect = New-Object System.Drawing.Rectangle 0, 0, $width, $height
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bgRect, ([System.Drawing.Color]::FromArgb(255, 11, 15, 25)), ([System.Drawing.Color]::FromArgb(255, 6, 40, 48)), 45
$g.FillRectangle($bgBrush, $bgRect)

# Rounded Badge Container
$margin = 16
$badgeRect = New-Object System.Drawing.Rectangle $margin, $margin, ($width - 2 * $margin), ($height - 2 * $margin)
$badgeBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $badgeRect, ([System.Drawing.Color]::FromArgb(255, 8, 127, 91)), ([System.Drawing.Color]::FromArgb(255, 13, 148, 136)), 135

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 44
$path.AddArc($badgeRect.X, $badgeRect.Y, $r, $r, 180, 90)
$path.AddArc(($badgeRect.Right - $r), $badgeRect.Y, $r, $r, 270, 90)
$path.AddArc(($badgeRect.Right - $r), ($badgeRect.Bottom - $r), $r, $r, 0, 90)
$path.AddArc($badgeRect.X, ($badgeRect.Bottom - $r), $r, $r, 90, 90)
$path.CloseFigure()

$g.FillPath($badgeBrush, $path)

# Glowing Cyan Accent Ring
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 6, 182, 212)), 6
$g.DrawPath($pen, $path)

# White Pharmacy Cross / Capsule Accent
$crossBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 255, 255, 255))

# Vertical Bar
$vPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$vPath.AddArc(110, 60, 36, 36, 180, 180)
$vPath.AddArc(110, 160, 36, 36, 0, 180)
$vPath.CloseFigure()
$g.FillPath($crossBrush, $vPath)

# Horizontal Bar
$hPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$hPath.AddArc(60, 110, 36, 36, 90, 180)
$hPath.AddArc(160, 110, 36, 36, 270, 180)
$hPath.CloseFigure()
$g.FillPath($crossBrush, $hPath)

# Bold 'WF' Typography in Center
$font = New-Object System.Drawing.Font("Segoe UI", [float]38, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 8, 127, 91))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$layoutRect = New-Object System.Drawing.RectangleF 0, 2, $width, $height
$g.DrawString('WF', $font, $textBrush, $layoutRect, $sf)

# Save PNG and ICO
if (-not (Test-Path 'assets')) { New-Item -ItemType Directory -Path 'assets' | Out-Null }
$bmp.Save('assets/icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save('public/icon.png', [System.Drawing.Imaging.ImageFormat]::Png)

$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)

$fs = [System.IO.File]::Create((Join-Path (Get-Location) 'assets/icon.ico'))
$icon.Save($fs)
$fs.Close()

$fs2 = [System.IO.File]::Create((Join-Path (Get-Location) 'public/favicon.ico'))
$icon.Save($fs2)
$fs2.Close()

Write-Host 'Icon generated successfully at assets/icon.ico and public/favicon.ico!'
