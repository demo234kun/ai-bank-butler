param(
  [string]$Src = "",
  [string]$OutDir = ""
)
$ErrorActionPreference = 'Stop'
if (-not $Src) { throw "missing -Src" }
if (-not $OutDir) { throw "missing -OutDir" }
$Src = (Resolve-Path $Src).Path
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$OutDir = (Resolve-Path $OutDir).Path

$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($Src, $true, $false, $false)
try {
  $i = 0
  foreach ($slide in $pres.Slides) {
    $i += 1
    $target = Join-Path $OutDir ("slide{0:D2}.png" -f $i)
    $slide.Export($target, "PNG", 1600, 900)
  }
  Write-Output ("exported {0} slides to {1}" -f $i, $OutDir)
} finally {
  $pres.Close()
  $app.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pres)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
