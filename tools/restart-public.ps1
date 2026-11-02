# 重启公网演示实例：本地服务 + Cloudflare Quick Tunnel（Windows / PowerShell）
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/restart-public.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/restart-public.ps1 -Port 8788 -LlmOffline 0
#
# 说明：
# - Quick Tunnel 每次启动都会分配新的 *.trycloudflare.com 地址，旧链接随进程结束永久失效。
# - 进程以隐藏窗口方式脱离当前终端，关掉本窗口不会带走服务。
# - 凭据只从当前环境变量读取（LLM_API_KEY 等），脚本不打印任何密钥。
param(
  [int]$Port = 8788,
  [string]$LlmOffline = '0',
  [switch]$SkipTunnel
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$taskName = 'BankAgentPublicDemo'
$runner = Join-Path $PSScriptRoot 'run-public.ps1'
$urlFile = Join-Path $env:TEMP 'bank-public-url.txt'

# 1) 停掉遗留的服务与隧道进程（旧公网地址随之失效，Quick Tunnel 每次都会发新地址）
foreach ($name in @('cloudflared')) {
  $stale = Get-Process -Name $name -ErrorAction SilentlyContinue
  if ($stale) { $stale | Stop-Process -Force; Write-Output "已结束 $name 进程" }
}
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($owner) { Write-Output "端口 $Port 被 $($owner.ProcessName)#$($owner.Id) 占用，结束它"; Stop-Process -Id $owner.Id -Force }
}
Start-Sleep -Seconds 2

# 2) 注册为计划任务：脱离当前终端会话，关掉窗口也不会被回收
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Port $Port -LlmOffline $LlmOffline" `
  -WorkingDirectory $repo
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -Principal $principal `
  -Force -Description 'AI 银行管家公网演示（本地服务 + Cloudflare 快速隧道）' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "计划任务 $taskName 已启动（独立于本终端）"

# 3) 等待隧道地址
if (Test-Path $urlFile) { Remove-Item $urlFile -Force }
$url = $null
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $urlFile) {
    $candidate = (Get-Content $urlFile -Raw).Trim()
    if ($candidate) { $url = $candidate; break }
  }
}
if (-not $url) {
  Write-Output "未取得公网地址，隧道日志尾部："
  Get-Content (Join-Path $env:TEMP 'bank-tunnel.log') -Tail 20 -ErrorAction SilentlyContinue
  exit 1
}

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 800
  try {
    if ((Invoke-WebRequest -Uri "$url/api/health" -TimeoutSec 6 -UseBasicParsing).StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}

Write-Output ""
Write-Output "公网地址：$url"
if ($ready) { Write-Output "端到端验证通过（页面与 API 均可访问）。" } else { Write-Output "公网探测尚未通过，请稍后重试 $url/api/health" }
Write-Output "评委控制台：$url/console    产品端：$url/login"
Write-Output "停止演示：Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"
