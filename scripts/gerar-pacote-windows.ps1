$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'releases'
$stageRoot = Join-Path $releaseRoot 'CampoCerto-Servidor'
$stageApp = Join-Path $stageRoot 'app'
$zipPath = Join-Path $releaseRoot 'CampoCerto-Servidor.zip'
$stageMigration = Join-Path $stageRoot 'migracao'

Set-Location -LiteralPath $projectRoot
Write-Host 'Gerando a interface de producao...' -ForegroundColor Cyan
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar a interface.' }

if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stageApp, (Join-Path $stageApp 'runtime'), $stageMigration | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $stageApp -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'server') -Destination $stageApp -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $stageApp
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination $stageApp
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $stageApp 'runtime\node.exe')
Copy-Item -Path (Join-Path $projectRoot 'deploy\windows\*') -Destination $stageRoot -Recurse

# Inclui uma cópia consistente dos dados para a primeira instalação no servidor.
$databaseSource = Join-Path $projectRoot 'data\produtor-rural.db'
$databasePackage = Join-Path $stageMigration 'produtor-rural.db'
if (-not (Test-Path -LiteralPath $databaseSource)) { throw 'Banco de dados local não encontrado.' }
& (Get-Command node.exe).Source --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database(process.argv[1]); await db.backup(process.argv[2]); db.close()" $databaseSource $databasePackage
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar a cópia consistente do banco.' }

# Inclui somente a credencial necessária para executar o túnel já existente.
$tunnelId = '59098c74-9491-4bfb-9b8b-4ea3d5968d49'
$tunnelCredential = Join-Path $env:USERPROFILE ".cloudflared\$tunnelId.json"
$cloudflaredExe = (Get-Command cloudflared.exe -ErrorAction Stop).Source
Copy-Item -LiteralPath $tunnelCredential -Destination (Join-Path $stageMigration "$tunnelId.json")
Copy-Item -LiteralPath $cloudflaredExe -Destination (Join-Path $stageMigration 'cloudflared.exe')

Write-Host 'Incluindo as dependencias do servidor...' -ForegroundColor Cyan
Push-Location $stageApp
try {
  & npm.cmd ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar as dependencias.' }
} finally { Pop-Location }

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Pacote criado em: $zipPath" -ForegroundColor Green
