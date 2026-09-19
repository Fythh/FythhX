@echo off
title FythhX Tools
cd /d "%~dp0"

echo.
echo  ========================================================
echo        FythhX Tools - Download Video dan Audio
echo  ========================================================
echo.

REM -- Check tools --
set "NEED_DOWNLOAD=0"

where node >nul 2>&1
if errorlevel 1 (
    if not exist "tools\node\node.exe" (
        set "NEED_DOWNLOAD=1"
        echo  [--] Node.js belum terinstal
    ) else (
        echo  [OK] Node.js ^(portable^) siap
    )
) else (
    echo  [OK] Node.js ^(system^) siap
)

where yt-dlp >nul 2>&1
if errorlevel 1 (
    if not exist "tools\yt-dlp.exe" (
        set "NEED_DOWNLOAD=1"
        echo  [--] yt-dlp belum terinstal
    ) else (
        echo  [OK] yt-dlp ^(portable^) siap
    )
) else (
    echo  [OK] yt-dlp ^(system^) siap
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
    if not exist "tools\ffmpeg\bin\ffmpeg.exe" (
        set "NEED_DOWNLOAD=1"
        echo  [--] FFmpeg belum terinstal
    ) else (
        echo  [OK] FFmpeg ^(portable^) siap
    )
) else (
    echo  [OK] FFmpeg ^(system^) siap
)

echo.

REM -- Download missing tools if needed --
if "%NEED_DOWNLOAD%"=="1" (
    echo  Sedang mengunduh file pendukung ^(hanya dilakukan saat pertama kali^).
    echo  Mohon tunggu sebentar, pastikan koneksi internet Anda stabil...
    echo.
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\setup-tools.ps1" -NeedNode 1 -NeedYtdlp 1 -NeedFfmpeg 1
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

REM -- Kill old process on port 8080 --
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 " ^| findstr "LISTENING"') do (
    echo  [~] Stopping old process on port 8080...
    taskkill /F /PID %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
)

REM -- npm install if needed --
if not exist "node_modules" (
    echo  [~] Menginstal dependensi aplikasi ^(hanya sekali^)...
    call "%NPM_CMD%" install --production --no-fund --no-audit 2>nul
    echo  [OK] Instalasi selesai!
    echo.
)

echo  ========================================================
echo   Server: http://localhost:8080
echo   Tekan Ctrl+C untuk stop
echo  ========================================================
echo.

REM -- Open browser --
timeout /t 2 /nobreak >nul
start "" "http://localhost:8080"

REM -- Start server --
"%NODE_CMD%" server.js

echo.
echo  Server stopped.
echo.
pause
