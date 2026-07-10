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

function writeToFile(level, sanitizedMsg) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${sanitizedMsg}\n`;
  try {
    fs.appendFileSync(logFilePath, logLine);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
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
