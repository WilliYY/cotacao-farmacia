@echo off
title Wimifarma Cotacao - Inicializador Portatil
echo =======================================================
echo     WIMIFARMA COTACAO - INICIALIZADOR PORTATIL
echo =======================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao foi encontrado neste computador!
    echo Para rodar o aplicativo do pendrive, o Node.js deve estar instalado.
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"

echo Verificando versao, dependencias e iniciando o aplicativo...
echo =======================================================
call npm run dev -- %*

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Nao foi possivel iniciar o Wimifarma Cotacao.
    pause
    exit /b 1
)
