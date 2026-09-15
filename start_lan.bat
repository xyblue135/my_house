@echo off
setlocal
pushd "%~dp0"

set "JAVA_HOME=D:\4environment\Java\jdk-21.0.7"
set "PATH=%JAVA_HOME%\bin;%PATH%"

where java >nul 2>&1
if errorlevel 1 (
  echo [ItemNest] Java was not found. JDK 21 or newer is required.
  pause
  exit /b 1
)

if not exist "backend\target\itemnest-1.0.0.jar" (
  echo [ItemNest] Application is not built yet. Running build.bat...
  call build.bat
  if errorlevel 1 exit /b 1
)

powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 8765); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo [ItemNest] Port 8765 is already in use.
  echo [ItemNest] Stop the existing process first, then run again.
  echo [ItemNest] netstat -ano ^| findstr :8765
  pause
  exit /b 1
)

set "ITEMNEST_DATA_DIR=%CD%\data"
set "SERVER_PORT=8765"
set "ITEMNEST_BIND_ADDRESS=0.0.0.0"
if not defined ITEMNEST_LAN_TOKEN set "ITEMNEST_LAN_TOKEN=itemnest-lan"

rem 检测本机局域网 IPv4（跳过回环与链路本地）
set "LAN_IP="
for /f "usebackq tokens=*" %%I in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } ^| Select-Object -First 1).IPAddress"`) do set "LAN_IP=%%I"

echo.
echo [ItemNest] LAN mode enabled.
echo [ItemNest] Local  URL:  http://127.0.0.1:8765   (本机，免 token)
if defined LAN_IP echo [ItemNest] Phone  URL:  http://%LAN_IP%:8765   (手机访问)
echo [ItemNest] Token:  %ITEMNEST_LAN_TOKEN%
echo [ItemNest] 手机首次访问请打开设置页填入上面这个 token。
echo [ItemNest] 若本机有多个网卡，请用 ipconfig 确认实际局域网 IP。
echo [ItemNest] Press Ctrl+C to stop.
echo.

rem 本机浏览器等后端就绪后打开（走 127.0.0.1 免 token）
start "" powershell -NoProfile -WindowStyle Hidden -Command "$deadline=(Get-Date).AddMinutes(3); while((Get-Date) -lt $deadline) { try { $c=New-Object Net.Sockets.TcpClient; $a=$c.BeginConnect('127.0.0.1',8765,$null,$null); if($a.AsyncWaitHandle.WaitOne(300) -and $c.Connected) { $c.EndConnect($a); $c.Close(); Start-Process 'http://127.0.0.1:8765'; exit 0 }; $c.Close() } catch {}; Start-Sleep -Milliseconds 700 }; exit 1"

java -jar "backend\target\itemnest-1.0.0.jar"
popd
