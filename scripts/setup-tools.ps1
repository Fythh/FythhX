# ============================================
# MediaFetch - Portable Tools Downloader
# Downloads Node.js, yt-dlp, ffmpeg to tools/
# Only downloads what's actually needed
# ============================================

param(
    [string]$NeedNode = "1",
    [string]$NeedYtdlp = "1",
    [string]$NeedFfmpeg = "1"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$toolsDir = Join-Path $projectDir "tools"

# ── Download URLs ──
$nodeVersion = "v20.11.1"
$nodeUrl = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip"
$ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"

# ── Helper Functions ──
function Write-Step($msg) { Write-Host "  [~] $msg" -ForegroundColor Cyan }
function Write-Done($msg) { Write-Host "  [+] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [!] $msg" -ForegroundColor Red }
function Write-Skip($msg) { Write-Host "  [-] $msg" -ForegroundColor DarkGray }

function Download-File($url, $output) {
    $fileName = Split-Path $output -Leaf
    Write-Step "Mengunduh $fileName ..."
    try {
        $curlExe = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curlExe) {
            & curl.exe -L -o $output $url --progress-bar --fail
            if ($LASTEXITCODE -ne 0) { throw "curl failed" }
        } else {
            Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing
        }
        Write-Done "Selesai mengunduh $fileName"
    } catch {
        Write-Fail "Gagal mengunduh: $_"
        throw
    }
}

# ── Create tools directory ──
if (-not (Test-Path $toolsDir)) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
}

# ── 1. Node.js ──
if ($NeedNode -eq "1") {
    if (-not (Test-Path "$toolsDir\node\node.exe")) {
        Write-Host ""
        Write-Host "  -- Node.js $nodeVersion --" -ForegroundColor Yellow
        $nodeZip = Join-Path $toolsDir "node.zip"
        Download-File $nodeUrl $nodeZip

        Write-Step "Mengekstrak Node.js..."
        Expand-Archive -Path $nodeZip -DestinationPath $toolsDir -Force

        $nodeFolder = Get-ChildItem $toolsDir -Directory -Filter "node-*" | Select-Object -First 1
        if ($nodeFolder) {
            if (Test-Path "$toolsDir\node") { Remove-Item "$toolsDir\node" -Recurse -Force }
            Rename-Item $nodeFolder.FullName "$toolsDir\node"
        }

        Remove-Item $nodeZip -Force -ErrorAction SilentlyContinue
        Write-Done "Node.js (portable) berhasil diinstal"
    } else {
        Write-Done "Node.js sudah terinstal"
    }
} else {
    Write-Skip "Node.js terdeteksi di sistem"
}

# ── 2. yt-dlp ──
if ($NeedYtdlp -eq "1") {
    if (-not (Test-Path "$toolsDir\yt-dlp.exe")) {
        Write-Host ""
        Write-Host "  -- yt-dlp --" -ForegroundColor Yellow
        Download-File $ytdlpUrl "$toolsDir\yt-dlp.exe"
    } else {
        Write-Done "yt-dlp sudah terinstal"
    }
} else {
    Write-Skip "yt-dlp terdeteksi di sistem"
}

# ── 3. ffmpeg ──
if ($NeedFfmpeg -eq "1") {
    if (-not (Test-Path "$toolsDir\ffmpeg\bin\ffmpeg.exe")) {
        Write-Host ""
        Write-Host "  -- ffmpeg --" -ForegroundColor Yellow
        $ffmpegZip = Join-Path $toolsDir "ffmpeg.zip"
        Download-File $ffmpegUrl $ffmpegZip

        Write-Step "Mengekstrak FFmpeg (proses ini memakan waktu beberapa saat)..."
        $tempDir = Join-Path $toolsDir "ffmpeg-temp"
        Expand-Archive -Path $ffmpegZip -DestinationPath $tempDir -Force

        $ffmpegFolder = Get-ChildItem $tempDir -Directory | Select-Object -First 1
        if ($ffmpegFolder) {
            if (Test-Path "$toolsDir\ffmpeg") { Remove-Item "$toolsDir\ffmpeg" -Recurse -Force }
            Move-Item $ffmpegFolder.FullName "$toolsDir\ffmpeg" -Force
        }

        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
        Write-Done "FFmpeg berhasil diinstal"
    } else {
        Write-Done "FFmpeg sudah terinstal"
    }
} else {
    Write-Skip "FFmpeg terdeteksi di sistem"
}

Write-Host ""
Write-Done "All tools ready!"
Write-Host ""
exit 0
