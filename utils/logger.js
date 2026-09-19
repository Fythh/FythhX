/**
 * Logger Utility
 * 
 * Simple logging system untuk development dan debugging
 */

const fs = require('fs');
const path = require('path');

// Color codes untuk console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(__dirname, '..', 'logs');
    this.logFile = options.logFile || 'app.log';
    this.enableFileLogging = options.enableFileLogging !== false;
    
    // Buat folder logs jika belum ada
    if (this.enableFileLogging && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Format timestamp
   */
  getTimestamp() {
    const now = new Date();
    return now.toISOString();
  }

  /**
   * Format log message
   */
  formatMessage(level, message, data = null) {
    const timestamp = this.getTimestamp();
    let formattedMsg = `[${timestamp}] [${level}] ${message}`;
    
    if (data) {
      formattedMsg += ` ${JSON.stringify(data)}`;
    }
    
    return formattedMsg;
  }

  /**
   * Write to file
   */
  writeToFile(message) {
    if (!this.enableFileLogging) return;

    try {
      const logPath = path.join(this.logDir, this.logFile);
      fs.appendFileSync(logPath, message + '\n');
    } catch (err) {
      console.error('Error writing to log file:', err);
    }
  }

  /**
   * Log info
   */
  info(message, data = null) {
    const msg = this.formatMessage('INFO', message, data);
    console.log(`${colors.cyan}${msg}${colors.reset}`);
    this.writeToFile(msg);
  }

  /**
   * Log success
   */
  success(message, data = null) {
    const msg = this.formatMessage('SUCCESS', message, data);
    console.log(`${colors.green}✓ ${msg}${colors.reset}`);
    this.writeToFile(msg);
  }

  /**
   * Log warning
   */
  warn(message, data = null) {
    const msg = this.formatMessage('WARN', message, data);
    console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`);
    this.writeToFile(msg);
  }

  /**
   * Log error
   */
  error(message, error = null) {
    let fullMsg = `${colors.red}✕ [${this.getTimestamp()}] [ERROR] ${message}${colors.reset}`;
    
    if (error) {
      fullMsg += `\n${error.stack || error.message || error}`;
    }
    
    console.log(fullMsg);
    this.writeToFile(`[${this.getTimestamp()}] [ERROR] ${message}\n${error?.stack || error?.message || error}`);
  }

  /**
   * Log debug
   */
  debug(message, data = null) {
    const msg = this.formatMessage('DEBUG', message, data);
    console.log(`${colors.dim}${msg}${colors.reset}`);
    this.writeToFile(msg);
  }

  /**
   * Log separator (untuk readability)
   */
  separator() {
    const line = '═'.repeat(60);
    console.log(`${colors.dim}${line}${colors.reset}`);
  }

  /**
   * Log section header
   */
  section(title) {
    console.log(`\n${colors.bright}${colors.blue}${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'='.repeat(60)}${colors.reset}\n`);
  }

  /**
   * Clear log file
   */
  clearLogFile() {
    if (this.enableFileLogging) {
      try {
        const logPath = path.join(this.logDir, this.logFile);
        fs.writeFileSync(logPath, '');
        this.info('Log file cleared');
      } catch (err) {
        this.error('Error clearing log file', err);
      }
    }
  }
}

// Export single instance
module.exports = new Logger();
