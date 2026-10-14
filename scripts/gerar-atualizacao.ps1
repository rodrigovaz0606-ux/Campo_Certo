$ErrorActionPreference = 'Stop'

# Gera o pacote de ATUALIZACAO para um servidor Windows que ja tem o Campo Certo instalado.
# Nao inclui banco, contas, chave JWT nem credenciais do tunel: o atualizador preserva app\data.

$projectRoot = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$releaseRoot = Join-Path $projectRoot 'releases'
$workRoot = Join-Path $releaseRoot "atualizacao-$stamp"
$stageRoot = Join-Path $workRoot 'CampoCerto-Servidor'
$stageApp = Join-Path $stageRoot 'app'
$zipPath = Join-Path $releaseRoot "CampoCerto-Atualizacao-$stamp.zip"

Set-Location -LiteralPath $projectRoot

Write-Host 'Executando os testes...' -ForegroundColor Cyan
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Os testes falharam. O pacote nao foi gerado.' }

Write-Host 'Gerando a interface de producao...' -ForegroundColor Cyan
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar a interface.' }

New-Item -ItemType Directory -Force -Path $stageApp, (Join-Path $stageApp 'runtime') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $stageApp -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'server') -Destination $stageApp -Recurse
Get-ChildItem -LiteralPath (Join-Path $stageApp 'server') -Filter '*.test.js' | Remove-Item -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $stageApp
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination $stageApp
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $stageApp 'runtime\node.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\windows\instalar.ps1') -Destination $stageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\windows\Atualizar Campo Certo.cmd') -Destination $stageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\sefaz-e-lcdpr.md') -Destination (Join-Path $stageRoot 'GUIA-SEFAZ-E-LCDPR.md')

Write-Host 'Incluindo as dependencias do servidor...' -ForegroundColor Cyan
Push-Location $stageApp
try {
  & npm.cmd ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar as dependencias.' }
} finally { Pop-Location }

# Confere se o banco SQLite nativo carrega com o node.exe que vai junto no pacote.
& (Join-Path $stageApp 'runtime\node.exe') -e "require('$($stageApp.Replace('\','/'))/node_modules/better-sqlite3')(':memory:').close()"
if ($LASTEXITCODE -ne 0) { throw 'O modulo better-sqlite3 nao carregou com o node.exe do pacote.' }

$commit = (& git rev-parse --short HEAD).Trim()
$dirty = (& git status --porcelain)
$version = if ($dirty) { "$commit + alteracoes de $stamp" } else { $commit }
$readme = @"
ATUALIZACAO DO CAMPO CERTO - versao $version

1. Com o servico parado, faca backup de toda a pasta C:\ProgramData\CampoCerto\app\data, incluindo companies.
2. Extraia este ZIP em uma pasta separada.
3. Execute Atualizar Campo Certo.cmd como administrador.
4. Entre novamente no sistema e confira o acesso pelo dominio existente.

O atualizador preserva app\data e a chave JWT existente.
O tunel do dominio continua usando a configuracao instalada no servidor.
Este pacote nao inclui banco local, contas ou credenciais do tunel.
Use somente para atualizar uma instalacao Windows existente.

NOVIDADES DESTA VERSAO
- Backup automatico diario de todos os bancos em C:\ProgramData\CampoCerto\app\data\backups\automaticos
  (o primeiro sai cerca de 2 minutos apos o servico iniciar; ficam as 10 copias mais recentes).
  O administrador acompanha e pode fazer um backup na hora em Usuarios > Backups automaticos.
- Quantidade de cabecas preenchida automaticamente nas notas de gado (na importacao e, uma unica vez,
  nas notas ja importadas que estavam sem quantidade). Vendas por peso continuam para preencher a mao.
- Conferencia com atalhos de pendencias: nao conferidas, sem fazenda, sem participante, gado sem
  quantidade e possiveis duplicadas.
- Painel inicial com grafico mensal de receitas e despesas por produtor (e fazenda, opcional).
- Cada tela tem endereco proprio: atualizar a pagina (F5) e o botao voltar do navegador funcionam.
- Visualizacao da DANFE no modelo oficial, com mais zoom, e tema escuro mais confortavel.
- DANFE em PDF com texto de verdade (selecionavel e pesquisavel), arquivo bem menor, varias folhas
  quando a nota tem muitos itens.
- Anexos (PDF ou imagem) nos lancamentos manuais: clipe na grade da Conferencia e campo no formulario.
- Gerar LCDPR em Resumo anual (validar no programa da Receita antes de transmitir).
- Buscar notas na SEFAZ com o certificado A1 do produtor (Produtores > icone de escudo para cadastrar;
  Importar notas > Buscar notas na SEFAZ). Veja GUIA-SEFAZ-E-LCDPR.md neste pacote.
"@
Set-Content -LiteralPath (Join-Path $stageRoot 'LEIA-ME-ATUALIZACAO.txt') -Value $readme -Encoding UTF8

Write-Host 'Compactando o pacote...' -ForegroundColor Cyan
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal
Set-Content -LiteralPath (Join-Path $releaseRoot 'ultima-atualizacao.txt') -Value $zipPath -Encoding UTF8
Write-Host "Pacote de atualizacao criado em: $zipPath" -ForegroundColor Green
