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
# Configuração extra (login único SaintSSO, integração com o Emissor), em NOME=valor por linha.
# Fica fora da pasta app, então as atualizações não a apagam.
$extra = Join-Path $installRoot 'config.env'
if (Test-Path -LiteralPath $extra) {
  foreach ($linha in Get-Content -LiteralPath $extra) {
    if ($linha -match '^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$' -and $Matches[1] -notin @('PORT', 'JWT_SECRET', 'NODE_ENV')) {
      Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim()
    }
  }
}
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
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $serviceName -Description 'Servidor interno do sistema Campo Certo' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null

if (-not (Get-NetFirewallRule -DisplayName 'Campo Certo - HTTP' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Campo Certo - HTTP' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
}

Start-ScheduledTask -TaskName $serviceName
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  # Mostra o motivo: estado da tarefa e o erro do próprio programa rodando alguns segundos direto.
  $info = Get-ScheduledTaskInfo -TaskName $serviceName -ErrorAction SilentlyContinue
  Write-Host "Tarefa: ultimo resultado $($info.LastTaskResult), ultima execucao $($info.LastRunTime)" -ForegroundColor Yellow
  $env:NODE_ENV = 'production'; $env:PORT = "$port"
  $env:JWT_SECRET = (Get-Content -LiteralPath $secretFile -Raw).Trim()
  $out = Join-Path $env:TEMP 'campocerto-diagnostico.txt'
  $proc = Start-Process -FilePath (Join-Path $appRoot 'runtime\node.exe') -ArgumentList "`"$(Join-Path $appRoot 'server\index.js')`"" -WorkingDirectory $appRoot -RedirectStandardError $out -RedirectStandardOutput "$out.saida" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 8
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Write-Host '--- saida do programa ---' -ForegroundColor Yellow
  Get-Content -LiteralPath "$out.saida", $out -ErrorAction SilentlyContinue | Select-Object -Last 25 | ForEach-Object { Write-Host $_ }
  throw 'O servico foi instalado, mas nao respondeu. Mande uma foto desta tela.'
}

$ipv4 = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object InterfaceMetric |
  Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ''
Write-Host 'Campo Certo instalado e em execucao.' -ForegroundColor Green
Write-Host "Acesso neste computador: http://localhost"
if ($ipv4) { Write-Host "Acesso na rede: http://$ipv4" }
Write-Host 'O sistema iniciara automaticamente junto com o Windows.'
