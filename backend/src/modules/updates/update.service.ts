import config from '../../config';
import { resolveGitReleasesProvider } from '../../providers/git';
import {
  resolveUpdaterProvider,
  type UpdateRun,
  type UpdateRunDetail,
} from '../../providers/updater';
import { logInfo, logWarn } from '../../utils/logger';
import { emitSystemNotification } from '../notifications/notification.service';
import { cancelPendingJobs, enqueueJob, registerJobHandler } from '../queue/queue.service';
import { getLocalServerId } from '../servers/local-server.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import updateModel from './update.model';
import {
  CHECK_WINDOW_START_HOUR,
  UPDATE_CHANNELS,
  type UpdateChannel,
  type UpdateCheckSource,
  type UpdateFrequency,
  type UpdateRunDTO,
  type UpdateSettingsDTO,
} from './update.schema';

export const UPDATE_CHECK_JOB = 'update.check';

const isUpdateChannel = (value: string): value is UpdateChannel =>
  UPDATE_CHANNELS.some(channel => channel === value);

const installedSelection = () => {
  const installed = config.channel.trim();

  if (!installed) {
    return { channel: 'stable' as UpdateChannel, branch: '' };
  }

  if (isUpdateChannel(installed) && installed !== 'branch') {
    return { channel: installed, branch: '' };
  }

  return { channel: 'branch' as UpdateChannel, branch: installed };
};

export const channelBranch = (channel: UpdateChannel, branch: string) => {
  if (channel === 'stable') {
    return 'main';
  }

  if (channel === 'branch') {
    return branch;
  }

  return channel;
};

export const getUpdateDocument = async () => {
  const document = await updateModel.findOneAndUpdate(
    {},
    { $setOnInsert: installedSelection() },
    { upsert: true, new: true },
  );

  return document!;
};

export const saveUpdateSettings = async (payload: UpdateSettingsDTO) => {
  const current = await getUpdateDocument();

  const channel = payload.channel ?? current.channel;
  const branch = payload.branch ?? current.branch;

  const selectionChanged = channel !== current.channel || branch !== current.branch;

  await updateModel.updateOne(
    { _id: current._id },
    {
      $set: {
        channel,
        branch,
        auto: payload.auto ?? current.auto,
        frequency: payload.frequency ?? current.frequency,
      },
      ...(selectionChanged
        ? {
            $unset: {
              remoteVersion: '',
              remoteCommit: '',
              lastCheckedAt: '',
              lastCheckSource: '',
              lastCheckError: '',
            },
          }
        : {}),
    },
  );

  const saved = await getUpdateDocument();

  if (saved.frequency !== current.frequency) {
    await scheduleUpdateCheck(saved);

    return getUpdateDocument();
  }

  return saved;
};

export const checkForUpdates = async (source: UpdateCheckSource) => {
  const current = await getUpdateDocument();
  const provider = resolveGitReleasesProvider({ repository: config.updates.repository });

  try {
    const head =
      current.channel === 'stable'
        ? await provider.resolveLatestRelease()
        : await provider.resolveBranchHead(channelBranch(current.channel, current.branch));

    await updateModel.updateOne(
      { _id: current._id },
      {
        $set: {
          remoteVersion: head.version,
          remoteCommit: head.commit,
          lastCheckedAt: new Date(),
          lastCheckSource: source,
        },
        $unset: { lastCheckError: '' },
      },
    );

    return { checked: true as const, document: await getUpdateDocument() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    logWarn('Update check failed', { channel: current.channel, source, error: reason });

    await updateModel.updateOne({ _id: current._id }, { $set: { lastCheckError: reason } });

    return { checked: false as const, error: reason };
  }
};

const channelSelection = (document: Update) =>
  document.channel === 'branch' ? document.branch : document.channel;

const localUpdater = async () => {
  const serverId = getLocalServerId();

  if (!serverId) {
    throw new Error(
      'The local server is not registered, so this installation cannot update itself',
    );
  }

  const server = await findServerById(serverId);

  if (!server) {
    throw new Error('The local server was not found');
  }

  return resolveUpdaterProvider(buildAgentConnection(server));
};

export const startUpdateRun = async (payload: UpdateRunDTO) => {
  const document = await getUpdateDocument();
  const updater = await localUpdater();

  const run = await updater.startRun({
    channel: channelSelection(document),
    branch: document.channel === 'branch' ? document.branch : undefined,
    force: payload.force,
  });

  await updateModel.updateOne({ _id: document._id }, { $set: { lastRunId: run.id } });

  logInfo('Update run dispatched', { runId: run.id, channel: run.channel });

  return run;
};

export const getUpdateRun = async (runId: string) => (await localUpdater()).getRun(runId);

export const nextCheckAt = (
  frequency: UpdateFrequency,
  checkMinute: number,
  from: Date = new Date(),
) => {
  const next = new Date(from);

  if (frequency === 'hourly') {
    next.setMinutes(checkMinute % 60, 0, 0);

    if (next <= from) {
      next.setHours(next.getHours() + 1);
    }

    return next;
  }

  next.setHours(CHECK_WINDOW_START_HOUR, checkMinute, 0, 0);

  while (next <= from || (frequency === 'weekly' && next.getDay() !== 0)) {
    next.setDate(next.getDate() + 1);
  }

  return next;
};

export const scheduleUpdateCheck = async (document?: Update) => {
  const current = document ?? (await getUpdateDocument());
  const runAt = nextCheckAt(current.frequency, current.checkMinute);

  await cancelPendingJobs(UPDATE_CHECK_JOB);
  await enqueueJob(UPDATE_CHECK_JOB, {}, { maxAttempts: 1, runAt });
  await updateModel.updateOne({ _id: current._id }, { $set: { nextCheckAt: runAt } });

  logInfo('Update check scheduled', { frequency: current.frequency, runAt });

  return runAt;
};

const installedLabel = () => config.version || config.commit.slice(0, 7) || 'an unknown version';

const remoteLabel = (document: Update) =>
  document.remoteVersion || (document.remoteCommit ?? '').slice(0, 7) || 'a newer commit';

const shouldUpdateAutomatically = (document: Update) =>
  document.auto && document.channel === 'stable' && isUpdateAvailable(document);

const announceAvailableUpdate = async (document: Update) => {
  if (!isUpdateAvailable(document) || document.lastNotifiedCommit === document.remoteCommit) {
    return;
  }

  const selection = channelSelection(document);

  await emitSystemNotification('update.available', {
    subject: `Update available — ${remoteLabel(document)}`,
    body:
      `The ${selection} channel is at ${remoteLabel(document)} and this installation is running ` +
      `${installedLabel()}. It was not installed automatically, so start it from Settings › ` +
      'Updates when it suits you.',
    metadata: {
      channel: selection,
      installedVersion: config.version,
      installedCommit: config.commit,
      remoteVersion: document.remoteVersion ?? '',
      remoteCommit: document.remoteCommit ?? '',
    },
  });

  await updateModel.updateOne(
    { _id: document._id },
    { $set: { lastNotifiedCommit: document.remoteCommit } },
  );
};

export const runScheduledUpdateCheck = async () => {
  const result = await checkForUpdates('automatic');

  if (!result.checked) {
    return;
  }

  if (!shouldUpdateAutomatically(result.document)) {
    await announceAvailableUpdate(result.document);

    return;
  }

  logInfo('Automatic update starting', {
    channel: result.document.channel,
    remoteCommit: result.document.remoteCommit,
  });

  await startUpdateRun({});
};

registerJobHandler(UPDATE_CHECK_JOB, async () => {
  try {
    await runScheduledUpdateCheck();
  } finally {
    await scheduleUpdateCheck();
  }
});

const bodyOfFinishedRun = (run: UpdateRun) => {
  if (run.status === 'success') {
    return `This installation was updated to ${run.to.slice(0, 7)} on the ${run.channel} channel.`;
  }

  if (run.status === 'failed') {
    return `The update to the ${run.channel} channel failed: ${run.error || 'no reason was recorded'}.`;
  }

  return (
    `The update to the ${run.channel} channel left no outcome behind: the updater container is ` +
    'gone and its state was never finished. Check the installation before trusting it.'
  );
};

const announceFinishedRun = async (document: Update, run: UpdateRun) => {
  if (run.status === 'running' || document.lastNotifiedRunId === run.id) {
    return;
  }

  const succeeded = run.status === 'success';
  const body = bodyOfFinishedRun(run);

  await emitSystemNotification(succeeded ? 'update.succeeded' : 'update.failed', {
    subject: succeeded ? `Update succeeded — ${installedLabel()}` : 'Update failed',
    body: `${body}${succeeded ? '' : ` Roll back with: ${rollbackCommand(run)}`}`,
    metadata: {
      run: run.id,
      status: run.status,
      channel: run.channel,
      from: run.from,
      to: run.to,
      exitCode: String(run.exitCode),
      error: run.error,
    },
  });

  await updateModel.updateOne({ _id: document._id }, { $set: { lastNotifiedRunId: run.id } });
};

export const reconcileUpdateRun = async () => {
  const document = await getUpdateDocument();

  if (!document.lastRunId) {
    return;
  }

  try {
    const run = await getUpdateRun(document.lastRunId);

    if (!run) {
      logWarn('The last update run left no state behind', { runId: document.lastRunId });

      return;
    }

    logInfo('Last update run reconciled', {
      runId: run.id,
      status: run.status,
      from: run.from,
      to: run.to,
      error: run.error || undefined,
    });

    await announceFinishedRun(document, run);
  } catch (error) {
    logWarn('The last update run could not be reconciled', {
      runId: document.lastRunId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const bootstrapUpdates = async () => {
  try {
    await reconcileUpdateRun();
    await scheduleUpdateCheck();
  } catch (error) {
    logWarn('The update module could not be bootstrapped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const rollbackCommand = (run: UpdateRun) =>
  run.from && run.installPath
    ? `ZYDOCK_REF=${run.from} bash ${run.installPath}/scripts/update.sh`
    : '';

export const serializeUpdateRun = (run: UpdateRun | UpdateRunDetail) => ({
  id: run.id,
  status: run.status,
  from: run.from,
  to: run.to,
  channel: run.channel,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  error: run.error,
  exitCode: run.exitCode,
  log: 'log' in run ? run.log : '',
  rollbackCommand: rollbackCommand(run),
});

export const isUpdateAvailable = (document: Update) =>
  Boolean(document.remoteCommit) &&
  Boolean(config.commit) &&
  document.remoteCommit !== config.commit;

export const serializeUpdateSettings = (document: Update) => ({
  channel: document.channel,
  branch: document.branch,
  auto: document.auto,
  frequency: document.frequency,
});

export const serializeUpdateStatus = (document: Update) => ({
  ...serializeUpdateSettings(document),
  installed: {
    version: config.version,
    commit: config.commit,
    channel: config.channel,
  },
  remote: {
    ref:
      document.channel === 'stable'
        ? (document.remoteVersion ?? '')
        : channelBranch(document.channel, document.branch),
    version: document.remoteVersion ?? '',
    commit: document.remoteCommit ?? '',
  },
  updateAvailable: isUpdateAvailable(document),
  nextCheckAt: document.nextCheckAt,
  lastRunId: document.lastRunId,
  lastCheckedAt: document.lastCheckedAt,
  lastCheckSource: document.lastCheckSource,
  lastCheckError: document.lastCheckError,
});
