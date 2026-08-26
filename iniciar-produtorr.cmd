@echo off
setlocal
title ProdutorR

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] O Node.js nao foi encontrado.
    echo Instale o Node.js 18 ou superior e tente novamente.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Preparando o ProdutorR pela primeira vez...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERRO] Nao foi possivel instalar as dependencias.
        pause
        exit /b 1
    )
)

echo Iniciando o ProdutorR...
echo O navegador sera aberto em http://localhost:5173
echo Para encerrar, volte a esta janela e pressione Ctrl+C.
echo.

start "" http://localhost:5173
call npm run dev

if errorlevel 1 (
    echo.
    echo [ERRO] O ProdutorR foi encerrado com uma falha.
    pause
)

endlocal
