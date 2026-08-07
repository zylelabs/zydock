import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import config from '../../src/config';
import { installIssue, readUpdateRun } from '../../src/modules/updates/updates.service';

const installPath = config.installPath;
const binPath = await mkdtemp(join(tmpdir(), 'zydock-updates-bin-'));

await rm(installPath, { recursive: true, force: true });
await writeFile(join(binPath, 'docker'), '#!/bin/sh\nexit 1\n');
await chmod(join(binPath, 'docker'), 0o755);

process.env.PATH = `${binPath}:${process.env.PATH}`;

const statePath = join(installPath, '.zydock-update.json');
const logPath = join(installPath, '.zydock-update.log');

const RUN_ID = '11111111-2222-3333-4444-555555555555';

const run = {
  id: RUN_ID,
  status: 'success',
  from: '1111111111111111111111111111111111111111',
  to: '2222222222222222222222222222222222222222',
  channel: 'stable',
  installPath,
  startedAt: '2026-08-06T03:00:00.000Z',
  finishedAt: '2026-08-06T03:04:00.000Z',
  error: '',
  exitCode: 0,
};

const writeState = (state: Record<string, unknown>) =>
  writeFile(statePath, JSON.stringify(state, null, 2));

describe('update runs on the agent', () => {
  test('an empty directory is not an install the agent can update', async () => {
    await mkdir(installPath, { recursive: true });

    expect(await installIssue()).toContain('docker-compose.prod.yml is missing');
  });

  test('an install without .env is refused, to never lose the secrets', async () => {
    await mkdir(join(installPath, 'scripts'), { recursive: true });
    await writeFile(join(installPath, 'docker-compose.prod.yml'), 'services: {}\n');
    await writeFile(join(installPath, 'scripts/update.sh'), '#!/usr/bin/env bash\n');
    await writeFile(join(installPath, 'scripts/update-runner.sh'), '#!/bin/sh\n');

    expect(await installIssue()).toContain('.env is missing');
  });

  test('a complete install has no issue', async () => {
    await writeFile(join(installPath, '.env'), 'ZYDOCK_COMMIT="abc"\nZYDOCK_CHANNEL="stable"\n');

    expect(await installIssue()).toBeUndefined();
  });

  test('there is no run before the first update', async () => {
    expect(await readUpdateRun()).toBeNull();
  });

  test('a finished run is answered with the tail of its log', async () => {
    await writeState(run);
    await writeFile(logPath, '▸ Rebuilding and restarting the stack\nDone\n');

    const state = await readUpdateRun(RUN_ID);

    expect(state?.status).toBe('success');
    expect(state?.to).toBe(run.to);
    expect(state?.log).toContain('Rebuilding');
  });

  test('another run id is not the stored run', async () => {
    expect(await readUpdateRun('another-run')).toBeNull();
  });

  test('a run still marked as running whose container is gone becomes unknown', async () => {
    await writeState({ ...run, status: 'running', finishedAt: '', to: '' });

    const state = await readUpdateRun(RUN_ID);

    expect(state?.status).toBe('unknown');
    expect(state?.error).toContain('never reported an outcome');

    const persisted = (await Bun.file(statePath).json()) as { status: string };

    expect(persisted.status).toBe('unknown');
  });

  test('a state file that is not a valid run is ignored', async () => {
    await writeFile(statePath, '{ not json');

    expect(await readUpdateRun()).toBeNull();

    await rm(installPath, { recursive: true, force: true });
    await rm(binPath, { recursive: true, force: true });
  });
});
