import { describe, expect, test } from 'bun:test';
import { errorMessage } from '../../src/utils';

describe('errorMessage', () => {
  test('reads the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  test('stringifies a non-Error value', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
  });
});
