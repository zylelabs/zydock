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

const email = `it-volume-files-${Date.now()}@zydock.test`;
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

const installAgentMock = () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (method === 'GET' && /\/api\/volumes\/[^/]+\/files$/.test(path)) {
      return jsonResponse([{ name: 'server.properties', path: 'server.properties', isDirectory: false, sizeBytes: 12 }]);
    }

    if (method === 'PUT' && /\/api\/volumes\/[^/]+\/files\/content$/.test(path)) {
      return jsonResponse({ message: 'File written' });
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
    name: 'Volume Files Owner',
    email,
    password,
  });
  adminToken = ((await signup.json()) as { accessToken: string }).accessToken;

  const org = await json('/organizations', 'POST', { name: 'Volume Files Co' }, adminToken);
  organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

  const memberEmail = `it-volume-files-member-${Date.now()}@zydock.test`;
  const memberPassword = 'integration-secret-2';
  const member = await userModel.create({
    email: memberEmail,
    name: 'volume-files-member',
    status: 'active',
    password: await hashPassword(memberPassword),
  });

  await createMembership(organizationId, String(member._id), 'member');

  const signin = await json('/auth/signin', 'POST', { email: memberEmail, password: memberPassword });
  memberToken = ((await signin.json()) as { accessToken: string }).accessToken;
});

afterAll(async () => {
  restoreFetch();
  stopWorker();
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
});

describe('volume files: role guard', () => {
  test('a member can list files', async () => {
    installAgentMock();

    const response = await json(
      `/organizations/${organizationId}/servers/${serverId}/volumes/some-volume/files`,
      'GET',
      undefined,
      memberToken,
    );

    restoreFetch();

    expect(response.status).toBe(200);
  });

  test('a member cannot write a file', async () => {
    const response = await json(
      `/organizations/${organizationId}/servers/${serverId}/volumes/some-volume/files/content?path=server.properties`,
      'PUT',
      { data: 'x' },
      memberToken,
    );

    expect(response.status).toBe(403);
  });

  test('a member cannot create a directory', async () => {
    const response = await json(
      `/organizations/${organizationId}/servers/${serverId}/volumes/some-volume/files/directory`,
      'POST',
      { path: 'configs' },
      memberToken,
    );

    expect(response.status).toBe(403);
  });

  test('a member cannot delete a path', async () => {
    const response = await json(
      `/organizations/${organizationId}/servers/${serverId}/volumes/some-volume/files?path=server.properties`,
      'DELETE',
      undefined,
      memberToken,
    );

    expect(response.status).toBe(403);
  });

  test('an admin can write a file', async () => {
    installAgentMock();

    const response = await app.request(
      `/api/organizations/${organizationId}/servers/${serverId}/volumes/some-volume/files/content?path=server.properties`,
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

    expect(response.status).toBe(200);
  });

  test('rejects a path that escapes the volume root', async () => {
    const response = await json(
      `/organizations/${organizationId}/servers/${serverId}/volumes/some-volume/files?path=../etc/passwd`,
      'GET',
      undefined,
      memberToken,
    );

    expect(response.status).toBe(400);
  });
});
