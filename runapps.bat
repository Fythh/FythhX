@echo off
title FythhX App Launcher
cd /d "%~dp0"

echo Menjalankan FythhX Server...
call npm run app:dev

pause