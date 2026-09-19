@echo off
chcp 65001 >nul 2>&1
title MediaFetch - Stopping
echo.
echo  Stopping MediaFetch server...
echo.

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
    echo  [OK] Process %%a stopped
)

echo.
echo  Server stopped.
timeout /t 2 /nobreak >nul
