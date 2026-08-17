import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { stopWorker } from '../../src/modules/queue/queue.service';
import { hashPassword } from '../../src/modules/users/user.service';
import { encryptSecret } from '../../src/utils/crypto';
import userModel from '../../src/modules/users/user.model';
import serverModel from '../../src/modules/servers/server.model';
import mongoose from 'mongoose';

let app: ReturnType<typeof createApp>;

const email = `it-db-create-${Date.now()}@zydock.test`;
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

const originalFetch = globalThis.fetch;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const restoreFetch = () => {
  globalThis.fetch = originalFetch;
};

const containerId = `db-create-container-${Date.now()}`;

const installAgentMock = () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (method === 'POST' && path === '/api/volumes') {
      return jsonResponse({ name: 'volume', driver: 'local' });
    }

    if (method === 'POST' && path === '/api/networks') {
      return jsonResponse({ name: 'network', driver: 'bridge' });
    }

    if (method === 'POST' && path === '/api/containers') {
      return jsonResponse({
        id: containerId,
        name: containerId,
        image: 'postgres:16-alpine',
        state: 'created',
        health: 'none',
        restartCount: 0,
        ports: [],
        labels: {},
        protected: false,
      });
    }

    if (method === 'POST' && path === `/api/containers/${containerId}/start`) {
      return new Response(null, { status: 204 });
    }

    if (method === 'GET' && path === `/api/containers/${containerId}`) {
      return jsonResponse({
        id: containerId,
        name: containerId,
        image: 'postgres:16-alpine',
        state: 'running',
        health: 'none',
        startedAt: new Date().toISOString(),
        restartCount: 0,
        ports: [],
        labels: {},
        protected: false,
      });
    }

    throw new Error(`Unhandled agent request in test mock: ${method} ${path}`);
  }) as typeof fetch;
};

beforeAll(async () => {
  await connectDatabase();

  const user = await userModel.create({
    email,
    name: 'db-create-user',
    status: 'active',
    password: await hashPassword(password),
  });

  app = createApp();

  const response = await json('/auth/signin', 'POST', { email, password });
  accessToken = ((await response.json()) as { accessToken: string }).accessToken;

  void user;
});

afterAll(async () => {
  restoreFetch();
  stopWorker();
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
});

describe('POST /databases', () => {
  let organizationId = '';
  let serverId = '';

  test('setup: organization and a server with an agent', async () => {
    const org = await json('/organizations', 'POST', { name: 'DB Create Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const server = await serverModel.create({
      organizationId,
      name: 'provisioning-server',
      type: 'ssh',
      agent: { host: '127.0.0.1', port: 9000, token: encryptSecret('agent-token') },
    });

    serverId = String(server._id);
  });

  test('provisions a database and returns 201', async () => {
    installAgentMock();

    try {
      const response = await json(
        `/organizations/${organizationId}/databases`,
        'POST',
        { serverId, name: 'created-from-panel', engine: 'postgresql' },
        accessToken,
      );
      const body = (await response.json()) as {
        database: { id: string; name: string; engine: string; version: string };
      };

      expect(response.status).toBe(201);
      expect(body.database.name).toBe('created-from-panel');
      expect(body.database.engine).toBe('postgresql');
      expect(body.database.version).toBe('16-alpine');
    } finally {
      restoreFetch();
    }
  });

  test('a server from another organization resolves to 400', async () => {
    const otherOrg = await json(
      '/organizations',
      'POST',
      { name: 'DB Create Other Co' },
      accessToken,
    );
    const otherOrganizationId = ((await otherOrg.json()) as { organization: { id: string } })
      .organization.id;

    const response = await json(
      `/organizations/${otherOrganizationId}/databases`,
      'POST',
      { serverId, name: 'wrong-org', engine: 'postgresql' },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('a server without an agent resolves to 409', async () => {
    const serverWithoutAgent = await serverModel.create({
      organizationId,
      name: 'no-agent-server',
      type: 'ssh',
    });

    const response = await json(
      `/organizations/${organizationId}/databases`,
      'POST',
      { serverId: String(serverWithoutAgent._id), name: 'no-agent-db', engine: 'postgresql' },
      accessToken,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain('no agent');
  });
});
