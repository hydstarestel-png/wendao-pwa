@echo off
setlocal
set "PYTHON=C:\Users\q1533\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "SITE_DIR=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url='http://127.0.0.1:4173/';" ^
  "try { $online=(Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 1).StatusCode -eq 200 } catch { $online=$false };" ^
  "if(-not $online){ Start-Process -FilePath '%PYTHON%' -ArgumentList '-m','http.server','4173','--bind','127.0.0.1','--directory','%SITE_DIR%' -WindowStyle Hidden }"

powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2"
if /I "%WENDAO_NO_OPEN%"=="1" exit /b 0
start "" "http://localhost:4173/"
endlocal
