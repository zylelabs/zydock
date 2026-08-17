import { describe, expect, test } from 'bun:test';
import type { ContainerProvider } from '../../src/providers/container/container.contract';
import type { StorageProvider } from '../../src/providers/storage/storage.contract';
import { createContainerDatabaseProvider } from '../../src/providers/database/container.provider';
import { ENGINES } from '../../src/providers/database/engines';
import type { DatabaseCredentials } from '../../src/providers/database/database.contract';

const credentials: DatabaseCredentials = {
  host: 'zydock-db-test',
  port: 5432,
  username: 'zydock',
  password: 'secret',
  database: 'app',
  connectionUri: 'postgresql://zydock:secret@zydock-db-test:5432/app',
};

const providerWithStdout = (stdout: string, exitCode = 0) => {
  const containers = {
    execCommand: async () => ({ exitCode, stdout, stderr: '' }),
  } as unknown as ContainerProvider;

  return createContainerDatabaseProvider(ENGINES.postgresql, {
    containers,
    storage: {} as StorageProvider,
  });
};

describe('getClientConnections client=<ip> <count> parser', () => {
  test('parses a full output', async () => {
    const provider = providerWithStdout(
      ['client=10.0.0.2 3', 'client=10.0.0.5 1', 'client=10.0.0.9 12'].join('\n'),
    );

    await expect(provider.getClientConnections('container-1', credentials)).resolves.toEqual({
      '10.0.0.2': 3,
      '10.0.0.5': 1,
      '10.0.0.9': 12,
    });
  });

  test('a repeated ip keeps the last count seen for that ip', async () => {
    const provider = providerWithStdout(['client=10.0.0.2 3', 'client=10.0.0.2 7'].join('\n'));

    await expect(provider.getClientConnections('container-1', credentials)).resolves.toEqual({
      '10.0.0.2': 7,
    });
  });

  test('ignores malformed lines: missing count, non-numeric count, no client= prefix', async () => {
    const provider = providerWithStdout(
      [
        'client=10.0.0.2',
        'client=10.0.0.3 not-a-number',
        'irrelevant line',
        'client=10.0.0.4 5',
      ].join('\n'),
    );

    await expect(provider.getClientConnections('container-1', credentials)).resolves.toEqual({
      '10.0.0.4': 5,
    });
  });

  test('an empty output resolves to an empty object', async () => {
    const provider = providerWithStdout('');

    await expect(provider.getClientConnections('container-1', credentials)).resolves.toEqual({});
  });

  test('a non-zero exit code resolves to an empty object, never throws', async () => {
    const provider = providerWithStdout('client=10.0.0.2 3', 1);

    await expect(provider.getClientConnections('container-1', credentials)).resolves.toEqual({});
  });
});
