import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { createApp } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { stopWorker } from '../../src/modules/queue/queue.service';

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
  let serverId = '';
  let agentToken = '';

  test('create a local server returns the agent token once (201)', async () => {
    const org = await json('/organizations', 'POST', { name: 'Local Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const response = await json(
      `/organizations/${organizationId}/servers`,
      'POST',
      { type: 'local', name: 'minha-máquina', agentHost: 'host.docker.internal' },
      accessToken,
    );
    const body = (await response.json()) as {
      server: { id: string; type: string; status: string; agent: { host: string } };
      agentToken: string;
    };

    expect(response.status).toBe(201);
    expect(body.server.type).toBe('local');
    expect(body.server.status).toBe('pending');
    expect(body.server.agent.host).toBe('host.docker.internal');
    expect(body.agentToken).toBeString();

    serverId = body.server.id;
    agentToken = body.agentToken;
  });

  test('provisioning a local server is rejected (400)', async () => {
    const response = await json(
      `/organizations/${organizationId}/servers/${serverId}/provision`,
      'POST',
      undefined,
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('a heartbeat with the returned token brings the server online', async () => {
    const response = await app.request(`/api/agent/heartbeat/${serverId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': agentToken },
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

    expect(body.items.find(item => item.id === serverId)?.status).toBe('online');
  });

  test('a heartbeat with a wrong token is rejected (401)', async () => {
    const response = await app.request(`/api/agent/heartbeat/${serverId}`, {
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

    const server = await json(
      `/organizations/${organizationId}/servers`,
      'POST',
      { type: 'local', name: 'local-1' },
      accessToken,
    );
    serverId = ((await server.json()) as { server: { id: string } }).server.id;

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
        git: { hasToken: boolean; token?: string };
        portMappings: { hostPort: number; containerPort: number; protocol: string }[];
      };
    };

    expect(response.status).toBe(201);
    expect(body.application.git.hasToken).toBeTrue();
    expect(body.application.git.token).toBeUndefined();
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
