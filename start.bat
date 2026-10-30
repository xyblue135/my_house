@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
set "MYHOUSE_EXIT_CODE=%ERRORLEVEL%"
if "%~1"=="" if not "%MYHOUSE_EXIT_CODE%"=="0" pause
exit /b %MYHOUSE_EXIT_CODE%
