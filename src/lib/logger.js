import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const logDir = './logs';
const logFilePath = path.join(logDir, 'app.log');

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function sanitize(message) {
  if (typeof message !== 'string') {
    try {
      message = JSON.stringify(message);
    } catch {
      message = String(message);
    }
  }

  // Sanitization patterns for passwords, tokens, auth cookies, credentials
  return message
    .replace(/(password|senha|token|cookie|auth|credentials|secret)["']?\s*[:=]\s*["']?([^"'\s&]+)["']?/gi, '$1=***REDACTED***')
    .replace(/bearer\s+([^"'\s&]+)/gi, 'Bearer ***REDACTED***');
}

async function logToDb(level, msg) {
  try {
    const { saveLogToDb } = await import('./database.js');
    await saveLogToDb(level, msg);
  } catch (err) {
    // ignore to prevent loops
  }
}

function writeToFile(level, sanitizedMsg) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${sanitizedMsg}\n`;
  try {
    // 2MB size-based rotation checks
    if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > 2 * 1024 * 1024) {
      try {
        const content = fs.readFileSync(logFilePath, 'utf8');
        const lines = content.split('\n');
        if (lines.length > 500) {
          fs.writeFileSync(logFilePath, lines.slice(-500).join('\n'));
        } else {
          fs.writeFileSync(logFilePath, '');
        }
      } catch (rotErr) {
        // ignore
      }
    }
    fs.appendFileSync(logFilePath, logLine);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
  
  // Write log to DB dynamically
  logToDb(level, sanitizedMsg);
}

export const logger = {
  debug: (msg) => {
    if (currentLogLevel <= LOG_LEVELS.debug) {
      const sanitized = sanitize(msg);
      console.log(`\x1b[36m[DEBUG]\x1b[0m ${sanitized}`);
      writeToFile('debug', sanitized);
    }
  },
  info: (msg) => {
    if (currentLogLevel <= LOG_LEVELS.info) {
      const sanitized = sanitize(msg);
      console.log(`\x1b[32m[INFO]\x1b[0m ${sanitized}`);
      writeToFile('info', sanitized);
    }
  },
  warn: (msg) => {
    if (currentLogLevel <= LOG_LEVELS.warn) {
      const sanitized = sanitize(msg);
      console.warn(`\x1b[33m[WARN]\x1b[0m ${sanitized}`);
      writeToFile('warn', sanitized);
    }
  },
  error: (msg) => {
    if (currentLogLevel <= LOG_LEVELS.error) {
      const sanitized = sanitize(msg);
      console.error(`\x1b[31m[ERROR]\x1b[0m ${sanitized}`);
      writeToFile('error', sanitized);
    }
  }
};
