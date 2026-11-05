# Generates assets/icon-180.png from the same shapes as icon.svg.
# Run from the plugin root: powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
Add-Type -AssemblyName System.Drawing

$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not (Test-Path (Join-Path $root 'client.js'))) {
  $root = Join-Path $root '..'
}

$size = 180
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

$sheet = New-RoundedRect 26 18 104 112 14
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#FFD166'))), $sheet)

$foldBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#FFF1C2'))
$fold = New-Object System.Drawing.Drawing2D.GraphicsPath
$fold.AddPolygon(@(
  (New-Object System.Drawing.PointF 106, 130),
  (New-Object System.Drawing.PointF 130, 106),
  (New-Object System.Drawing.PointF 130, 130)
))
$g.FillPath($foldBrush, $fold)

$ink = [System.Drawing.ColorTranslator]::FromHtml('#7A5B12')
foreach ($line in @(@(40, 42, 62), @(40, 60, 50), @(40, 78, 56))) {
  $bar = New-RoundedRect $line[0] $line[1] $line[2] 8 4
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(165, $ink))
  $g.FillPath($brush, $bar)
  $brush.Dispose()
}

$clockFace = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#FFFAF0'))
$ring = New-Object System.Drawing.Pen $ink, 7
$g.FillEllipse($clockFace, 92, 94, 76, 76)
$g.DrawEllipse($ring, 92, 94, 76, 76)

$hand = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#C2410C')), 7
$hand.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$hand.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($hand, 130, 112, 130, 132)
$g.DrawLine($hand, 130, 132, 144, 140)

$dot = New-Object System.Drawing.SolidBrush $ink
$g.FillEllipse($dot, 125, 127, 10, 10)

$outDir = Join-Path $root 'assets'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir 'icon-180.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
"saved $out ($((Get-Item $out).Length) bytes)"