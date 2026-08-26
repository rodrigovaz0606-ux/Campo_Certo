$ErrorActionPreference = 'Stop'

$serviceName = 'CampoCertoServidor'
$installRoot = Join-Path $env:ProgramData 'CampoCerto'
$appRoot = Join-Path $installRoot 'app'
$sourceApp = Join-Path $PSScriptRoot 'app'
$startScript = Join-Path $installRoot 'iniciar-servidor.ps1'
$port = 80

if (-not (Test-Path -LiteralPath (Join-Path $sourceApp 'runtime\node.exe'))) {
  throw 'Pacote incompleto: runtime\node.exe nao foi encontrado.'
}

Write-Host 'Instalando o Campo Certo...' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $installRoot, $appRoot, (Join-Path $appRoot 'data') | Out-Null

$existingTask = Get-ScheduledTask -TaskName $serviceName -ErrorAction SilentlyContinue
if ($existingTask) {
  Stop-ScheduledTask -TaskName $serviceName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

# Atualiza o programa sem remover o banco persistente em app\data.
foreach ($folder in @('dist', 'server', 'node_modules', 'runtime')) {
  $source = Join-Path $sourceApp $folder
  $target = Join-Path $appRoot $folder
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $sourceApp 'package.json') -Destination $appRoot -Force

$secretFile = Join-Path $installRoot 'jwt-secret.txt'
if (-not (Test-Path -LiteralPath $secretFile)) {
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes) | Set-Content -LiteralPath $secretFile -Encoding ASCII
}

$launcher = @'
$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:ProgramData 'CampoCerto'
$appRoot = Join-Path $installRoot 'app'
$env:NODE_ENV = 'production'
$env:PORT = '80'
$env:JWT_SECRET = (Get-Content -LiteralPath (Join-Path $installRoot 'jwt-secret.txt') -Raw).Trim()
Set-Location -LiteralPath $appRoot
& (Join-Path $appRoot 'runtime\node.exe') (Join-Path $appRoot 'server\index.js')
exit $LASTEXITCODE
'@
$launcher | Set-Content -LiteralPath $startScript -Encoding UTF8

$existingPort = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existingPort) {
  $owners = ($existingPort.OwningProcess | Sort-Object -Unique) -join ', '
  throw "A porta $port ja esta sendo usada pelo processo $owners. Libere a porta e execute o instalador novamente."
}

if ($existingTask) { Unregister-ScheduledTask -TaskName $serviceName -Confirm:$false }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`"" -WorkingDirectory $appRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $serviceName -Description 'Servidor interno do sistema Campo Certo' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null

if (-not (Get-NetFirewallRule -DisplayName 'Campo Certo - HTTP' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Campo Certo - HTTP' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
}

Start-ScheduledTask -TaskName $serviceName
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { $ready = $true; break }
  } catch {}
}
if (-not $ready) { throw 'O servico foi instalado, mas nao respondeu. Verifique o Agendador de Tarefas.' }

$ipv4 = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object InterfaceMetric |
  Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ''
Write-Host 'Campo Certo instalado e em execucao.' -ForegroundColor Green
Write-Host "Acesso neste computador: http://localhost"
if ($ipv4) { Write-Host "Acesso na rede: http://$ipv4" }
Write-Host 'O sistema iniciara automaticamente junto com o Windows.'
