@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
set "ITEMNEST_EXIT_CODE=%ERRORLEVEL%"
if "%~1"=="" if not "%ITEMNEST_EXIT_CODE%"=="0" pause
exit /b %ITEMNEST_EXIT_CODE%
