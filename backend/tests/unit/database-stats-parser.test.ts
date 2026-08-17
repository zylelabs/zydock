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

describe('getStats key=value parser', () => {
  test('parses a full output', async () => {
    const provider = providerWithStdout(
      [
        'connections=18',
        'maxConnections=100',
        'sizeBytes=4404019200',
        'versionLabel=16.3',
        'diskTotalBytes=103079215104',
        'diskUsedBytes=4404019200',
      ].join('\n'),
    );

    await expect(provider.getStats('container-1', credentials)).resolves.toEqual({
      connections: 18,
      maxConnections: 100,
      sizeBytes: 4404019200,
      versionLabel: '16.3',
      diskTotalBytes: 103079215104,
      diskUsedBytes: 4404019200,
    });
  });

  test('parses a partial output, leaving the missing keys undefined', async () => {
    const provider = providerWithStdout('connections=18');

    await expect(provider.getStats('container-1', credentials)).resolves.toEqual({
      connections: 18,
      maxConnections: undefined,
      sizeBytes: undefined,
      versionLabel: undefined,
      diskTotalBytes: undefined,
      diskUsedBytes: undefined,
    });
  });

  test('an empty output resolves to an empty stats object', async () => {
    const provider = providerWithStdout('');

    await expect(provider.getStats('container-1', credentials)).resolves.toEqual({
      connections: undefined,
      maxConnections: undefined,
      sizeBytes: undefined,
      versionLabel: undefined,
      diskTotalBytes: undefined,
      diskUsedBytes: undefined,
    });
  });

  test('falls back to dataPathSizeBytes when sizeBytes is missing', async () => {
    const provider = providerWithStdout(['connections=3', 'dataPathSizeBytes=999'].join('\n'));

    await expect(provider.getStats('container-1', credentials)).resolves.toMatchObject({
      sizeBytes: 999,
    });
  });

  test('a non-zero exit code resolves to an empty object, never throws', async () => {
    const provider = providerWithStdout('connections=18', 1);

    await expect(provider.getStats('container-1', credentials)).resolves.toEqual({});
  });
});
