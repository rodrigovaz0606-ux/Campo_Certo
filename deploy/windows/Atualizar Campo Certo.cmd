@echo off
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Solicitando permissao de administrador...
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
if errorlevel 1 (
  echo.
  echo A atualizacao nao foi concluida. Consulte a mensagem acima.
  pause
  exit /b 1
)
echo.
echo Atualizacao concluida sem alterar o banco de dados.
pause >nul
