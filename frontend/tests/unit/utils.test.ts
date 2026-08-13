import { describe, expect, test } from 'bun:test';
import {
  formatBytes,
  parseAnsi,
  stripAnsi,
  formatDuration,
  hasValue,
  mergeClasses,
  orDash,
  removeUndefinedKeys,
} from '../../app/utils/index';

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

describe('hasValue', () => {
  test('null and undefined are not values', () => {
    expect(hasValue(null)).toBeFalse();
    expect(hasValue(undefined)).toBeFalse();
  });

  test('falsy but present values are values', () => {
    expect(hasValue(0)).toBeTrue();
    expect(hasValue('')).toBeTrue();
    expect(hasValue(false)).toBeTrue();
  });
});

describe('orDash', () => {
  test('empty values render a dash', () => {
    expect(orDash(null)).toBe('-');
    expect(orDash(undefined)).toBe('-');
    expect(orDash('')).toBe('-');
  });

  test('other values pass through', () => {
    expect(orDash(0)).toBe(0);
    expect(orDash('value')).toBe('value');
  });
});

describe('removeUndefinedKeys', () => {
  test('drops undefined keys and empty nested objects', () => {
    const input: { a: number; b?: number; c?: { d?: number }; e: { f: number } } = {
      a: 1,
      b: undefined,
      c: { d: undefined },
      e: { f: 2 },
    };
    const result = removeUndefinedKeys(input);

    expect(result).toEqual({ a: 1, e: { f: 2 } });
  });

  test('filters undefined out of arrays', () => {
    expect(removeUndefinedKeys([1, undefined, 2])).toEqual([1, 2]);
  });
});

describe('parseAnsi', () => {
  const ESC = '\u001B';

  test('plain text becomes a single unstyled segment', () => {
    expect(parseAnsi('building image')).toEqual([{ text: 'building image', style: '' }]);
  });

  test('SGR codes turn into styled segments without leaking the escape', () => {
    const segments = parseAnsi(`${ESC}[1;36m\u25B8 install${ESC}[0m done`);

    expect(segments).toEqual([
      { text: '\u25B8 install', style: 'color:#42b3c2;font-weight:600' },
      { text: ' done', style: '' },
    ]);
  });

  test('256-color and truecolor sequences resolve to a color', () => {
    expect(parseAnsi(`${ESC}[38;5;196mred`)[0]?.style).toBe('color:rgb(255 0 0)');
    expect(parseAnsi(`${ESC}[38;2;10;20;30mrgb`)[0]?.style).toBe('color:rgb(10 20 30)');
  });

  test('non-color sequences are dropped and progress rewrites collapse', () => {
    expect(parseAnsi(`${ESC}[2K${ESC}[1G50%\r100%`)).toEqual([{ text: '100%', style: '' }]);
  });
});

describe('stripAnsi', () => {
  test('removes every escape sequence', () => {
    expect(stripAnsi('\u001B[1;36m\u25B8 build\u001B[0m')).toBe('\u25B8 build');
  });
});
