@echo off
net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName 'CampoCertoServidor' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'CampoCertoServidor' -Confirm:$false -ErrorAction SilentlyContinue; Remove-NetFirewallRule -DisplayName 'Campo Certo - HTTP' -ErrorAction SilentlyContinue"
echo Servico removido. Os dados permanecem em C:\ProgramData\CampoCerto\app\data.
pause

