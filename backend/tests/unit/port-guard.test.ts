import { describe, expect, test } from 'bun:test';
import { findHostPortConflict } from '../../src/modules/applications/port-guard.service';

describe('findHostPortConflict', () => {
  test('returns null when no host ports are requested', async () => {
    expect(await findHostPortConflict('server-1', [])).toBeNull();
  });

  test('reserves :80 and :443 without consulting the agent', async () => {
    expect(await findHostPortConflict('server-1', [80])).toEqual({
      port: 80,
      owner: 'the Zydock proxy (:80)',
    });
    expect(await findHostPortConflict('server-1', [443])).toEqual({
      port: 443,
      owner: 'the Zydock proxy (:443)',
    });
  });

  test('checks the reserved ports before any other requested port', async () => {
    expect(await findHostPortConflict('server-1', [3001, 443])).toEqual({
      port: 443,
      owner: 'the Zydock proxy (:443)',
    });
  });
});
