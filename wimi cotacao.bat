@echo off
wscript.exe "%~dp0wimi cotacao.vbs" %*
exit /b %errorlevel%
