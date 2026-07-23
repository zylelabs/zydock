import { describe, expect, test } from 'bun:test';
import {
  classifyLevel,
  classifyLine,
  filterLogs,
  logsToText,
  type ClassifiedLog,
} from '../../src/modules/logs/log.filter';

describe('classifyLevel', () => {
  test('recognizes whole-word error markers', () => {
    expect(classifyLevel('FATAL: boom')).toBe('error');
    expect(classifyLevel('Request failed with code 500')).toBe('error');
    expect(classifyLevel('unhandled exception')).toBe('error');
  });

  test('recognizes warnings and deprecations', () => {
    expect(classifyLevel('WARN low disk')).toBe('warn');
    expect(classifyLevel('this API is deprecated')).toBe('warn');
  });

  test('defaults to info, and does not match substrings', () => {
    expect(classifyLevel('listening on port 3000')).toBe('info');
    // "mirror" contains "err" but is not the whole word.
    expect(classifyLevel('mirror synced')).toBe('info');
  });
});

describe('filterLogs', () => {
  const entries: ClassifiedLog[] = [
    { stream: 'stdout', message: 'starting up', level: 'info' },
    { stream: 'stderr', message: 'ERROR failed to bind', level: 'error' },
    { stream: 'stdout', message: 'WARN deprecated flag', level: 'warn' },
  ];

  test('filters by stream', () => {
    expect(filterLogs(entries, { stream: 'stderr' })).toHaveLength(1);
  });

  test('filters by level', () => {
    expect(filterLogs(entries, { level: 'warn' })[0]?.message).toBe('WARN deprecated flag');
  });

  test('search is case-insensitive substring', () => {
    expect(filterLogs(entries, { search: 'FAILED' })).toHaveLength(1);
  });

  test('combines filters (AND)', () => {
    expect(filterLogs(entries, { stream: 'stdout', level: 'error' })).toHaveLength(0);
  });
});

describe('logsToText', () => {
  test('renders timestamp, stream and message', () => {
    const line = logsToText([
      { timestamp: '2026-01-01T00:00:00Z', stream: 'stderr', message: 'boom', level: 'error' },
    ]);

    expect(line).toContain('2026-01-01T00:00:00Z');
    expect(line).toContain('[stderr]');
    expect(line).toContain('boom');
  });

  test('build lines (from classifyLine) have no timestamp', () => {
    const entry = classifyLine('npm install');

    expect(entry.timestamp).toBeUndefined();
    expect(entry.stream).toBe('stdout');
  });
});
