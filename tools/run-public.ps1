# 前台运行公网演示（由计划任务调用）：本地服务 + Cloudflare 隧道，保持存活。
# 手动调试：powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-public.ps1
param(
  [int]$Port = 8788,
  [string]$LlmOffline = '0'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$serverLog = Join-Path $env:TEMP 'bank-server.out.log'
$tunnelLog = Join-Path $env:TEMP 'bank-tunnel.log'

$env:PORT = "$Port"
$env:HOST = '127.0.0.1'
$env:LOG_LEVEL = 'warn'
$env:LLM_OFFLINE = $LlmOffline

$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
$tsx = Join-Path $repo 'node_modules\tsx\dist\cli.mjs'

$server = Start-Process -FilePath $node -ArgumentList "`"$tsx`" apps/server/src/index.ts" `
  -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $serverLog -RedirectStandardError (Join-Path $env:TEMP 'bank-server.err.log')

for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  try {
    if ((Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 5).ok) { break }
  } catch { }
}

if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
$cf = Join-Path $PSScriptRoot 'cloudflared.exe'
$tunnel = Start-Process -FilePath $cf `
  -ArgumentList "tunnel", "--url", "http://127.0.0.1:$Port", "--protocol", "http2", "--no-autoupdate" `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardError $tunnelLog -RedirectStandardOutput (Join-Path $env:TEMP 'bank-tunnel.out.log')

$url = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $tunnelLog) {
    $hit = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($hit) { $url = $hit.Matches[0].Value; break }
  }
}
if (-not $url) { $url = '' }
Set-Content -Path (Join-Path $env:TEMP 'bank-public-url.txt') -Value $url -NoNewline

# 保持存活：隧道地址只在进程存活期间有效
while ($true) {
  Start-Sleep -Seconds 30
  if ($server.HasExited -or $tunnel.HasExited) {
    foreach ($proc in @($server, $tunnel)) {
      if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
    break
  }
}
