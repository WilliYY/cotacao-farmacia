@echo off
where powershell.exe >nul 2>nul
if errorlevel 1 goto vbs_fallback
if not exist "%~dp0scripts\launch-hidden.ps1" goto vbs_fallback

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\launch-hidden.ps1" %*
exit /b %errorlevel%

:vbs_fallback
where wscript.exe >nul 2>nul
if errorlevel 1 goto visible_fallback

wscript.exe "%~dp0wimi cotacao.vbs" %*
exit /b %errorlevel%

:visible_fallback
call "%~dp0cotacao.bat" %*
exit /b %errorlevel%
