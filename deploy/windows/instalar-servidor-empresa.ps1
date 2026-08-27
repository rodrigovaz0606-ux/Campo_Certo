$ErrorActionPreference = 'Stop'

$tunnelId = '59098c74-9491-4bfb-9b8b-4ea3d5968d49'
$installRoot = Join-Path $env:ProgramData 'CampoCerto'
$dataRoot = Join-Path $installRoot 'app\data'
$databaseTarget = Join-Path $dataRoot 'produtor-rural.db'
$migrationRoot = Join-Path $PSScriptRoot 'migracao'
$databaseSource = Join-Path $migrationRoot 'produtor-rural.db'
$cloudflareRoot = Join-Path $installRoot 'cloudflared'
$cloudflaredTarget = Join-Path $cloudflareRoot 'cloudflared.exe'
$credentialTarget = Join-Path $cloudflareRoot "$tunnelId.json"
$configTarget = Join-Path $cloudflareRoot 'config.yml'
$tunnelTask = 'CampoCertoCloudflare'

foreach ($required in @($databaseSource, (Join-Path $migrationRoot 'cloudflared.exe'), (Join-Path $migrationRoot "$tunnelId.json"))) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Pacote incompleto: $required não foi encontrado." }
}

Write-Host '1/4 Instalando a aplicação...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'instalar.ps1')

Write-Host '2/4 Restaurando os dados iniciais...' -ForegroundColor Cyan
Stop-ScheduledTask -TaskName 'CampoCertoServidor' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null

# Um banco já utilizado nunca é substituído ao executar novamente o instalador.
$shouldRestore = -not (Test-Path -LiteralPath $databaseTarget)
if (-not $shouldRestore) { $shouldRestore = (Get-Item -LiteralPath $databaseTarget).Length -lt 1MB }
if ($shouldRestore) {
  Copy-Item -LiteralPath $databaseSource -Destination $databaseTarget -Force
  Remove-Item -LiteralPath "$databaseTarget-wal" -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "$databaseTarget-shm" -Force -ErrorAction SilentlyContinue
  Write-Host 'Banco de dados restaurado.' -ForegroundColor Green
} else {
  Write-Host 'Banco existente preservado.' -ForegroundColor Yellow
}
Start-ScheduledTask -TaskName 'CampoCertoServidor'

Write-Host '3/4 Configurando o domínio...' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $cloudflareRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $migrationRoot 'cloudflared.exe') -Destination $cloudflaredTarget -Force
Copy-Item -LiteralPath (Join-Path $migrationRoot "$tunnelId.json") -Destination $credentialTarget -Force
@"
tunnel: $tunnelId
credentials-file: $credentialTarget

ingress:
  - hostname: campocertoprodutorrural.com.br
    service: http://127.0.0.1:80
  - hostname: www.campocertoprodutorrural.com.br
    service: http://127.0.0.1:80
  - service: http_status:404
"@ | Set-Content -LiteralPath $configTarget -Encoding ASCII

$existingTunnelTask = Get-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue
if ($existingTunnelTask) {
  Stop-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $tunnelTask -Confirm:$false
}
$action = New-ScheduledTaskAction -Execute $cloudflaredTarget -Argument "--config `"$configTarget`" tunnel run $tunnelId" -WorkingDirectory $cloudflareRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $tunnelTask -Description 'Publicação do Campo Certo pela Cloudflare' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $tunnelTask

Write-Host '4/4 Verificando a instalação...' -ForegroundColor Cyan
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1/api/health' -TimeoutSec 2
    if ($health.status -eq 'ok') { $ready = $true; break }
  } catch {}
}
if (-not $ready) { throw 'O aplicativo não respondeu ao teste local.' }

$tunnelRunning = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Seconds 1
  if (Get-Process cloudflared -ErrorAction SilentlyContinue) { $tunnelRunning = $true; break }
}
if (-not $tunnelRunning) { throw 'O túnel Cloudflare não iniciou. Verifique o Agendador de Tarefas.' }

Write-Host ''
Write-Host 'Campo Certo instalado com sucesso.' -ForegroundColor Green
Write-Host 'Acesse: https://campocertoprodutorrural.com.br'
Write-Host 'Nas próximas versões, use apenas Atualizar Campo Certo.cmd.'
