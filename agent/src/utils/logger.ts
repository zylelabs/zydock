import config, { type LogLevel } from '../config';

type LogContext = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_SYMBOL: Record<LogLevel, string> = {
  debug: '·',
  info: 'ℹ',
  warn: '⚠',
  error: '✖',
};

const LEVEL_WRITER: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const minimumPriority = LEVEL_PRIORITY[config.logLevel];

export const isDebugEnabled = LEVEL_PRIORITY.debug >= minimumPriority;

const isPretty = config.mode === 'dev';

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  return { message: String(error) };
};

const write = (level: LogLevel, message: string, context?: LogContext) => {
  if (LEVEL_PRIORITY[level] < minimumPriority) {
    return;
  }

  const hasContext = context !== undefined && Object.keys(context).length > 0;

  if (isPretty) {
    const line = `${LEVEL_SYMBOL[level]} ${message}`;

    if (hasContext) {
      LEVEL_WRITER[level](line, context);
      return;
    }

    LEVEL_WRITER[level](line);
    return;
  }

  LEVEL_WRITER[level](
    JSON.stringify({ level, time: new Date().toISOString(), message, ...context }),
  );
};

export const logDebug = (message: string, context?: LogContext) => write('debug', message, context);

export const logInfo = (message: string, context?: LogContext) => write('info', message, context);

export const logWarn = (message: string, context?: LogContext) => write('warn', message, context);

export const logError = (message: string, error?: unknown, context?: LogContext) => {
  if (error === undefined) {
    write('error', message, context);
    return;
  }

  write('error', message, { ...context, error: serializeError(error) });
};
