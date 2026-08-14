import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { createApp } from '../../src/app-server';
import config from '../../src/config';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import {
  applyDashboardDomain,
  applyDashboardRoutes,
} from '../../src/modules/dashboard/dashboard-route.service';
import dashboardModel from '../../src/modules/dashboard/dashboard.model';
import {
  bootstrapDashboard,
  invalidatePublicUrlCache,
  resolvePublicUrl,
} from '../../src/modules/dashboard/dashboard.service';
import domainModel from '../../src/modules/domains/domain.model';
import { ensureLocalServer } from '../../src/modules/servers/local-server.service';
import serverModel from '../../src/modules/servers/server.model';
import userModel from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/modules/users/user.service';

type DashboardSettings = {
  domain: string;
  status: string;
  lastError?: string;
  publicIp: string;
  dnsMismatch: boolean;
};

const objectId = () => new mongoose.Types.ObjectId().toString();

const password = 'dashboard-secret-1';
const superuserEmail = config.auth.superusers[0]!;
const memberEmail = `dashboard-member-${Date.now()}@zydock.test`;

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

const upsertOk = () => new Response(null, { status: 204 });

const upsertOkTrackingOrder =
  (calls: { path: string; method: string }[]) => (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;

    calls.push({ path, method: init?.method ?? 'GET' });

    return new Response(null, { status: 204 });
  };

beforeAll(async () => {
  await connectDatabase();
  await ensureLocalServer();

  const hashed = await hashPassword(password);

  await userModel.findOneAndUpdate(
    { email: superuserEmail },
    { $set: { name: 'dashboard-superuser', status: 'active', password: hashed } },
    { upsert: true },
  );

  await userModel.create({
    email: memberEmail,
    name: 'dashboard-member',
    status: 'active',
    password: hashed,
  });

  app = createApp();

  superuserToken = await signIn(superuserEmail);
  memberToken = await signIn(memberEmail);
});

afterEach(async () => {
  await dashboardModel.deleteMany({});
  invalidatePublicUrlCache();
});

afterAll(async () => {
  await dashboardModel.deleteMany({});
  await domainModel.deleteMany({});
  await serverModel.deleteMany({ type: 'local' });
  await userModel.deleteMany({ email: { $in: [superuserEmail, memberEmail] } });
  await disconnectDatabase();
});

describe('dashboard — bootstrap', () => {
  test('seeds the domain from the env only when no document exists yet', async () => {
    await dashboardModel.deleteMany({});
    config.dashboard.domain = 'seed.example.com';

    await bootstrapDashboard();

    const document = await dashboardModel.findOne({});

    expect(document?.domain).toBe('seed.example.com');
    expect(document?.status).toBe('pending');
  });

  test('a second boot with a different env value does not overwrite the stored domain', async () => {
    config.dashboard.domain = 'seed.example.com';

    await bootstrapDashboard();

    config.dashboard.domain = 'different.example.com';

    await bootstrapDashboard();

    const document = await dashboardModel.findOne({});

    expect(document?.domain).toBe('seed.example.com');

    config.dashboard.domain = '';
  });

  test('with no seed and no document, the dashboard stays disabled', async () => {
    config.dashboard.domain = '';

    await bootstrapDashboard();

    const document = await dashboardModel.findOne({});

    expect(document?.domain).toBe('');
    expect(document?.status).toBe('disabled');
  });
});

describe('dashboard — applyDashboardRoutes', () => {
  test('without a domain, publishes the two catch-all routes and removes the two domain routes', async () => {
    const calls: { path: string; method: string }[] = [];

    await withFetch(upsertOkTrackingOrder(calls), () => applyDashboardRoutes(''));

    const methodsOf = (path: string) => calls.find(call => call.path.endsWith(path))?.method;

    expect(methodsOf('/proxy/routes/system-dashboard-websocket')).toBe('PUT');
    expect(methodsOf('/proxy/routes/system-dashboard')).toBe('PUT');
    expect(methodsOf('/proxy/routes/system-dashboard-domain-websocket')).toBe('DELETE');
    expect(methodsOf('/proxy/routes/system-dashboard-domain')).toBe('DELETE');
  });

  test('with a domain, publishes all four routes with the websocket route of each group first', async () => {
    const calls: { path: string; method: string }[] = [];

    await withFetch(upsertOkTrackingOrder(calls), () => applyDashboardRoutes('panel.example.com'));

    const indexOf = (path: string) => calls.findIndex(call => call.path.endsWith(path));

    expect(indexOf('/proxy/routes/system-dashboard-websocket')).toBeGreaterThanOrEqual(0);
    expect(indexOf('/proxy/routes/system-dashboard')).toBeGreaterThanOrEqual(0);
    expect(indexOf('/proxy/routes/system-dashboard-domain-websocket')).toBeGreaterThanOrEqual(0);
    expect(indexOf('/proxy/routes/system-dashboard-domain')).toBeGreaterThanOrEqual(0);

    expect(indexOf('/proxy/routes/system-dashboard-websocket')).toBeLessThan(
      indexOf('/proxy/routes/system-dashboard'),
    );
    expect(indexOf('/proxy/routes/system-dashboard-domain-websocket')).toBeLessThan(
      indexOf('/proxy/routes/system-dashboard-domain'),
    );
  });
});

describe('dashboard — applying a domain that fails', () => {
  test('the document becomes error with lastError, the domain field is kept', async () => {
    await dashboardModel.create({ domain: 'old.example.com', status: 'active' });

    await expect(
      withFetch(
        () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:9000');
        },
        () => applyDashboardDomain('old.example.com'),
      ),
    ).rejects.toThrow();

    const document = await dashboardModel.findOne({});

    expect(document?.status).toBe('error');
    expect(document?.lastError).toContain('ECONNREFUSED');
    expect(document?.domain).toBe('old.example.com');
  });
});

describe('dashboard — PATCH /settings', () => {
  test('without a token is 401', async () => {
    const response = await json('/dashboard/settings', 'PATCH', { domain: 'panel.example.com' });

    expect(response.status).toBe(401);
  });

  test('for a non-superuser is 403', async () => {
    const response = await json(
      '/dashboard/settings',
      'PATCH',
      { domain: 'panel.example.com' },
      memberToken,
    );

    expect(response.status).toBe(403);
  });

  test('an invalid hostname is rejected by Zod', async () => {
    const response = await json(
      '/dashboard/settings',
      'PATCH',
      { domain: 'not a hostname' },
      superuserToken,
    );

    expect(response.status).toBe(400);
  });

  test('a hostname already used by an application domain is rejected', async () => {
    await domainModel.create({
      organizationId: objectId(),
      applicationId: objectId(),
      serverId: objectId(),
      hostname: 'taken.example.com',
      tls: true,
    });

    const response = await json(
      '/dashboard/settings',
      'PATCH',
      { domain: 'taken.example.com' },
      superuserToken,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain('already in use');

    await domainModel.deleteMany({ hostname: 'taken.example.com' });
  });

  test('saves and tries to apply the domain, tolerating an unreachable agent', async () => {
    const response = await withFetch(
      () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9000');
      },
      () => json('/dashboard/settings', 'PATCH', { domain: 'panel.example.com' }, superuserToken),
    );
    const body = (await response.json()) as DashboardSettings;

    expect(response.status).toBe(200);
    expect(body.domain).toBe('panel.example.com');
    expect(body.status).toBe('error');
    expect(body.lastError).toContain('ECONNREFUSED');
  });

  test('clearing the domain with DELETE /domain goes back to IP-only', async () => {
    await dashboardModel.updateOne({}, { $set: { domain: 'panel.example.com', status: 'active' } });

    const response = await withFetch(upsertOk, () =>
      json('/dashboard/domain', 'DELETE', undefined, superuserToken),
    );
    const body = (await response.json()) as DashboardSettings;

    expect(response.status).toBe(200);
    expect(body.domain).toBe('');
    expect(body.status).toBe('disabled');
  });
});

describe('dashboard — POST /domain/check', () => {
  test('an unreachable agent answers 502', async () => {
    await dashboardModel.create({ domain: 'pending.example.com', status: 'pending' });

    const response = await withFetch(
      () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9000');
      },
      () => json('/dashboard/domain/check', 'POST', undefined, superuserToken),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain('ECONNREFUSED');
  });

  test('promotes pending to active once the proxy reports a valid certificate', async () => {
    await dashboardModel.create({ domain: 'pending.example.com', status: 'pending' });

    const respondValidCertificate = () =>
      new Response(
        JSON.stringify({
          domain: 'pending.example.com',
          valid: true,
          issuer: "Let's Encrypt",
          issuedAt: '2026-08-01T00:00:00.000Z',
          expiresAt: '2026-11-01T00:00:00.000Z',
        }),
        { status: 200 },
      );

    const response = await withFetch(respondValidCertificate, () =>
      json('/dashboard/domain/check', 'POST', undefined, superuserToken),
    );
    const body = (await response.json()) as DashboardSettings & { certificateIssuer?: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('active');
    expect(body.certificateIssuer).toBe("Let's Encrypt");
  });
});

describe('dashboard — resolvePublicUrl', () => {
  test('with no domain, resolves to config.appUrl', async () => {
    await dashboardModel.create({ domain: '', status: 'disabled' });

    expect(await resolvePublicUrl()).toBe(config.appUrl);
  });

  test('with an active domain, resolves to https://<domain>', async () => {
    await dashboardModel.create({ domain: 'panel.example.com', status: 'active' });

    expect(await resolvePublicUrl()).toBe('https://panel.example.com');
  });

  test('the cache is invalidated after saving a new domain', async () => {
    await dashboardModel.create({ domain: '', status: 'disabled' });

    expect(await resolvePublicUrl()).toBe(config.appUrl);

    await withFetch(upsertOk, () =>
      json('/dashboard/settings', 'PATCH', { domain: 'fresh.example.com' }, superuserToken),
    );

    expect(await resolvePublicUrl()).toBe('https://fresh.example.com');
  });
});
