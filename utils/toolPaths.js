/**
 * Tool Paths Resolver
 * 
 * Resolves paths to external tools (yt-dlp, ffmpeg, ffprobe).
 * Checks portable tools/ folder first, then falls back to system PATH.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

/**
 * Check if a file exists at given path
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Check if a command exists in system PATH
 */
function commandInPath(cmd) {
  try {
    execSync(`where ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve path for a tool - portable first, then system PATH
 */
function resolveTool(name, portableRelPath) {
  const portablePath = path.join(TOOLS_DIR, portableRelPath);
  if (fileExists(portablePath)) {
    return portablePath;
  }
  // Fall back to system PATH
  return name;
}

const toolPaths = {
  get ytdlp() {
    return resolveTool('yt-dlp', 'yt-dlp.exe');
  },
  get ffmpeg() {
    return resolveTool('ffmpeg', path.join('ffmpeg', 'bin', 'ffmpeg.exe'));
  },
  get ffprobe() {
    return resolveTool('ffprobe', path.join('ffmpeg', 'bin', 'ffprobe.exe'));
  },
  get node() {
    return resolveTool('node', path.join('node', 'node.exe'));
  },

  /**
   * Check if a tool is available (portable or system)
   */
  isAvailable(toolName) {
    const portable = {
      'yt-dlp': path.join(TOOLS_DIR, 'yt-dlp.exe'),
      'ffmpeg': path.join(TOOLS_DIR, 'ffmpeg', 'bin', 'ffmpeg.exe'),
      'ffprobe': path.join(TOOLS_DIR, 'ffmpeg', 'bin', 'ffprobe.exe')
    };

    if (portable[toolName] && fileExists(portable[toolName])) {
      return true;
    }
    return commandInPath(toolName);
  }
};

module.exports = toolPaths;
