param(
  [string]$Src = "",
  [string]$Pdf = ""
)
$ErrorActionPreference = 'Stop'
$Src = (Resolve-Path $Src).Path
$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($Src, $true, $false, $false)
try {
  $pres.SaveAs($Pdf, 32)   # 32 = ppSaveAsPDF
  Write-Output ("pdf written: {0}" -f $Pdf)
} finally {
  $pres.Close()
  $app.Quit()
}
