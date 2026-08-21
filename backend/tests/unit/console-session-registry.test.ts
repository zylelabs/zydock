import { describe, expect, test } from 'bun:test';
import {
  closeConsoleSessionsOf,
  registerConsoleSession,
  unregisterConsoleSession,
} from '../../src/modules/console/console.service';

describe('console session registry', () => {
  test('revoking a session closes every console socket registered under it', () => {
    let closed = 0;
    const handle = { close: () => closed++ };

    registerConsoleSession('session-a', handle);
    closeConsoleSessionsOf('session-a');

    expect(closed).toBe(1);
  });

  test('closing a session with no open console sockets is a no-op', () => {
    expect(() => closeConsoleSessionsOf('session-without-sockets')).not.toThrow();
  });

  test('unregistering a socket keeps it from being closed again by a later revocation', () => {
    let closed = 0;
    const handle = { close: () => closed++ };

    registerConsoleSession('session-b', handle);
    unregisterConsoleSession('session-b', handle);
    closeConsoleSessionsOf('session-b');

    expect(closed).toBe(0);
  });

  test('two sockets under the same session are both closed', () => {
    let closed = 0;
    const handleA = { close: () => closed++ };
    const handleB = { close: () => closed++ };

    registerConsoleSession('session-c', handleA);
    registerConsoleSession('session-c', handleB);
    closeConsoleSessionsOf('session-c');

    expect(closed).toBe(2);
  });
});
