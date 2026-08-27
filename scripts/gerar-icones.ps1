$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconRoot = Join-Path $projectRoot 'public\icons'
New-Item -ItemType Directory -Force -Path $iconRoot | Out-Null

function New-CampoCertoIcon([int]$Size, [string]$Name, [bool]$Maskable = $false) {
  $bitmap = [Drawing.Bitmap]::new($Size, $Size)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#174c36'))

  $scale = $Size / 512.0
  $circleRadius = $(if ($Maskable) { 154 } else { 166 }) * $scale
  $center = 256 * $scale
  $lime = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#c9e26d'))
  $green = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#174c36'))
  $graphics.FillEllipse($lime, $center - $circleRadius, $center - $circleRadius, 2 * $circleRadius, 2 * $circleRadius)

  $stem = [Drawing.Pen]::new($green, 32 * $scale)
  $stem.StartCap = $stem.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($stem, 256 * $scale, 359 * $scale, 256 * $scale, 225 * $scale)

  $left = [Drawing.Drawing2D.GraphicsPath]::new()
  $left.StartFigure()
  $left.AddBezier(248*$scale,250*$scale,175*$scale,251*$scale,132*$scale,212*$scale,130*$scale,141*$scale)
  $left.AddBezier(130*$scale,141*$scale,199*$scale,138*$scale,246*$scale,176*$scale,248*$scale,250*$scale)
  $left.CloseFigure()
  $graphics.FillPath($green, $left)

  $right = [Drawing.Drawing2D.GraphicsPath]::new()
  $right.StartFigure()
  $right.AddBezier(264*$scale,215*$scale,271*$scale,147*$scale,312*$scale,110*$scale,380*$scale,114*$scale)
  $right.AddBezier(380*$scale,114*$scale,380*$scale,182*$scale,340*$scale,219*$scale,264*$scale,215*$scale)
  $right.CloseFigure()
  $graphics.FillPath($green, $right)

  $ground = [Drawing.Pen]::new($green, 28 * $scale)
  $ground.StartCap = $ground.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawArc($ground, 166*$scale, 305*$scale, 180*$scale, 130*$scale, 205, 130)

  $bitmap.Save((Join-Path $iconRoot $Name), [Drawing.Imaging.ImageFormat]::Png)
  $ground.Dispose(); $stem.Dispose(); $left.Dispose(); $right.Dispose()
  $green.Dispose(); $lime.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

New-CampoCertoIcon 180 'campo-certo-180.png'
New-CampoCertoIcon 192 'campo-certo-192.png'
New-CampoCertoIcon 512 'campo-certo-512.png'
New-CampoCertoIcon 512 'campo-certo-maskable-512.png' $true
