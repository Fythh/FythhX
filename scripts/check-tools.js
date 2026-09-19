#!/usr/bin/env node

/**
 * Check Tools Installation
 * 
 * Script untuk verify bahwa semua tools yang diperlukan sudah terinstall
 * Usage: node scripts/check-tools.js
 */

const { execSync } = require('child_process');
const path = require('path');

const tools = [
  {
    name: 'Node.js',
    command: 'node',
    versionFlag: '--version',
    minVersion: '14.0.0'
  },
  {
    name: 'npm',
    command: 'npm',
    versionFlag: '--version',
    minVersion: '6.0.0'
  },
  {
    name: 'Python',
    command: 'python',
    versionFlag: '--version',
    minVersion: '3.7.0',
    alternativeCommands: ['python3']
  },
  {
    name: 'yt-dlp',
    command: 'yt-dlp',
    versionFlag: '--version'
  },
  {
    name: 'ffmpeg',
    command: 'ffmpeg',
    versionFlag: '-version'
  },
  {
    name: 'ffprobe',
    command: 'ffprobe',
    versionFlag: '-version'
  }
];

function checkToolVersion(command, versionFlag) {
  try {
    const output = execSync(`${command} ${versionFlag}`, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    return output.split('\n')[0];
  } catch (err) {
    return null;
  }
}

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}

function main() {
  console.clear();
  console.log(`
╔════════════════════════════════════════════════════╗
║  🔧 MediaFetch Tools Installation Checker         ║
╚════════════════════════════════════════════════════╝
  `);

  let allInstalled = true;
  const results = [];

  tools.forEach((tool) => {
    let version = checkToolVersion(tool.command, tool.versionFlag);

    // Try alternative commands if primary fails
    if (!version && tool.alternativeCommands) {
      for (const altCommand of tool.alternativeCommands) {
        version = checkToolVersion(altCommand, tool.versionFlag);
        if (version) break;
      }
    }

    if (version) {
      // Extract version number if needed
      const versionMatch = version.match(/(\d+\.\d+\.\d+)/);
      const cleanVersion = versionMatch ? versionMatch[1] : version;

      // Check minimum version if specified
      let status = '✓';
      if (tool.minVersion) {
        if (compareVersions(cleanVersion, tool.minVersion) >= 0) {
          status = '✓';
        } else {
          status = '⚠';
          allInstalled = false;
        }
      }

      results.push({
        name: tool.name,
        status: status,
        version: cleanVersion,
        installed: true
      });
    } else {
      allInstalled = false;
      results.push({
        name: tool.name,
        status: '✕',
        version: 'Not Installed',
        installed: false
      });
    }
  });

  // Display results
  console.log('\n📋 Installation Status:\n');
  
  results.forEach((result) => {
    const statusIcon = result.status === '✓' ? '✅' : (result.status === '✕' ? '❌' : '⚠️');
    const status = result.status === '✓' ? 'OK' : (result.status === '✕' ? 'NOT INSTALLED' : 'UPDATE RECOMMENDED');
    
    console.log(`${statusIcon} ${result.name.padEnd(20)} ${status.padEnd(20)} ${result.version}`);
  });

  // Display summary
  console.log('\n' + '═'.repeat(50));

  if (allInstalled) {
    console.log('✅ Semua tools terinstall dengan baik!');
    console.log('\nAnda siap untuk menjalankan MediaFetch.');
    console.log('Jalankan dengan: npm start');
  } else {
    console.log('❌ Ada tools yang belum terinstall atau perlu update.');
    console.log('\nLihat instruksi instalasi di README.md');
    console.log('\nCommon fixes:');
    console.log('  1. Install yt-dlp: pip install yt-dlp');
    console.log('  2. Install ffmpeg: brew install ffmpeg (macOS)');
    console.log('  3. Install ffmpeg: choco install ffmpeg (Windows)');
    console.log('  4. Update yt-dlp: pip install --upgrade yt-dlp');
  }

  console.log('\n' + '═'.repeat(50) + '\n');

  process.exit(allInstalled ? 0 : 1);
}

// Run checker
main();
