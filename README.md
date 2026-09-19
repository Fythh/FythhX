# FythhX

A local video/audio downloader + web-based video editor (trim, clip, AI auto-subtitle, watermark) that runs entirely **on your own machine** — no online server, no limits, no forced watermark.

---

## ⚠️ This repository contains SOURCE CODE — for developers

This repo is meant for people who want to **read, modify, or build on the code**.

**If you just want to *use* the finished app** (no coding, no setup), go to the **[Releases](../../releases)** page instead. Releases are pre-built, ready-to-run packages that are updated more often and don't require Node.js, npm, or any of the setup below.

Continue reading only if you specifically want the raw source code.

---

## Running From Source (3 Steps)

### 1. Extract the ZIP first

⚠️ This is the step people most often skip. Don't run anything directly from inside the ZIP file.

- Right-click the downloaded ZIP
- Choose **Extract All...**
- Pick a destination folder (Desktop or Documents works fine)
- Click **Extract**

You should now have a regular **folder** (not a ZIP anymore) containing all the project files.

### 2. Open the extracted folder, then double-click `START.bat`

Look for a file called **`START.bat`** and double-click it.

A black Command Prompt window will open and walk through a few checks:

```
[OK] Node.js ready
[OK] yt-dlp ready
[OK] FFmpeg ready
[~] Installing app dependencies (first run only)...
[OK] Installation complete!

Server: http://localhost:8080
```

**About that black window:**
- This is normal — it's just the app's backend running in the background
- **Keep this window open** while using the app. Closing it stops the app
- You can minimize it, just don't close it
- The dependency install step (`[~] Installing app dependencies...`) only happens **once**, on the very first run — it needs an internet connection and can take a few minutes depending on your connection speed. Every run after that is fast.

### 3. Your browser opens automatically

Once ready, your default browser opens to `http://localhost:8080` — that's the app, ready to use.

If it doesn't open automatically, open any browser (Chrome/Edge/etc.) and go to `http://localhost:8080` manually.

---

## Stopping the App

Either:
- Close the black Command Prompt window that opened when you ran `START.bat`, **or**
- Double-click `STOP.bat` in the same folder

---

## Troubleshooting

### It says "Server stopped", or shows a red `Error`

Take a screenshot of the error message — it's now specific and actionable (not just a generic "Server stopped"), so it should point directly at the cause.

### The black window closes itself instantly, no time to read anything

You most likely didn't extract the ZIP first (still running from inside it). Go back to **Step 1**.

### Install step takes forever / never finishes

- Check your internet connection
- Temporarily disable Antivirus/Windows Defender — it sometimes flags the automatic tool download as suspicious
- Close the window and run `START.bat` again

### Windows shows "Windows protected your PC" / SmartScreen warning

This appears because the `.bat`/`.exe` isn't yet "recognized" by Windows (normal for new/independent tools, not a sign of malware). Click **More info** → **Run anyway**.

### Port 8080 is already in use / conflicts

`START.bat` automatically tries to kill any leftover process on that port. If it still conflicts, restart your PC and run `START.bat` again.

### Prefer running it manually via CLI

```
cd path\to\FythhX-master
npm install
npm start
```

Then open `http://localhost:8080` in your browser.

---

## Features

- **Downloader** — download video/audio at original quality, no watermark/ads, from multiple platforms
- **Trimmer** — cut a video down to the part you want, including Multi-Trim (cutting several segments at once)
- **Clipper** — automatically surfaces the most engaging moments using "Most Replayed" heatmap data, with:
  - Automatic AI subtitles (Whisper — local or cloud provider)
  - Custom watermark
  - Multiple aspect ratios (16:9, 9:16, 1:1) and crop modes
- **Storage** — manage all your downloaded/exported files in one place

---

## System Requirements

- Windows 10/11
- Internet connection (for the first-time install step and for downloading videos)
- No need to manually install Node.js/yt-dlp/FFmpeg — `START.bat` downloads them automatically if missing

---

## For Developers

```
git clone <this-repo-url>
cd FythhX-master
npm install
npm start
```

See `package.json` for available scripts (`npm run check`, `npm run build`, etc.).

Contributions and forks are welcome — this project is open source specifically so others can build on it.
