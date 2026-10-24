@echo off
title JobPortal - Starting Server...
echo ========================================================
echo   Starting JobPortal Server with Live Aggregator API
echo ========================================================
echo.

cd /d "%~dp0backend"

echo Checking Node.js installation...
node -v >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js from https://nodejs.org/ to run the backend API.
    echo.
    echo Opening frontend in standalone mode...
    start "" "%~dp0eX2.html"
    pause
    exit /b 1
)

echo Node.js detected:
node -v
echo.
echo Starting backend server on http://localhost:5000 ...
echo (Press Ctrl+C to stop the server)
echo.
timeout /t 2 >nul
start "" http://localhost:5000
node server.js

pause

