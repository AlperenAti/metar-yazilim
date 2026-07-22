@echo off
setlocal
title METAR Airspace

where node >nul 2>&1
if not errorlevel 1 (
    node "%~dp0server.mjs"
    exit /b %errorlevel%
)

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%CODEX_NODE%" (
    "%CODEX_NODE%" "%~dp0server.mjs"
    exit /b %errorlevel%
)

echo.
echo Node.js bulunamadi.
echo Lutfen Node.js 18 veya daha yeni bir surum kurun: https://nodejs.org/
echo Kurulumdan sonra bu dosyaya tekrar cift tiklayin.
pause
exit /b 1
