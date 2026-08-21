import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../src/app-server';
import config from '../../src/config';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import userModel from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/modules/users/user.service';
import { resetRateLimitState } from '../../src/utils/rate-limit.middleware';

const password = 'rate-limit-secret-1';
const email = `rate-limit-${Date.now()}@zydock.test`;

let app: ReturnType<typeof createApp>;

const json = (path: string, method: string, body: unknown, ip: string) =>
  app.request(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

const signinWithWrongPassword = (ip: string) =>
  json('/auth/signin', 'POST', { email, password: 'wrong-password' }, ip);

beforeAll(async () => {
  await connectDatabase();

  await userModel.create({
    email,
    name: 'Rate Limit',
    status: 'active',
    password: await hashPassword(password),
  });

  app = createApp();
});

afterEach(() => {
  resetRateLimitState();
  config.rateLimit.signin.max = 10;
  config.rateLimit.signin.windowMs = 15 * 60 * 1000;
});

afterAll(async () => {
  await userModel.deleteMany({ email });

  await disconnectDatabase();
});

describe('POST /auth/signin — rate limiting', () => {
  test('a sequence above the limit receives 429 with Retry-After', async () => {
    config.rateLimit.signin.max = 3;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await signinWithWrongPassword('203.0.113.1');
      expect(response.status).toBe(401);
    }

    const blocked = await signinWithWrongPassword('203.0.113.1');
    const body = (await blocked.json()) as { error: string };

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
    expect(body.error).toBeString();
  });

  test('the window expires and releases the key', async () => {
    config.rateLimit.signin.max = 1;
    config.rateLimit.signin.windowMs = 100;

    const first = await signinWithWrongPassword('203.0.113.2');
    expect(first.status).toBe(401);

    const blocked = await signinWithWrongPassword('203.0.113.2');
    expect(blocked.status).toBe(429);

    await new Promise(resolve => setTimeout(resolve, 150));

    const afterWindow = await signinWithWrongPassword('203.0.113.2');
    expect(afterWindow.status).toBe(401);
  });

  test('different keys do not interfere with each other', async () => {
    config.rateLimit.signin.max = 1;

    const first = await signinWithWrongPassword('203.0.113.3');
    expect(first.status).toBe(401);

    const blocked = await signinWithWrongPassword('203.0.113.3');
    expect(blocked.status).toBe(429);

    const otherIp = await signinWithWrongPassword('203.0.113.4');
    expect(otherIp.status).toBe(401);
  });
});
