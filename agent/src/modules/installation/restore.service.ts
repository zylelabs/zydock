import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { logInfo, logWarn } from '../../utils/logger';
import {
  restoreRunStateSchema,
  type RestoreRunState,
  type RestoreRunStatus,
  type StartRestoreDTO,
} from './restore.schema';

const LOG_TAIL_LINES = 500;

const containers = resolveContainerProvider();

const statePath = () => join(config.installPath, '.zydock-restore.json');

const logPath = () => join(config.installPath, '.zydock-restore.log');

const bundleRoot = () => resolve(config.installPath, '.zydock-snapshots');

const bundlePathOf = (snapshotId: string) => {
  const target = resolve(bundleRoot(), `${snapshotId}.zsnap`);

  if (!target.startsWith(`${bundleRoot()}${sep}`)) {
    throw new Error(`Invalid snapshot id "${snapshotId}"`);
  }

  return target;
};

export const stageSnapshotBundle = async (snapshotId: string, body: ReadableStream<Uint8Array>) => {
  const path = bundlePathOf(snapshotId);

  await mkdir(bundleRoot(), { recursive: true });

  const reader = body.getReader();
  const writer = Bun.file(path).writer();

  let sizeBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      sizeBytes += value.byteLength;
      writer.write(value);
      await writer.flush();
    }
  } finally {
    await writer.end();
  }

  return { path, sizeBytes };
};

const containerName = (runId: string) => `zydock-restorer-${runId}`;

export const restoreInstallIssue = async () => {
  const required = ['docker-compose.prod.yml', 'scripts/restore.sh', 'scripts/restore-runner.sh'];

  for (const entry of required) {
    if (!(await Bun.file(join(config.installPath, entry)).exists())) {
      return `${config.installPath} does not look like a Zydock install: ${entry} is missing`;
    }
  }

  return undefined;
};

const writeState = async (state: RestoreRunState) => {
  await Bun.write(statePath(), `${JSON.stringify(state, null, 2)}\n`);

  return state;
};

const readState = async (): Promise<RestoreRunState | null> => {
  const file = Bun.file(statePath());

  if (!(await file.exists())) {
    return null;
  }

  try {
    return restoreRunStateSchema.parse(await file.json());
  } catch (error) {
    logWarn('The restore state file could not be read', { error: errorMessage(error) });

    return null;
  }
};

const readLogTail = async () => {
  const file = Bun.file(logPath());

  if (!(await file.exists())) {
    return '';
  }

  const lines = (await file.text()).split('\n');

  return lines.slice(-LOG_TAIL_LINES).join('\n');
};

const isContainerRunning = async (runId: string) => {
  const info = await containers.inspectContainer(containerName(runId));

  return info?.state === 'running' || info?.state === 'created';
};

const discardContainer = async (runId: string) => {
  try {
    await containers.removeContainer(containerName(runId));
  } catch {
    return;
  }
};

const reconcile = async (state: RestoreRunState) => {
  if (state.status !== 'running' || (await isContainerRunning(state.id))) {
    return state;
  }

  logWarn('The restore run vanished before reporting an outcome', { runId: state.id });

  return writeState({
    ...state,
    status: 'unknown' satisfies RestoreRunStatus,
    finishedAt: new Date().toISOString(),
    error: 'The restorer container is gone and never reported an outcome',
  });
};

export const readRestoreRun = async (runId?: string) => {
  const stored = await readState();

  if (!stored || (runId && stored.id !== runId)) {
    return null;
  }

  const state = await reconcile(stored);

  return { ...state, log: await readLogTail() };
};

export const startRestoreRun = async (payload: StartRestoreDTO) => {
  const issue = await restoreInstallIssue();

  if (issue) {
    throw new Error(issue);
  }

  const previous = await readState();

  if (previous && previous.status === 'running' && (await isContainerRunning(previous.id))) {
    throw new Error(`Restore ${previous.id} is already running`);
  }

  if (previous) {
    await discardContainer(previous.id);
  }

  const id = randomUUID();

  const state = await writeState({
    id,
    status: 'running',
    bundlePath: payload.bundlePath,
    installPath: config.installPath,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    error: '',
    exitCode: 0,
  });

  const environment: Record<string, string> = {
    ZYDOCK_INSTALL_DIR: config.installPath,
    ZYDOCK_RUN_ID: id,
    ZYDOCK_RESTORE: payload.bundlePath,
    ZYDOCK_RESTORE_PASSPHRASE: payload.passphrase,
    ZYDOCK_RUN_STARTED_AT: state.startedAt,
  };

  try {
    const container = await containers.createContainer({
      name: containerName(id),
      image: config.restorerImage,
      command: ['sh', join(config.installPath, 'scripts/restore-runner.sh')],
      environment,
      volumes: [
        { source: config.dockerSocketPath, target: '/var/run/docker.sock' },
        { source: config.installPath, target: config.installPath },
      ],
      labels: { 'zydock.role': 'restorer', 'zydock.restore.run': id },
      restartPolicy: 'no',
    });

    await containers.startContainer(container.id);
  } catch (error) {
    await writeState({
      ...state,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `The restorer container could not start: ${errorMessage(error)}`,
      exitCode: 1,
    });

    throw error;
  }

  logInfo('Restore run started', { runId: id, bundlePath: payload.bundlePath });

  return state;
};
