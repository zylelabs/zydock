import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { logInfo, logWarn } from '../../utils/logger';
import {
  updateRunStateSchema,
  type StartUpdateDTO,
  type UpdateRunState,
  type UpdateRunStatus,
} from './updates.schema';

const LOG_TAIL_LINES = 500;

const containers = resolveContainerProvider();

const statePath = () => join(config.installPath, '.zydock-update.json');

const logPath = () => join(config.installPath, '.zydock-update.log');

const containerName = (runId: string) => `zydock-updater-${runId}`;

const envValue = (contents: string, key: string) => {
  const line = contents.split('\n').find(entry => entry.startsWith(`${key}=`));

  if (!line) {
    return '';
  }

  return line
    .slice(key.length + 1)
    .trim()
    .replace(/^"(.*)"$/, '$1');
};

const readInstalledEnv = async () => {
  const file = Bun.file(join(config.installPath, '.env'));

  if (!(await file.exists())) {
    return { commit: '', channel: '' };
  }

  const contents = await file.text();

  return {
    commit: envValue(contents, 'ZYDOCK_COMMIT'),
    channel: envValue(contents, 'ZYDOCK_CHANNEL'),
  };
};

export const installIssue = async () => {
  const required = ['docker-compose.prod.yml', 'scripts/update.sh', 'scripts/update-runner.sh'];

  for (const entry of required) {
    if (!(await Bun.file(join(config.installPath, entry)).exists())) {
      return `${config.installPath} does not look like a Zydock install: ${entry} is missing`;
    }
  }

  if (!(await Bun.file(join(config.installPath, '.env')).exists())) {
    return `${config.installPath}/.env is missing — the stack would come back up with new secrets`;
  }

  return undefined;
};

const writeState = async (state: UpdateRunState) => {
  await Bun.write(statePath(), `${JSON.stringify(state, null, 2)}\n`);

  return state;
};

const readState = async (): Promise<UpdateRunState | null> => {
  const file = Bun.file(statePath());

  if (!(await file.exists())) {
    return null;
  }

  try {
    return updateRunStateSchema.parse(await file.json());
  } catch (error) {
    logWarn('The update state file could not be read', { error: errorMessage(error) });

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

const reconcile = async (state: UpdateRunState) => {
  if (state.status !== 'running' || (await isContainerRunning(state.id))) {
    return state;
  }

  logWarn('The update run vanished before reporting an outcome', { runId: state.id });

  return writeState({
    ...state,
    status: 'unknown' satisfies UpdateRunStatus,
    finishedAt: new Date().toISOString(),
    error: 'The updater container is gone and never reported an outcome',
  });
};

export const readUpdateRun = async (runId?: string) => {
  const stored = await readState();

  if (!stored || (runId && stored.id !== runId)) {
    return null;
  }

  const state = await reconcile(stored);

  return { ...state, log: await readLogTail() };
};

export const startUpdateRun = async (payload: StartUpdateDTO) => {
  const issue = await installIssue();

  if (issue) {
    throw new Error(issue);
  }

  const previous = await readState();

  if (previous && previous.status === 'running' && (await isContainerRunning(previous.id))) {
    throw new Error(`Update ${previous.id} is already running`);
  }

  if (previous) {
    await discardContainer(previous.id);
  }

  const installed = await readInstalledEnv();
  const id = randomUUID();

  const state = await writeState({
    id,
    status: 'running',
    from: installed.commit,
    to: payload.ref ?? '',
    channel: payload.channel ?? installed.channel,
    installPath: config.installPath,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    error: '',
    exitCode: 0,
  });

  const environment: Record<string, string> = {
    ZYDOCK_INSTALL_DIR: config.installPath,
    ZYDOCK_RUN_ID: id,
    ZYDOCK_RUN_FROM: state.from,
    ZYDOCK_RUN_TARGET: state.to,
    ZYDOCK_RUN_CHANNEL: state.channel,
    ZYDOCK_RUN_STARTED_AT: state.startedAt,
    ZYDOCK_FORCE: payload.force ? 'true' : 'false',
  };

  if (payload.channel) {
    environment.ZYDOCK_CHANNEL = payload.channel;
  }

  if (payload.branch) {
    environment.ZYDOCK_BRANCH = payload.branch;
  }

  if (payload.ref) {
    environment.ZYDOCK_REF = payload.ref;
  }

  try {
    const container = await containers.createContainer({
      name: containerName(id),
      image: config.updaterImage,
      command: ['sh', join(config.installPath, 'scripts/update-runner.sh')],
      environment,
      volumes: [
        { source: config.dockerSocketPath, target: '/var/run/docker.sock' },
        { source: config.installPath, target: config.installPath },
      ],
      labels: { 'zydock.role': 'updater', 'zydock.update.run': id },
      restartPolicy: 'no',
    });

    await containers.startContainer(container.id);
  } catch (error) {
    await writeState({
      ...state,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `The updater container could not start: ${errorMessage(error)}`,
      exitCode: 1,
    });

    throw error;
  }

  logInfo('Update run started', { runId: id, channel: state.channel, ref: state.to });

  return state;
};
