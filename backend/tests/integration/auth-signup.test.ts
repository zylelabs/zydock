import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../src/app-server';
import config from '../../src/config';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import userModel from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/modules/users/user.service';

const password = 'signup-secret-1';
const seedSuperuserEmail = config.auth.superusers[0]!;
const unprovisionedSuperuserEmail = `unprovisioned-${Date.now()}@zydock.test`;
const regularEmail = `regular-${Date.now()}@zydock.test`;
const lateSuperuserEmail = `late-superuser-${Date.now()}@zydock.test`;

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

const signup = (email: string, name: string) =>
  json('/auth/signup', 'POST', { email, name, password });

const signin = (email: string) => json('/auth/signin', 'POST', { email, password });

beforeAll(async () => {
  await connectDatabase();

  expect(seedSuperuserEmail).toBeString();

  await userModel.findOneAndUpdate(
    { email: seedSuperuserEmail },
    {
      $set: {
        name: 'signup-seed-superuser',
        status: 'active',
        password: await hashPassword(password),
        provisionedBySeed: true,
      },
    },
    { upsert: true },
  );

  app = createApp();
});

afterAll(async () => {
  config.auth.superusers = config.auth.superusers.filter(
    email => email !== unprovisionedSuperuserEmail && email !== lateSuperuserEmail,
  );

  await userModel.deleteMany({
    email: {
      $in: [seedSuperuserEmail, unprovisionedSuperuserEmail, regularEmail, lateSuperuserEmail],
    },
  });

  await disconnectDatabase();
});

describe('POST /auth/signup — superuser escalation', () => {
  test('an email listed in SUPERUSER_EMAILS with no seed account is rejected', async () => {
    config.auth.superusers.push(unprovisionedSuperuserEmail);

    const response = await signup(unprovisionedSuperuserEmail, 'Attacker');
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error.toLowerCase()).not.toContain('superuser');

    const created = await userModel.findOne({ email: unprovisionedSuperuserEmail });
    expect(created).toBeNull();
  });

  test('a regular signup keeps working', async () => {
    const response = await signup(regularEmail, 'Regular User');
    const body = (await response.json()) as { user: { email: string; superuser: boolean } };

    expect(response.status).toBe(201);
    expect(body.user.email).toBe(regularEmail);
    expect(body.user.superuser).toBe(false);
  });

  test('the seed account authenticates and is recognized as superuser', async () => {
    const response = await signin(seedSuperuserEmail);
    const body = (await response.json()) as { user: { superuser: boolean } };

    expect(response.status).toBe(200);
    expect(body.user.superuser).toBe(true);
  });

  test('regression: an existing regular user does not become superuser when its email is added to SUPERUSER_EMAILS later', async () => {
    await signup(lateSuperuserEmail, 'Late Superuser');

    config.auth.superusers.push(lateSuperuserEmail);

    const response = await signin(lateSuperuserEmail);
    const body = (await response.json()) as { user: { superuser: boolean } };

    expect(response.status).toBe(200);
    expect(body.user.superuser).toBe(false);
  });
});
