import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../src/app-server';
import config from '../../src/config';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import notificationChannelModel from '../../src/modules/notifications/notification-channel.model';
import notificationModel from '../../src/modules/notifications/notification.model';
import jobModel from '../../src/modules/queue/job.model';
import { stopWorker } from '../../src/modules/queue/queue.service';
import { ensureLocalServer } from '../../src/modules/servers/local-server.service';
import serverModel from '../../src/modules/servers/server.model';
import updateModel from '../../src/modules/updates/update.model';
import {
  nextCheckAt,
  reconcileUpdateRun,
  runScheduledUpdateCheck,
  scheduleUpdateCheck,
  UPDATE_CHECK_JOB,
} from '../../src/modules/updates/update.service';
import userModel from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/modules/users/user.service';

type UpdateStatus = {
  channel: string;
  branch: string;
  auto: boolean;
  frequency: string;
  installed: { version: string; commit: string; channel: string };
  remote: { ref: string; version: string; commit: string };
  updateAvailable: boolean;
  nextCheckAt?: string;
  lastRunId?: string;
  lastCheckedAt?: string;
  lastCheckSource?: string;
  lastCheckError?: string;
};

type UpdateRun = {
  id: string;
  status: string;
  from: string;
  to: string;
  channel: string;
  error: string;
  exitCode: number;
  log: string;
  rollbackCommand: string;
};

const LATEST_TAG = 'v0.1.0';
const REMOTE_COMMIT = '2222222222222222222222222222222222222222';

const password = 'updates-secret-1';
const superuserEmail = config.auth.superusers[0]!;
const memberEmail = `updates-member-${Date.now()}@zydock.test`;

let app: ReturnType<typeof createApp>;
let superuserToken = '';
let memberToken = '';

const json = (path: string, method: string, body?: unknown, token?: string) =>
  app.request(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const signIn = async (email: string) => {
  const response = await json('/auth/signin', 'POST', { email, password });
  const body = (await response.json()) as { accessToken: string };

  return body.accessToken;
};

const withFetch = async <T>(
  respond: (url: string, init?: RequestInit) => Response,
  run: () => T | Promise<T>,
): Promise<Awaited<T>> => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    respond(String(input), init)) as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const githubOk = (url: string) => {
  if (url.endsWith('/releases/latest')) {
    return new Response(JSON.stringify({ tag_name: LATEST_TAG }), { status: 200 });
  }

  if (url.includes('/commits/')) {
    return new Response(JSON.stringify({ sha: REMOTE_COMMIT }), { status: 200 });
  }

  return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
};

const githubRateLimited = () =>
  new Response(JSON.stringify({ message: 'API rate limit exceeded for 10.0.0.1.' }), {
    status: 403,
  });

const readStatus = async (token: string) => {
  const response = await json('/updates/status', 'GET', undefined, token);

  return { status: response.status, body: (await response.json()) as UpdateStatus };
};

beforeAll(async () => {
  await connectDatabase();
  await ensureLocalServer();

  const hashed = await hashPassword(password);

  await userModel.findOneAndUpdate(
    { email: superuserEmail },
    {
      $set: {
        name: 'updates-superuser',
        status: 'active',
        password: hashed,
        provisionedBySeed: true,
      },
    },
    { upsert: true },
  );

  await userModel.create({
    email: memberEmail,
    name: 'updates-member',
    status: 'active',
    password: hashed,
  });

  app = createApp();

  superuserToken = await signIn(superuserEmail);
  memberToken = await signIn(memberEmail);
});

afterAll(async () => {
  stopWorker();
  await jobModel.deleteMany({ type: UPDATE_CHECK_JOB });
  await serverModel.deleteMany({ type: 'local' });
  await updateModel.deleteMany({});
  await userModel.deleteMany({ email: { $in: [superuserEmail, memberEmail] } });
  await disconnectDatabase();
});

describe('updates — preferences and check', () => {
  test('the status without a token is 401', async () => {
    const response = await json('/updates/status', 'GET');

    expect(response.status).toBe(401);
  });

  test('the status for a non-superuser is 403', async () => {
    const response = await json('/updates/status', 'GET', undefined, memberToken);

    expect(response.status).toBe(403);
  });

  test('the singleton starts on the installed channel, with auto off and nothing checked', async () => {
    const { status, body } = await readStatus(superuserToken);

    expect(status).toBe(200);
    expect(body.channel).toBe('dev');
    expect(body.auto).toBe(false);
    expect(body.frequency).toBe('daily');
    expect(body.installed.commit).toBe(config.commit);
    expect(body.remote.commit).toBe('');
    expect(body.updateAvailable).toBe(false);
    expect(body.lastCheckedAt).toBeUndefined();
  });

  test('a rate limited check answers 502 and never reports the installation as up to date', async () => {
    const response = await withFetch(githubRateLimited, () =>
      json('/updates/check', 'POST', undefined, superuserToken),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain('rate limit');

    const { body: status } = await readStatus(superuserToken);

    expect(status.updateAvailable).toBe(false);
    expect(status.remote.commit).toBe('');
    expect(status.lastCheckedAt).toBeUndefined();
    expect(status.lastCheckError).toContain('rate limit');
  });

  test('a check stores the head of the branch of the channel and reports the update', async () => {
    const response = await withFetch(githubOk, () =>
      json('/updates/check', 'POST', undefined, superuserToken),
    );
    const body = (await response.json()) as UpdateStatus;

    expect(response.status).toBe(200);
    expect(body.remote.ref).toBe('dev');
    expect(body.remote.commit).toBe(REMOTE_COMMIT);
    expect(body.updateAvailable).toBe(true);
    expect(body.lastCheckSource).toBe('manual');
    expect(body.lastCheckError).toBeUndefined();
  });

  test('the status answers from the stored state, without calling GitHub', async () => {
    const { body } = await withFetch(
      () => {
        throw new Error('the status must not call GitHub');
      },
      () => readStatus(superuserToken),
    );

    expect(body.remote.commit).toBe(REMOTE_COMMIT);
    expect(body.updateAvailable).toBe(true);
  });

  test('the branch channel requires a branch', async () => {
    const response = await json(
      '/updates/settings',
      'PATCH',
      { channel: 'branch' },
      superuserToken,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('branch is required');
  });

  test('an unknown frequency is rejected', async () => {
    const response = await json(
      '/updates/settings',
      'PATCH',
      { frequency: 'monthly' },
      superuserToken,
    );

    expect(response.status).toBe(400);
  });

  test('changing the channel discards the head of the previous channel', async () => {
    const response = await json(
      '/updates/settings',
      'PATCH',
      { channel: 'stable', auto: true, frequency: 'weekly' },
      superuserToken,
    );

    expect(response.status).toBe(200);

    const { body } = await readStatus(superuserToken);

    expect(body.channel).toBe('stable');
    expect(body.auto).toBe(true);
    expect(body.frequency).toBe('weekly');
    expect(body.remote.commit).toBe('');
    expect(body.updateAvailable).toBe(false);
    expect(body.lastCheckedAt).toBeUndefined();
  });

  test('on the stable channel the head comes from the latest release', async () => {
    const response = await withFetch(githubOk, () =>
      json('/updates/check', 'POST', undefined, superuserToken),
    );
    const body = (await response.json()) as UpdateStatus;

    expect(response.status).toBe(200);
    expect(body.remote.ref).toBe(LATEST_TAG);
    expect(body.remote.version).toBe(LATEST_TAG);
    expect(body.remote.commit).toBe(REMOTE_COMMIT);
    expect(body.updateAvailable).toBe(true);
  });

  test('a tracked branch is stored and becomes the resolved ref', async () => {
    const response = await json(
      '/updates/settings',
      'PATCH',
      { channel: 'branch', branch: 'feat/updater' },
      superuserToken,
    );
    const body = (await response.json()) as { channel: string; branch: string };

    expect(response.status).toBe(200);
    expect(body.channel).toBe('branch');
    expect(body.branch).toBe('feat/updater');

    const { body: status } = await readStatus(superuserToken);

    expect(status.remote.ref).toBe('feat/updater');
  });
});

const RUN_ID = '11111111-2222-3333-4444-555555555555';
const INSTALL_PATH = '/data/zydock';
const INSTALLED_COMMIT = '1111111111111111111111111111111111111111';

const dispatchedRun = {
  id: RUN_ID,
  status: 'running',
  from: INSTALLED_COMMIT,
  to: '',
  channel: 'dev',
  installPath: INSTALL_PATH,
  startedAt: '2026-08-06T03:00:00.000Z',
  finishedAt: '',
  error: '',
  exitCode: 0,
};

describe('updates — running the update', () => {
  let dispatched: { channel?: string; branch?: string; force?: boolean } | undefined;

  const agentOk = (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/updates/runs') && init?.method === 'POST') {
      dispatched = JSON.parse(String(init.body)) as typeof dispatched;

      return new Response(JSON.stringify(dispatchedRun), { status: 202 });
    }

    if (url.endsWith(`/api/updates/runs/${RUN_ID}`)) {
      return new Response(
        JSON.stringify({
          ...dispatchedRun,
          status: 'success',
          to: REMOTE_COMMIT,
          finishedAt: '2026-08-06T03:04:00.000Z',
          log: '▸ Rebuilding and restarting the stack\nDone',
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ error: 'Update run not found' }), { status: 404 });
  };

  const agentDown = () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:9000');
  };

  test('starting an update as a non-superuser is 403', async () => {
    const response = await withFetch(
      () => {
        throw new Error('the agent must not be called');
      },
      () => json('/updates/run', 'POST', {}, memberToken),
    );

    expect(response.status).toBe(403);
  });

  test('the run is dispatched to the agent, answered with 202 and stored on the singleton', async () => {
    const response = await withFetch(agentOk, () =>
      json('/updates/run', 'POST', { force: true }, superuserToken),
    );
    const body = (await response.json()) as UpdateRun;

    expect(response.status).toBe(202);
    expect(body.id).toBe(RUN_ID);
    expect(body.status).toBe('running');
    expect(dispatched).toEqual({ channel: 'feat/updater', branch: 'feat/updater', force: true });
    expect(body.rollbackCommand).toBe(
      `ZYDOCK_REF=${INSTALLED_COMMIT} bash ${INSTALL_PATH}/scripts/update.sh`,
    );

    const { body: status } = await readStatus(superuserToken);

    expect(status.lastRunId).toBe(RUN_ID);
  });

  test('the run is read back from the agent, with the tail of its log', async () => {
    const response = await withFetch(agentOk, () =>
      json(`/updates/runs/${RUN_ID}`, 'GET', undefined, superuserToken),
    );
    const body = (await response.json()) as UpdateRun;

    expect(response.status).toBe(200);
    expect(body.status).toBe('success');
    expect(body.to).toBe(REMOTE_COMMIT);
    expect(body.log).toContain('Rebuilding');
    expect(body.rollbackCommand).toContain(INSTALLED_COMMIT);
  });

  test('a run the agent does not know is 404', async () => {
    const response = await withFetch(agentOk, () =>
      json('/updates/runs/does-not-exist', 'GET', undefined, superuserToken),
    );

    expect(response.status).toBe(404);
  });

  test('an unreachable agent is 502, never a silent success', async () => {
    const response = await withFetch(agentDown, () =>
      json('/updates/run', 'POST', {}, superuserToken),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain('did not answer');
  });
});

describe('updates — automatic check', () => {
  const organizationId = '6a754c264667d76950ca8516';

  let channelId = '';

  const notificationsOf = (event: string) => notificationModel.find({ channelId, event });

  const pendingChecks = () => jobModel.find({ type: UPDATE_CHECK_JOB, status: 'pending' });

  const selectChannel = (channel: string, auto: boolean) =>
    updateModel.updateOne(
      {},
      {
        $set: { channel, branch: '', auto, frequency: 'daily' },
        $unset: { remoteCommit: '', remoteVersion: '', lastNotifiedCommit: '' },
      },
    );

  const finishedRun = (url: string) => {
    if (url.endsWith(`/api/updates/runs/${RUN_ID}`)) {
      return new Response(
        JSON.stringify({
          ...dispatchedRun,
          status: 'success',
          to: REMOTE_COMMIT,
          finishedAt: '2026-08-06T03:04:00.000Z',
          log: 'Done',
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ error: 'Update run not found' }), { status: 404 });
  };

  beforeAll(async () => {
    const channel = await notificationChannelModel.create({
      organizationId,
      name: 'updates-test',
      channel: 'webhook',
      address: 'https://example.test/updates',
      hasSecret: false,
      events: ['update.available', 'update.succeeded', 'update.failed'],
      enabled: true,
    });

    channelId = String(channel._id);
  });

  afterAll(async () => {
    await notificationModel.deleteMany({ channelId });
    await notificationChannelModel.deleteMany({ _id: channelId });
  });

  test('the next check falls inside the 03:00–05:00 window of the installation', () => {
    const from = new Date('2026-08-07T12:00:00');

    const daily = nextCheckAt('daily', 42, from);

    expect(daily.getHours()).toBe(3);
    expect(daily.getMinutes()).toBe(42);
    expect(daily.getTime()).toBeGreaterThan(from.getTime());

    const lastMinuteOfTheWindow = nextCheckAt('daily', 119, from);

    expect(lastMinuteOfTheWindow.getHours()).toBe(4);
    expect(lastMinuteOfTheWindow.getMinutes()).toBe(59);

    const weekly = nextCheckAt('weekly', 10, from);

    expect(weekly.getDay()).toBe(0);
    expect(weekly.getHours()).toBe(3);

    const hourly = nextCheckAt('hourly', 75, from);

    expect(hourly.getMinutes()).toBe(15);
    expect(hourly.getTime() - from.getTime()).toBeLessThanOrEqual(3_600_000);
  });

  test('scheduling leaves a single pending job, published in the status', async () => {
    await updateModel.updateOne({}, { $set: { frequency: 'daily', checkMinute: 30 } });

    await scheduleUpdateCheck();
    await scheduleUpdateCheck();

    const jobs = await pendingChecks();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.runAt.getMinutes()).toBe(30);

    const { body } = await readStatus(superuserToken);

    expect(body.nextCheckAt).toBe(jobs[0]!.runAt.toISOString());
  });

  test('changing the frequency reschedules the pending check', async () => {
    const response = await json(
      '/updates/settings',
      'PATCH',
      { frequency: 'hourly' },
      superuserToken,
    );

    expect(response.status).toBe(200);

    const jobs = await pendingChecks();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.runAt.getMinutes()).toBe(30);
    expect(jobs[0]!.runAt.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);

    const { body } = await readStatus(superuserToken);

    expect(body.nextCheckAt).toBe(jobs[0]!.runAt.toISOString());
  });

  test('with auto off the check announces the update once and starts nothing', async () => {
    await selectChannel('dev', false);

    await withFetch(githubOk, runScheduledUpdateCheck);

    const announced = await notificationsOf('update.available');

    expect(announced).toHaveLength(1);
    expect(announced[0]!.body).toContain('dev');
    expect(announced[0]!.body).toContain(REMOTE_COMMIT.slice(0, 7));

    await withFetch(githubOk, runScheduledUpdateCheck);

    expect(await notificationsOf('update.available')).toHaveLength(1);
  });

  test('outside stable, auto only announces — it never updates by itself', async () => {
    await selectChannel('nightly', true);

    await withFetch(url => {
      if (url.includes('/api/updates/runs')) {
        throw new Error('the agent must not be called outside the stable channel');
      }

      return githubOk(url);
    }, runScheduledUpdateCheck);

    expect(await notificationsOf('update.available')).toHaveLength(2);

    const { body } = await readStatus(superuserToken);

    expect(body.auto).toBe(true);
    expect(body.updateAvailable).toBe(true);
  });

  test('with auto on and the stable channel the update starts by itself', async () => {
    await selectChannel('stable', true);

    let dispatched = false;

    await withFetch((url, init) => {
      if (url.endsWith('/api/updates/runs') && init?.method === 'POST') {
        dispatched = true;

        return new Response(JSON.stringify(dispatchedRun), { status: 202 });
      }

      return githubOk(url);
    }, runScheduledUpdateCheck);

    expect(dispatched).toBe(true);
    expect(await notificationsOf('update.available')).toHaveLength(2);

    const { body } = await readStatus(superuserToken);

    expect(body.lastRunId).toBe(RUN_ID);
  });

  test('a check that could not reach GitHub announces nothing', async () => {
    await selectChannel('dev', false);

    await withFetch(githubRateLimited, runScheduledUpdateCheck);

    expect(await notificationsOf('update.available')).toHaveLength(2);
  });

  test('the outcome of the last run is announced once, on the way back', async () => {
    await updateModel.updateOne(
      {},
      { $set: { lastRunId: RUN_ID }, $unset: { lastNotifiedRunId: '' } },
    );

    await withFetch(finishedRun, reconcileUpdateRun);

    const announced = await notificationsOf('update.succeeded');

    expect(announced).toHaveLength(1);
    expect(announced[0]!.body).toContain(REMOTE_COMMIT.slice(0, 7));
    expect(announced[0]!.metadata.run).toBe(RUN_ID);

    await withFetch(finishedRun, reconcileUpdateRun);

    expect(await notificationsOf('update.succeeded')).toHaveLength(1);
  });
});
