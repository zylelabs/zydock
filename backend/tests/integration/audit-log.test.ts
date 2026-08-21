import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { createApp } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { createMembership } from '../../src/modules/organizations/membership.service';
import {
  ensureLocalServer,
  getLocalServerId,
} from '../../src/modules/servers/local-server.service';
import { stopWorker } from '../../src/modules/queue/queue.service';
import userModel from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/modules/users/user.service';

let app: ReturnType<typeof createApp>;

const email = `it-audit-log-${Date.now()}@zydock.test`;
const password = 'integration-secret-1';
let adminToken = '';
let memberToken = '';
let organizationId = '';
let serverId = '';

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

const installAgentMock = (writeResponse: { status: number; body: unknown }) => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (method === 'PUT' && /\/api\/volumes\/[^/]+\/files\/content$/.test(path)) {
      return jsonResponse(writeResponse.body, writeResponse.status);
    }

    throw new Error(`Unhandled agent request in test mock: ${method} ${path}`);
  }) as typeof fetch;
};

const restoreFetch = () => {
  globalThis.fetch = originalFetch;
};

beforeAll(async () => {
  await connectDatabase();
  await ensureLocalServer();
  serverId = getLocalServerId()!;
  app = createApp();

  const signup = await json('/auth/signup', 'POST', {
    name: 'Audit Log Owner',
    email,
    password,
  });
  adminToken = ((await signup.json()) as { accessToken: string }).accessToken;

  const org = await json('/organizations', 'POST', { name: 'Audit Log Co' }, adminToken);
  organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

  const memberEmail = `it-audit-log-member-${Date.now()}@zydock.test`;
  const memberPassword = 'integration-secret-2';
  const member = await userModel.create({
    email: memberEmail,
    name: 'audit-log-member',
    status: 'active',
    password: await hashPassword(memberPassword),
  });

  await createMembership(organizationId, String(member._id), 'member');

  const signin = await json('/auth/signin', 'POST', {
    email: memberEmail,
    password: memberPassword,
  });
  memberToken = ((await signin.json()) as { accessToken: string }).accessToken;
});

afterAll(async () => {
  restoreFetch();
  stopWorker();
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
});

describe('audit log', () => {
  test('a write on a volume not created by Zydock is refused with 423', async () => {
    installAgentMock({
      status: 423,
      body: {
        error: 'This volume was not created by Zydock and cannot be accessed through this API.',
      },
    });

    const response = await app.request(
      `/api/organizations/${organizationId}/servers/${serverId}/volumes/unmanaged-volume/files/content?path=server.properties`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          authorization: `Bearer ${adminToken}`,
        },
        body: 'contents',
      },
    );

    restoreFetch();

    expect(response.status).toBe(423);
  });

  test('a successful write records an audit log entry', async () => {
    installAgentMock({ status: 200, body: { message: 'File written' } });

    const write = await app.request(
      `/api/organizations/${organizationId}/servers/${serverId}/volumes/managed-volume/files/content?path=server.properties`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          authorization: `Bearer ${adminToken}`,
        },
        body: 'contents',
      },
    );

    restoreFetch();

    expect(write.status).toBe(200);

    const list = await json(
      `/organizations/${organizationId}/audit-log`,
      'GET',
      undefined,
      adminToken,
    );
    const body = (await list.json()) as { items: { action: string; volume: string }[] };

    expect(
      body.items.some(item => item.action === 'volume.write' && item.volume === 'managed-volume'),
    ).toBe(true);
  });

  test('a member cannot list the audit log', async () => {
    const response = await json(
      `/organizations/${organizationId}/audit-log`,
      'GET',
      undefined,
      memberToken,
    );

    expect(response.status).toBe(403);
  });
});
