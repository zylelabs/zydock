import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { createApp } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { stopWorker } from '../../src/modules/queue/queue.service';

/**
 * Integration: the real Hono app answered in-process (`app.request`) against a throwaway Mongo. No
 * network, no listening socket — the same routing, middlewares and services the server runs.
 */
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
