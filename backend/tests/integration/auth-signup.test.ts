import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp, stopBackgroundWork, waitForBootstrap } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import userModel from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/modules/users/user.service';

const password = 'signup-secret-1';
const existingSuperuserEmail = `signup-superuser-${Date.now()}@zydock.test`;
const regularEmail = `regular-${Date.now()}@zydock.test`;
const codeAttemptEmail = `code-attempt-${Date.now()}@zydock.test`;

let app: ReturnType<typeof createApp>;

const json = (path: string, method: string, body?: unknown, token?: string) =>
  app.request(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const signup = (email: string, name: string, bootstrapCode?: string) =>
  json('/auth/signup', 'POST', {
    email,
    name,
    password,
    ...(bootstrapCode ? { bootstrapCode } : {}),
  });

const signin = (email: string) => json('/auth/signin', 'POST', { email, password });

beforeAll(async () => {
  await connectDatabase();

  await userModel.findOneAndUpdate(
    { email: existingSuperuserEmail },
    {
      $set: {
        name: 'signup-superuser',
        status: 'active',
        password: await hashPassword(password),
        superuser: true,
      },
    },
    { upsert: true },
  );

  app = createApp();

  await waitForBootstrap();
});

afterAll(async () => {
  stopBackgroundWork();

  await userModel.deleteMany({
    email: { $in: [existingSuperuserEmail, regularEmail, codeAttemptEmail] },
  });

  await disconnectDatabase();
});

describe('POST /auth/signup — superuser escalation', () => {
  test('a regular signup keeps working and never grants the marker', async () => {
    const response = await signup(regularEmail, 'Regular User');
    const body = (await response.json()) as { user: { email: string; superuser: boolean } };

    expect(response.status).toBe(201);
    expect(body.user.email).toBe(regularEmail);
    expect(body.user.superuser).toBe(false);
  });

  test('a bootstrap code is rejected once the instance already has a superuser', async () => {
    const response = await signup(codeAttemptEmail, 'Late Bootstrap', '999K7RF1');
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error.toLowerCase()).not.toContain('superuser');

    expect(await userModel.findOne({ email: codeAttemptEmail })).toBeNull();
  });

  test('the existing superuser account is recognized as superuser', async () => {
    const response = await signin(existingSuperuserEmail);
    const body = (await response.json()) as { user: { superuser: boolean } };

    expect(response.status).toBe(200);
    expect(body.user.superuser).toBe(true);
  });
});
