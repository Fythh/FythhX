@echo off
title FythhX Tools
cd /d "%~dp0"

REM -- Launcher handles browser opening; prevent server.js from opening a second tab --
set "IS_ELECTRON=1"

:launcher_start
echo.
echo  ========================================================
echo        FythhX Tools - Download Video dan Audio
echo  ========================================================
echo.

REM -- Check tools (Prioritizing portable tools/ directory) --
set "NEED_DOWNLOAD=0"
set "NEED_NODE=0"
set "NEED_YTDLP=0"
set "NEED_FFMPEG=0"

REM Prepend portable tools to PATH so this entire session prioritizes tools/
if exist "%~dp0tools\ffmpeg\bin" set "PATH=%~dp0tools\ffmpeg\bin;%PATH%"
if exist "%~dp0tools" set "PATH=%~dp0tools;%PATH%"
if exist "%~dp0tools\node" set "PATH=%~dp0tools\node;%PATH%"

if exist "tools\node\node.exe" (
    echo  [OK] Node.js ^(tools/ portable^) siap
) else (
    where node >nul 2>&1
    if errorlevel 1 (
        set "NEED_DOWNLOAD=1"
        set "NEED_NODE=1"
        echo  [--] Node.js belum terinstal
    ) else (
        echo  [OK] Node.js ^(system^) siap
    )
)

if exist "tools\yt-dlp.exe" (
    echo  [OK] yt-dlp ^(tools/ portable^) siap
) else (
    where yt-dlp >nul 2>&1
    if errorlevel 1 (
        set "NEED_DOWNLOAD=1"
        set "NEED_YTDLP=1"
        echo  [--] yt-dlp belum terinstal
    ) else (
        echo  [OK] yt-dlp ^(system^) siap
    )
)

if exist "tools\ffmpeg\bin\ffmpeg.exe" (
    echo  [OK] FFmpeg ^(tools/ portable^) siap
) else (
    where ffmpeg >nul 2>&1
    if errorlevel 1 (
        set "NEED_DOWNLOAD=1"
        set "NEED_FFMPEG=1"
        echo  [--] FFmpeg belum terinstal
    ) else (
        echo  [OK] FFmpeg ^(system^) siap
    )
)

echo.

REM -- Download missing tools if needed --
if "%NEED_DOWNLOAD%"=="1" (
    echo  Sedang mengunduh file pendukung ^(hanya dilakukan saat pertama kali^).
    echo  Mohon tunggu sebentar, pastikan koneksi internet Anda stabil...
    echo.
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\setup-tools.ps1" -NeedNode %NEED_NODE% -NeedYtdlp %NEED_YTDLP% -NeedFfmpeg %NEED_FFMPEG%
    if errorlevel 1 (
        echo.
        echo  ========================================================
        echo  [ERROR] Ups, Gagal Mengunduh File Pendukung!
        echo  ========================================================
        echo  Kemungkinan penyebab:
        echo  1. Koneksi internet terputus atau sangat lambat.
        echo  2. Antivirus memblokir proses unduhan otomatis.
        echo  
        echo  Solusi:
        echo  - Cek koneksi internet Anda.
        echo  - Matikan sementara Antivirus/Windows Defender jika perlu.
        echo  - Tutup jendela ini dan jalankan kembali START.bat.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Semua file pendukung berhasil diunduh!
    echo.
)

REM -- Refresh PATH so newly downloaded tools are immediately recognized --
if exist "%~dp0tools\ffmpeg\bin" set "PATH=%~dp0tools\ffmpeg\bin;%PATH%"
if exist "%~dp0tools" set "PATH=%~dp0tools;%PATH%"
if exist "%~dp0tools\node" set "PATH=%~dp0tools\node;%PATH%"

REM -- Check & Update yt-dlp to latest nightly --
if "%RESTARTED_AFTER_UPDATE%"=="1" goto :after_ytdlp_update

set "YTDLP_CHECK_CMD="
if exist "%~dp0tools\yt-dlp.exe" (
    set "YTDLP_CHECK_CMD=%~dp0tools\yt-dlp.exe"
) else (
    where yt-dlp >nul 2>&1
    if not errorlevel 1 set "YTDLP_CHECK_CMD=yt-dlp"
)

if not defined YTDLP_CHECK_CMD goto :after_ytdlp_update

echo  [~] Memeriksa pembaruan yt-dlp (nightly)...
set "VER_BEFORE="
for /f "tokens=*" %%v in ('"%YTDLP_CHECK_CMD%" --version 2^>nul') do set "VER_BEFORE=%%v"

"%YTDLP_CHECK_CMD%" --update-to nightly --socket-timeout 6

set "VER_AFTER="
for /f "tokens=*" %%v in ('"%YTDLP_CHECK_CMD%" --version 2^>nul') do set "VER_AFTER=%%v"

if not defined VER_BEFORE goto :after_ytdlp_update
if not defined VER_AFTER goto :after_ytdlp_update
if "%VER_BEFORE%"=="%VER_AFTER%" goto :after_ytdlp_update

echo.
echo  ========================================================
echo   [+] yt-dlp berhasil diperbarui!
echo       Versi lama : %VER_BEFORE%
echo       Versi baru : %VER_AFTER%
echo  ========================================================
echo   [~] Memulai ulang launcher dengan versi terbaru...
echo.
if exist "%~dp0tools\yt-dlp.exe.old" del /f /q "%~dp0tools\yt-dlp.exe.old" >nul 2>&1
set "RESTARTED_AFTER_UPDATE=1"
ping 127.0.0.1 -n 3 >nul 2>&1
cls
goto :launcher_start

:after_ytdlp_update
echo.

REM -- Check Python for subtitle feature
where python >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Python tidak ditemukan - fitur Auto Subtitle tidak tersedia
    echo  [INFO] Install Python dari https://python.org jika ingin pakai subtitle
) else (
    echo  [OK] Python tersedia
)


REM -- Pick node command --
set "NODE_CMD=node"
set "NPM_CMD=npm"
if exist "%~dp0tools\node\node.exe" (
    set "NODE_CMD=%~dp0tools\node\node.exe"
    set "NPM_CMD=%~dp0tools\node\npm.cmd"
)

REM -- Kill old process on port 8035 --
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8035 " ^| findstr "LISTENING"') do (
    echo  [~] Stopping old process on port 8035...
    taskkill /F /PID %%a >nul 2>&1
    ping 127.0.0.1 -n 2 >nul 2>&1
)

REM -- npm install if needed --
if not exist "node_modules" (
    echo  [~] Menginstal dependensi aplikasi ^(hanya sekali^)...
    call "%NPM_CMD%" install --production --no-fund --no-audit 2>nul
    echo  [OK] Instalasi selesai!
    echo.
)

echo  ========================================================
echo   Server: http://localhost:8035
echo   Tekan Ctrl+C untuk stop
echo  ========================================================
echo.

REM -- Open browser silently once the server is ready --
REM Uses the app heartbeat to avoid opening a duplicate localhost tab.
start "" /b powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$h=Join-Path $env:TEMP 'fythhx-localhost-8035-heartbeat.json'; $opened=$false; for($i=0;$i -lt 40;$i++){ if(Test-Path $h){ try{ $age=((Get-Date).ToUniversalTime()-(Get-Item $h).LastWriteTimeUtc).TotalSeconds; if($age -lt 12){ exit } }catch{} }; try{ $c=Get-NetTCPConnection -LocalPort 8035 -State Listen -ErrorAction Stop; if($c){ Start-Sleep -Milliseconds 300; if(Test-Path $h){ try{ $age=((Get-Date).ToUniversalTime()-(Get-Item $h).LastWriteTimeUtc).TotalSeconds; if($age -lt 12){ exit } }catch{} }; Start-Process 'http://localhost:8035'; $opened=$true; break } }catch{}; Start-Sleep -Milliseconds 300 }"

REM -- Start server --
"%NODE_CMD%" server.js

echo.
echo  Server stopped.
echo.
pause
