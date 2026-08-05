import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { createApp } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import applicationModel from '../../src/modules/applications/application.model';
import gitSourceModel from '../../src/modules/git-sources/git-source.model';
import { stopWorker } from '../../src/modules/queue/queue.service';
import config from '../../src/config';
import { encryptSecret } from '../../src/utils/crypto';
import {
  ensureLocalServer,
  getLocalServerId,
} from '../../src/modules/servers/local-server.service';
import serverModel from '../../src/modules/servers/server.model';
import membershipModel from '../../src/modules/organizations/membership.model';
import organizationModel from '../../src/modules/organizations/organization.model';
import { seedDefaultOrganization } from '../../src/seeds/organization.seed';
import userModel from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/modules/users/user.service';

let app: ReturnType<typeof createApp>;

const email = `it-${Date.now()}@zydock.test`;
const password = 'integration-secret-1';
let accessToken = '';

const json = (path: string, method: string, body?: unknown, token?: string) =>
  app.request(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  await connectDatabase();
  await ensureLocalServer();
  app = createApp();
});

afterAll(async () => {
  stopWorker();
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
});

describe('health', () => {
  test('GET /api/health is public and ok', async () => {
    const response = await app.request('/api/health');
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });
});

describe('auth', () => {
  test('signup creates a user and returns tokens (201)', async () => {
    const response = await json('/auth/signup', 'POST', { name: 'IT', email, password });
    const body = (await response.json()) as { accessToken: string; user: { email: string } };

    expect(response.status).toBe(201);
    expect(body.accessToken).toBeString();
    expect(body.user.email).toBe(email);

    accessToken = body.accessToken;
  });

  test('a duplicate email is rejected (409)', async () => {
    const response = await json('/auth/signup', 'POST', { name: 'Dup', email, password });

    expect(response.status).toBe(409);
  });

  test('signin with wrong password is 401 with the API message', async () => {
    const response = await json('/auth/signin', 'POST', { email, password: 'wrong' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Invalid credentials');
  });

  test('refresh rotates the session', async () => {
    const signin = await json('/auth/signin', 'POST', { email, password });
    const { refreshToken } = (await signin.json()) as { refreshToken: string };

    const response = await json('/auth/refresh', 'POST', { refreshToken });
    const body = (await response.json()) as { accessToken: string; refreshToken: string };

    expect(response.status).toBe(200);
    expect(body.accessToken).toBeString();
    expect(body.refreshToken).not.toBe(refreshToken);
  });
});

describe('authorization', () => {
  test('a protected route without a token is 401', async () => {
    const response = await app.request('/api/organizations');

    expect(response.status).toBe(401);
  });
});

describe('organizations', () => {
  let organizationId = '';

  test('create returns 201 and the creator is owner', async () => {
    const response = await json('/organizations', 'POST', { name: 'Acme IT' }, accessToken);
    const body = (await response.json()) as { organization: { id: string; role: string } };

    expect(response.status).toBe(201);
    expect(body.organization.role).toBe('owner');

    organizationId = body.organization.id;
  });

  test('list includes the new organization', async () => {
    const response = await json('/organizations', 'GET', undefined, accessToken);
    const body = (await response.json()) as { items: { id: string }[] };

    expect(response.status).toBe(200);
    expect(body.items.some(item => item.id === organizationId)).toBeTrue();
  });

  test('get by id returns it for a member', async () => {
    const response = await json(`/organizations/${organizationId}`, 'GET', undefined, accessToken);
    const body = (await response.json()) as { organization: { name: string } };

    expect(response.status).toBe(200);
    expect(body.organization.name).toBe('Acme IT');
  });

  test('the owner is listed as a member', async () => {
    const response = await json(
      `/organizations/${organizationId}/members`,
      'GET',
      undefined,
      accessToken,
    );
    const body = (await response.json()) as { items: { email: string; role: string }[] };

    expect(body.items.some(member => member.email === email && member.role === 'owner')).toBeTrue();
  });
});

describe('servers (local)', () => {
  let organizationId = '';
  const localServerId = () => getLocalServerId()!;

  test('the local server is bootstrapped and its id is known', () => {
    expect(getLocalServerId()).toBeString();
  });

  test('GET /api/agent/identity resolves the local server id with the right token', async () => {
    const response = await app.request('/api/agent/identity', {
      headers: { 'X-Agent-Token': 'test-local-agent-token' },
    });
    const body = (await response.json()) as { serverId: string };

    expect(response.status).toBe(200);
    expect(body.serverId).toBe(localServerId());
  });

  test('GET /api/agent/identity rejects a wrong token (401)', async () => {
    const response = await app.request('/api/agent/identity', {
      headers: { 'X-Agent-Token': 'nope' },
    });

    expect(response.status).toBe(401);
  });

  test('it appears in the server list of any organization', async () => {
    const org = await json('/organizations', 'POST', { name: 'Local Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const response = await json(
      `/organizations/${organizationId}/servers`,
      'GET',
      undefined,
      accessToken,
    );
    const body = (await response.json()) as {
      items: { id: string; type: string; managed: boolean; organizationId: string | null }[];
    };

    const server = body.items.find(item => item.id === localServerId());

    expect(server?.type).toBe('local');
    expect(server?.managed).toBeTrue();
    expect(server?.organizationId).toBeNull();
  });

  test('POST /servers no longer accepts type: "local" — ssh is required (400)', async () => {
    const response = await json(
      `/organizations/${organizationId}/servers`,
      'POST',
      { type: 'local', name: 'minha-máquina' },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('provisioning the local server is rejected (400)', async () => {
    const response = await json(
      `/organizations/${organizationId}/servers/${localServerId()}/provision`,
      'POST',
      undefined,
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('deleting the local server is rejected (400)', async () => {
    const response = await json(
      `/organizations/${organizationId}/servers/${localServerId()}`,
      'DELETE',
      undefined,
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('a heartbeat with its token brings it online', async () => {
    const response = await app.request(`/api/agent/heartbeat/${localServerId()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': 'test-local-agent-token' },
      body: JSON.stringify({ version: '1.0.0' }),
    });

    expect(response.status).toBe(200);

    const list = await json(
      `/organizations/${organizationId}/servers`,
      'GET',
      undefined,
      accessToken,
    );
    const body = (await list.json()) as { items: { id: string; status: string }[] };

    expect(body.items.find(item => item.id === localServerId())?.status).toBe('online');
  });

  test('a heartbeat with a wrong token is rejected (401)', async () => {
    const response = await app.request(`/api/agent/heartbeat/${localServerId()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': 'nope' },
      body: JSON.stringify({ version: '1.0.0' }),
    });

    expect(response.status).toBe(401);
  });
});

describe('applications (private repo token)', () => {
  let organizationId = '';
  let serverId = '';
  let environmentId = '';
  let applicationId = '';

  test('setup: org, local server, project and environment', async () => {
    const org = await json('/organizations', 'POST', { name: 'Apps Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    serverId = getLocalServerId()!;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'App Project' },
      accessToken,
    );
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      accessToken,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    expect(environmentId).toBeString();
  });

  test('create with a git token reports hasToken and never returns it', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        name: 'private-api',
        environmentId,
        serverId,
        port: 3000,
        portMappings: [{ hostPort: 8080, containerPort: 3000, protocol: 'tcp' }],
        git: { host: 'github', repository: 'acme/private-api', token: 'ghp_secret_value' },
      },
      accessToken,
    );
    const body = (await response.json()) as {
      application: {
        id: string;
        git: { hasToken: boolean; token?: string; source: string };
        portMappings: { hostPort: number; containerPort: number; protocol: string }[];
      };
    };

    expect(response.status).toBe(201);
    expect(body.application.git.hasToken).toBeTrue();
    expect(body.application.git.token).toBeUndefined();
    expect(body.application.git.source).toBe('pat');
    expect(body.application.portMappings).toEqual([
      { hostPort: 8080, containerPort: 3000, protocol: 'tcp' },
    ]);

    applicationId = body.application.id;
  });

  test('stopping without a reachable agent/container fails cleanly (400)', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}/stop`,
      'POST',
      undefined,
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('clearing the token with null flips hasToken to false', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}`,
      'PATCH',
      { git: { token: null } },
      accessToken,
    );
    const body = (await response.json()) as { application: { git: { hasToken: boolean } } };

    expect(response.status).toBe(200);
    expect(body.application.git.hasToken).toBeFalse();
  });

  test('update sets volumes, networks, healthcheck and resources', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}`,
      'PATCH',
      {
        volumes: [{ source: 'data', target: '/data' }],
        networks: ['extra-net'],
        healthcheck: { path: '/health', intervalSeconds: 10, timeoutSeconds: 3, retries: 5 },
        resources: { cpus: 0.5, memoryMb: 256 },
      },
      accessToken,
    );
    const body = (await response.json()) as {
      application: {
        volumes: { target: string }[];
        networks: string[];
        healthcheck?: { path: string; retries: number };
        resources?: { cpus?: number; memoryMb?: number };
      };
    };

    expect(response.status).toBe(200);
    expect(body.application.volumes[0]?.target).toBe('/data');
    expect(body.application.networks).toEqual(['extra-net']);
    expect(body.application.healthcheck?.path).toBe('/health');
    expect(body.application.healthcheck?.retries).toBe(5);
    expect(body.application.resources?.cpus).toBe(0.5);
    expect(body.application.resources?.memoryMb).toBe(256);
  });

  test('healthcheck: null removes it', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}`,
      'PATCH',
      { healthcheck: null },
      accessToken,
    );
    const body = (await response.json()) as { application: { healthcheck?: unknown } };

    expect(response.status).toBe(200);
    expect(body.application.healthcheck).toBeUndefined();
  });

  test('rollback to an unknown deployment is 404', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}/rollback`,
      'POST',
      { deploymentId: '0'.repeat(24) },
      accessToken,
    );

    expect(response.status).toBe(404);
  });

  test('rollback to a non-succeeded deployment is 400', async () => {
    const deploy = await json(
      `/organizations/${organizationId}/applications/${applicationId}/deploy`,
      'POST',
      {},
      accessToken,
    );
    const deploymentId = ((await deploy.json()) as { deployment: { id: string } }).deployment.id;

    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}/rollback`,
      'POST',
      { deploymentId },
      accessToken,
    );

    expect(response.status).toBe(400);
  });
});

describe('applications (github-app source)', () => {
  let organizationId = '';
  let serverId = '';
  let environmentId = '';
  let activeGitSourceId = '';

  test('setup: org, local server, project, environment and an active git source', async () => {
    const org = await json('/organizations', 'POST', { name: 'GitHub App Apps Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    serverId = getLocalServerId()!;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'GitHub App Project' },
      accessToken,
    );
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      accessToken,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    const owner = await userModel.findOne({ email });

    const gitSource = await gitSourceModel.create({
      organizationId,
      name: 'zydock-apps-test',
      status: 'active',
      appId: '123456',
      privateKey: encryptSecret('irrelevant-for-this-test'),
      createdBy: owner!._id,
    });

    activeGitSourceId = String(gitSource._id);
  });

  test('creating an application without a git source keeps defaulting to "pat"', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        name: 'default-pat',
        environmentId,
        serverId,
        port: 3001,
        git: { host: 'github', repository: 'acme/default-pat' },
      },
      accessToken,
    );
    const body = (await response.json()) as { application: { git: { source: string } } };

    expect(response.status).toBe(201);
    expect(body.application.git.source).toBe('pat');
  });

  test('source "github-app" with an unknown gitSourceId is 400', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        name: 'unknown-source',
        environmentId,
        serverId,
        port: 3002,
        git: {
          host: 'github',
          repository: 'acme/unknown-source',
          source: 'github-app',
          gitSourceId: '0'.repeat(24),
          installationId: '1',
        },
      },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('source "github-app" without installationId is 400', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        name: 'missing-installation',
        environmentId,
        serverId,
        port: 3003,
        git: {
          host: 'github',
          repository: 'acme/missing-installation',
          source: 'github-app',
          gitSourceId: activeGitSourceId,
        },
      },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('source "github-app" with a token set is 400', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        name: 'token-and-app',
        environmentId,
        serverId,
        port: 3004,
        git: {
          host: 'github',
          repository: 'acme/token-and-app',
          source: 'github-app',
          gitSourceId: activeGitSourceId,
          installationId: '1',
          token: 'should-not-be-allowed',
        },
      },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('POST /applications/:id/webhook on a github-app application is 400', async () => {
    const created = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        name: 'github-app-consumer',
        environmentId,
        serverId,
        port: 3005,
        git: {
          host: 'github',
          repository: 'acme/github-app-consumer',
          source: 'github-app',
          gitSourceId: activeGitSourceId,
          installationId: '1',
        },
      },
      accessToken,
    );
    const applicationId = ((await created.json()) as { application: { id: string } }).application
      .id;

    expect(created.status).toBe(201);

    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}/webhook`,
      'POST',
      undefined,
      accessToken,
    );

    expect(response.status).toBe(400);
  });
});

describe('git.source backward compatibility', () => {
  test('a document written before this task (no git.source) still reads as "pat"', async () => {
    const inserted = await applicationModel.collection.insertOne({
      organizationId: new mongoose.Types.ObjectId(),
      projectId: new mongoose.Types.ObjectId(),
      environmentId: new mongoose.Types.ObjectId(),
      serverId: new mongoose.Types.ObjectId(),
      name: 'legacy-app',
      slug: 'legacy-app',
      status: 'created',
      git: {
        host: 'github',
        repository: 'acme/legacy',
        branch: 'main',
        dockerfilePath: 'Dockerfile',
        buildContext: '.',
        autoDeploy: true,
        hasToken: false,
      },
      port: 3000,
      portMappings: [],
      variables: [],
      volumes: [],
      networks: [],
      restartPolicy: 'unless-stopped',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const found = await applicationModel.findById(inserted.insertedId);

    expect(found?.git.source).toBe('pat');
  });
});

describe('git sources (manifest registration)', () => {
  let organizationId = '';
  let serverId = '';
  let environmentId = '';
  let gitSourceId = '';
  let state = '';

  test('setup: org, local server, project and environment', async () => {
    const org = await json('/organizations', 'POST', { name: 'Git Sources Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    serverId = getLocalServerId()!;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Git Sources Project' },
      accessToken,
    );
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      accessToken,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    expect(environmentId).toBeString();
  });

  test('POST /manifest creates a pending source and points the hook at that id', async () => {
    const response = await json(
      `/organizations/${organizationId}/git-sources/manifest`,
      'POST',
      { name: 'zydock-acme' },
      accessToken,
    );
    const body = (await response.json()) as {
      gitSource: { id: string; status: string };
      manifest: { hook_attributes: { url: string } };
      state: string;
      postUrl: string;
    };

    expect(response.status).toBe(201);
    expect(body.gitSource.status).toBe('pending');
    expect(body.manifest.hook_attributes.url).toBe(
      `${config.backendUrl}/api/webhooks/github-app/${body.gitSource.id}`,
    );

    gitSourceId = body.gitSource.id;
    state = body.state;
  });

  test('POST /callback with an unknown state is 404, without calling GitHub', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (() => {
      throw new Error('must not call GitHub');
    }) as unknown as typeof fetch;

    try {
      const response = await json(
        `/organizations/${organizationId}/git-sources/callback`,
        'POST',
        { code: 'irrelevant', state: 'does-not-exist' },
        accessToken,
      );

      expect(response.status).toBe(404);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('POST /callback with an expired state is 404, without calling GitHub', async () => {
    await gitSourceModel.updateOne(
      { _id: gitSourceId },
      { $set: { stateExpiresAt: new Date(Date.now() - 1000) } },
    );

    const originalFetch = globalThis.fetch;

    globalThis.fetch = (() => {
      throw new Error('must not call GitHub');
    }) as unknown as typeof fetch;

    try {
      const response = await json(
        `/organizations/${organizationId}/git-sources/callback`,
        'POST',
        { code: 'irrelevant', state },
        accessToken,
      );

      expect(response.status).toBe(404);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('GET / never returns privateKey, webhookSecret, clientSecret or state', async () => {
    const response = await json(
      `/organizations/${organizationId}/git-sources`,
      'GET',
      undefined,
      accessToken,
    );
    const body = (await response.json()) as { items: Record<string, unknown>[] };

    expect(response.status).toBe(200);

    for (const item of body.items) {
      expect(item.privateKey).toBeUndefined();
      expect(item.webhookSecret).toBeUndefined();
      expect(item.clientSecret).toBeUndefined();
      expect(item.state).toBeUndefined();
    }
  });

  test('DELETE of a source used by an application is 400', async () => {
    const appResponse = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        name: 'git-source-consumer',
        environmentId,
        serverId,
        port: 3000,
        git: { host: 'github', repository: 'acme/consumer' },
      },
      accessToken,
    );
    const applicationId = ((await appResponse.json()) as { application: { id: string } })
      .application.id;

    await applicationModel.updateOne(
      { _id: applicationId },
      { $set: { 'git.gitSourceId': gitSourceId } },
    );

    const response = await json(
      `/organizations/${organizationId}/git-sources/${gitSourceId}`,
      'DELETE',
      undefined,
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('installations of an unknown git source is 404', async () => {
    const response = await json(
      `/organizations/${organizationId}/git-sources/${'0'.repeat(24)}/installations`,
      'GET',
      undefined,
      accessToken,
    );

    expect(response.status).toBe(404);
  });

  test('installations of a git source from another organization is also 404', async () => {
    const other = await json(
      '/organizations',
      'POST',
      { name: 'Other Git Sources Co' },
      accessToken,
    );
    const otherOrganizationId = ((await other.json()) as { organization: { id: string } })
      .organization.id;

    const response = await json(
      `/organizations/${otherOrganizationId}/git-sources/${gitSourceId}/installations`,
      'GET',
      undefined,
      accessToken,
    );

    expect(response.status).toBe(404);
  });
});

describe('git sources webhook', () => {
  let organizationId = '';
  let gitSourceId = '';
  const webhookSecret = 'test-git-source-webhook-secret';

  test('setup: an active git source with a known webhook secret', async () => {
    const org = await json('/organizations', 'POST', { name: 'Webhook Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const owner = await userModel.findOne({ email });

    const gitSource = await gitSourceModel.create({
      organizationId,
      name: 'zydock-webhook-test',
      status: 'active',
      webhookSecret: encryptSecret(webhookSecret),
      createdBy: owner!._id,
    });

    gitSourceId = String(gitSource._id);
  });

  test('a push with an invalid signature is 401', async () => {
    const response = await app.request(`/api/webhooks/github-app/${gitSourceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-Hub-Signature-256': 'sha256=deadbeef',
      },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    });

    expect(response.status).toBe(401);
  });

  test('a non-push event is accepted but ignored (200)', async () => {
    const body = JSON.stringify({ action: 'created' });
    const signature = `sha256=${createHmac('sha256', webhookSecret).update(body, 'utf8').digest('hex')}`;

    const response = await app.request(`/api/webhooks/github-app/${gitSourceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'installation',
        'X-Hub-Signature-256': signature,
      },
      body,
    });

    expect(response.status).toBe(200);
  });
});

describe('ensureLocalServer (adoption)', () => {
  test('adopts a pre-existing local server instead of creating a new one', async () => {
    await serverModel.deleteMany({ type: 'local' });

    const preexisting = await serverModel.create({
      organizationId: new mongoose.Types.ObjectId(),
      name: 'Old local box',
      type: 'local',
      status: 'pending',
      agent: { host: 'old-host', port: 9001 },
    });

    await ensureLocalServer();

    expect(getLocalServerId()).toBe(String(preexisting._id));
    expect(await serverModel.countDocuments({ type: 'local' })).toBe(1);

    const adopted = await serverModel.findById(preexisting._id);

    expect(adopted?.organizationId).toBeUndefined();
  });

  test('running it again does not create a duplicate', async () => {
    const idBefore = getLocalServerId();

    await ensureLocalServer();

    expect(getLocalServerId()).toBe(idBefore);
    expect(await serverModel.countDocuments({ type: 'local' })).toBe(1);
  });
});

describe('seedDefaultOrganization', () => {
  test('creates "My organization" owned by the superuser', async () => {
    const superuserEmail = config.auth.superusers[0]!;

    expect(superuserEmail).toBeString();

    await userModel.create({
      email: superuserEmail,
      name: 'seed-admin',
      status: 'active',
      password: await hashPassword('irrelevant-password'),
    });

    await seedDefaultOrganization();

    const organization = await organizationModel.findOne({ slug: 'my-organization' });

    expect(organization?.name).toBe(config.defaultOrganization.name);

    const owner = await userModel.findOne({ email: superuserEmail });
    const membership = await membershipModel.findOne({
      organizationId: organization!._id,
      userId: owner!._id,
    });

    expect(membership?.role).toBe('owner');
  });

  test('running it again does not create a duplicate', async () => {
    const before = await organizationModel.countDocuments({ slug: 'my-organization' });

    await seedDefaultOrganization();

    expect(await organizationModel.countDocuments({ slug: 'my-organization' })).toBe(before);
  });
});
