import { createLogger, format, transports, Logger } from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const LOG_DIR = process.env.LOG_DIR ?? 'logs';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'debug';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 5; // keep last 5 rotated files

interface FeatureConfig {
  pattern: RegExp;
  folder: string;
}

// Add an entry here whenever a new NestJS feature module needs its own log folder.
const FEATURES: FeatureConfig[] = [];

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// format.errors is intentionally omitted — AppLoggerService.serializeError()
// already extracts stack and Axios fields into a clean plain object before
// handing the entry to Winston, so the built-in errors transform is redundant
// and would attempt to spread raw Error properties into the log info.
const jsonFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.json(),
);

const consoleFormat = format.combine(
  format.colorize({ all: true }),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, context, ...rest }) => {
    const ctx = context ? `[${context as string}] ` : '';
    const stripped = Object.fromEntries(
      Object.entries(rest).filter(([k]) => k !== 'splat'),
    );
    let meta = '';
    if (Object.keys(stripped).length) {
      try {
        meta = ` ${JSON.stringify(stripped)}`;
      } catch {
        meta = ' [meta: unserializable — pass errors through logger.error()]';
      }
    }
    return `${timestamp as string} ${level} ${ctx}${message as string}${meta}`;
  }),
);

function featureFilter(pattern: RegExp) {
  return format((info) => {
    const context = typeof info.context === 'string' ? info.context : '';

    return pattern.test(context) ? info : false;
  });
}

export function buildWinstonLogger(): Logger {
  ensureDir(LOG_DIR);

  const coreTransports = [
    new transports.Console({ format: consoleFormat }),
    new transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      format: jsonFormat,
      maxsize: MAX_FILE_SIZE,
      maxFiles: MAX_FILES,
    }),
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: jsonFormat,
      maxsize: MAX_FILE_SIZE,
      maxFiles: MAX_FILES,
    }),
  ];

  const featureTransports = FEATURES.flatMap(({ pattern, folder }) => {
    const dir = path.join(LOG_DIR, folder);
    ensureDir(dir);
    return [
      new transports.File({
        filename: path.join(dir, 'combined.log'),
        format: format.combine(featureFilter(pattern)(), jsonFormat),
        maxsize: MAX_FILE_SIZE,
        maxFiles: MAX_FILES,
      }),
      new transports.File({
        filename: path.join(dir, 'error.log'),
        level: 'error',
        format: format.combine(featureFilter(pattern)(), jsonFormat),
        maxsize: MAX_FILE_SIZE,
        maxFiles: MAX_FILES,
      }),
    ];
  });

  return createLogger({
    level: LOG_LEVEL,
    transports: [...coreTransports, ...featureTransports],
  });
}
