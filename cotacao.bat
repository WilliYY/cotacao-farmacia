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

echo [1/2] Verificando e atualizando dependencias locais (npm install)...
call npm install --no-audit --no-fund

echo.
echo [2/2] Iniciando o aplicativo...
echo =======================================================
call npm run dev
