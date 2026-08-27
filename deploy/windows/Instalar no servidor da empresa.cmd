@echo off
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Solicitando permissao de administrador...
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-servidor-empresa.ps1"
if errorlevel 1 (
  echo.
  echo A instalacao nao foi concluida. Consulte a mensagem acima.
  pause
  exit /b 1
)
echo.
echo Instalacao concluida. Pressione qualquer tecla para fechar.
pause >nul
