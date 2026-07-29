import type { LogEntry } from '../../providers/container';

export const LOG_LEVELS = ['error', 'warn', 'info'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type ClassifiedLog = {
  timestamp?: string;
  stream?: 'stdout' | 'stderr';
  message: string;
  level: LogLevel;
};

export type LogFilters = {
  search?: string;
  stream?: 'stdout' | 'stderr';
  level?: LogLevel;
};

const ERROR_PATTERN = /\b(error|err|fatal|panic|exception|fail(?:ed|ure|s)?)\b/i;
const WARN_PATTERN = /\b(warn(?:ing)?|deprecat(?:ed|ion))\b/i;

export const classifyLevel = (message: string): LogLevel => {
  if (ERROR_PATTERN.test(message)) {
    return 'error';
  }

  if (WARN_PATTERN.test(message)) {
    return 'warn';
  }

  return 'info';
};

export const classifyEntry = (entry: LogEntry): ClassifiedLog => ({
  timestamp: entry.timestamp,
  stream: entry.stream,
  message: entry.message,
  level: classifyLevel(entry.message),
});

export const classifyLine = (message: string): ClassifiedLog => ({
  stream: 'stdout',
  message,
  level: classifyLevel(message),
});

export const filterLogs = (entries: ClassifiedLog[], filters: LogFilters): ClassifiedLog[] => {
  const needle = filters.search?.toLowerCase();

  return entries.filter(entry => {
    if (filters.stream && entry.stream !== filters.stream) {
      return false;
    }

    if (filters.level && entry.level !== filters.level) {
      return false;
    }

    if (needle && !entry.message.toLowerCase().includes(needle)) {
      return false;
    }

    return true;
  });
};

export const logsToText = (entries: ClassifiedLog[]) =>
  entries
    .map(entry =>
      [entry.timestamp, entry.stream && `[${entry.stream}]`, entry.message]
        .filter(Boolean)
        .join(' '),
    )
    .join('\n');
