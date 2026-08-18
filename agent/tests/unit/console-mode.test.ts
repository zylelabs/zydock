import { describe, expect, test } from 'bun:test';
import { modeOf } from '../../src/modules/containers/console.route';
import { createDockerProvider } from '../../src/providers/container/docker.provider';

describe('console modeOf', () => {
  test('accepts "shell" and "attach"', () => {
    expect(modeOf('shell')).toBe('shell');
    expect(modeOf('attach')).toBe('attach');
  });

  test('falls back to "shell" for an invalid or missing mode', () => {
    expect(modeOf('not-a-mode')).toBe('shell');
    expect(modeOf(undefined)).toBe('shell');
  });
});

describe('docker provider: openConsole attach mode', () => {
  test('refuses to attach when the container does not accept stdin', async () => {
    const containers = createDockerProvider();

    await expect(
      containers.openConsole('zydock-test-no-such-container', {
        shell: 'sh',
        mode: 'attach',
        onData: () => {},
        onClose: () => {},
      }),
    ).rejects.toThrow(/does not accept stdin/);
  });
});
