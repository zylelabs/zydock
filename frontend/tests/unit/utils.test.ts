import { describe, expect, test } from 'bun:test';
import { formatBytes, formatDuration, mergeClasses } from '../../app/utils/index';

describe('formatBytes', () => {
  test('zero and falsy', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
  });

  test('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

describe('formatDuration', () => {
  test('falsy renders a dash', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(0)).toBe('—');
  });

  test('seconds under a minute', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  test('minutes and seconds, zero-padded', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(125000)).toBe('2m 05s');
  });
});

describe('mergeClasses', () => {
  test('later Tailwind utilities win over earlier conflicting ones', () => {
    expect(mergeClasses('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  test('falsy values are dropped', () => {
    expect(mergeClasses('text-sm', false, undefined, 'font-medium')).toBe('text-sm font-medium');
  });
});
