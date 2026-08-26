$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'releases'
$stageRoot = Join-Path $releaseRoot 'CampoCerto-Servidor'
$stageApp = Join-Path $stageRoot 'app'
$zipPath = Join-Path $releaseRoot 'CampoCerto-Servidor.zip'

Set-Location -LiteralPath $projectRoot
Write-Host 'Gerando a interface de producao...' -ForegroundColor Cyan
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar a interface.' }

if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stageApp, (Join-Path $stageApp 'runtime') | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $stageApp -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'server') -Destination $stageApp -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $stageApp
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination $stageApp
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $stageApp 'runtime\node.exe')
Copy-Item -Path (Join-Path $projectRoot 'deploy\windows\*') -Destination $stageRoot -Recurse

Write-Host 'Incluindo as dependencias do servidor...' -ForegroundColor Cyan
Push-Location $stageApp
try {
  & npm.cmd ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar as dependencias.' }
} finally { Pop-Location }

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Pacote criado em: $zipPath" -ForegroundColor Green

