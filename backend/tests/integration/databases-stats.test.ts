import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { createApp } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { createMembership } from '../../src/modules/organizations/membership.service';
import { stopWorker } from '../../src/modules/queue/queue.service';
import {
  ensureLocalServer,
  getLocalServerId,
} from '../../src/modules/servers/local-server.service';
import { hashPassword } from '../../src/modules/users/user.service';
import userModel from '../../src/modules/users/user.model';
import databaseModel from '../../src/modules/databases/database.model';
import { encryptSecret } from '../../src/utils/crypto';

let app: ReturnType<typeof createApp>;

const email = `it-db-stats-${Date.now()}@zydock.test`;
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

const statsStdout = [
  'connections=18',
  'maxConnections=100',
  'sizeBytes=4404019200',
  'versionLabel=16.3',
  'diskTotalBytes=103079215104',
  'diskUsedBytes=4404019200',
].join('\n');

const containerId = `db-stats-container-${Date.now()}`;

const installAgentMock = () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (method === 'POST' && path === `/api/containers/${containerId}/exec`) {
      return jsonResponse({ exitCode: 0, stdout: statsStdout, stderr: '' });
    }

    if (method === 'GET' && path === `/api/containers/${containerId}`) {
      return jsonResponse({
        id: containerId,
        name: containerId,
        image: 'postgres:16',
        state: 'running',
        health: 'none',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        restartCount: 0,
        ports: [],
      });
    }

    throw new Error(`Unhandled agent request in test mock: ${method} ${path}`);
  }) as typeof fetch;
};

const installUnreachableAgentMock = () => {
  globalThis.fetch = (async () => {
    throw new Error('connection refused');
  }) as unknown as typeof fetch;
};

beforeAll(async () => {
  await connectDatabase();
  await ensureLocalServer();

  const user = await userModel.create({
    email,
    name: 'db-stats-user',
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

describe('database stats and consumers routes', () => {
  let organizationId = '';
  let serverId = '';
  let databaseId = '';

  test('setup: org and a managed database with a container', async () => {
    const org = await json('/organizations', 'POST', { name: 'DB Stats Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    serverId = getLocalServerId()!;

    const database = await databaseModel.create({
      organizationId,
      serverId,
      name: 'stats-db',
      slug: `stats-db-${Date.now()}`,
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId,
      containerName: containerId,
      credentials: {
        host: containerId,
        port: 5432,
        username: 'zydock',
        database: 'stats_db',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(`postgresql://zydock:secret@${containerId}:5432/stats_db`),
      },
    });

    databaseId = String(database._id);
  });

  describe('GET /databases/:databaseId/stats', () => {
    test('returns the measured stats and uptime when the agent responds', async () => {
      installAgentMock();

      try {
        const response = await json(
          `/organizations/${organizationId}/databases/${databaseId}/stats`,
          'GET',
          undefined,
          accessToken,
        );
        const body = (await response.json()) as {
          connections?: number;
          maxConnections?: number;
          sizeBytes?: number;
          versionLabel?: string;
          uptimeSeconds?: number;
          degraded?: unknown;
        };

        expect(response.status).toBe(200);
        expect(body.connections).toBe(18);
        expect(body.maxConnections).toBe(100);
        expect(body.sizeBytes).toBe(4404019200);
        expect(body.versionLabel).toBe('16.3');
        expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
        expect(body.degraded).toBeUndefined();
      } finally {
        restoreFetch();
      }
    });

    test('degrades to a 200 with a reason when the agent is unreachable', async () => {
      installUnreachableAgentMock();

      try {
        const response = await json(
          `/organizations/${organizationId}/databases/${databaseId}/stats`,
          'GET',
          undefined,
          accessToken,
        );
        const body = (await response.json()) as { degraded?: { reason: string } };

        expect(response.status).toBe(200);
        expect(body.degraded?.reason).toBeString();
      } finally {
        restoreFetch();
      }
    });

    test('a database from another organization is not found', async () => {
      const otherOrg = await json(
        '/organizations',
        'POST',
        { name: 'DB Stats Other Co' },
        accessToken,
      );
      const otherOrganizationId = ((await otherOrg.json()) as { organization: { id: string } })
        .organization.id;

      const response = await json(
        `/organizations/${otherOrganizationId}/databases/${databaseId}/stats`,
        'GET',
        undefined,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe('GET /databases/stats', () => {
    test('matches items by databaseId when the agent responds', async () => {
      installAgentMock();

      try {
        const response = await json(
          `/organizations/${organizationId}/databases/stats`,
          'GET',
          undefined,
          accessToken,
        );
        const body = (await response.json()) as {
          items: { databaseId: string; connections?: number }[];
          degraded?: { serverId: string; reason: string }[];
        };

        expect(response.status).toBe(200);

        const item = body.items.find(entry => entry.databaseId === databaseId);

        expect(item?.connections).toBe(18);
        expect(body.degraded).toBeUndefined();
      } finally {
        restoreFetch();
      }
    });

    test('an unreachable agent degrades once per server, not once per database', async () => {
      installUnreachableAgentMock();

      try {
        const response = await json(
          `/organizations/${organizationId}/databases/stats`,
          'GET',
          undefined,
          accessToken,
        );
        const body = (await response.json()) as {
          items: { databaseId: string }[];
          degraded?: { serverId: string; reason: string }[];
        };

        expect(response.status).toBe(200);
        expect(body.items.some(item => item.databaseId === databaseId)).toBe(true);
        expect(body.degraded).toHaveLength(1);
        expect(body.degraded?.[0]?.serverId).toBe(serverId);
      } finally {
        restoreFetch();
      }
    });

    test('a database without a container appears without metrics instead of disappearing', async () => {
      const withoutContainer = await databaseModel.create({
        organizationId,
        serverId,
        name: 'no-container-db',
        slug: `no-container-db-${Date.now()}`,
        engine: 'postgresql',
        version: '16',
        status: 'provisioning',
        source: 'managed',
        credentials: {
          host: 'pending-host',
          port: 5432,
          username: 'zydock',
          database: 'pending',
          password: encryptSecret('secret'),
          connectionUri: encryptSecret('postgresql://zydock:secret@pending-host:5432/pending'),
        },
      });

      installAgentMock();

      try {
        const response = await json(
          `/organizations/${organizationId}/databases/stats`,
          'GET',
          undefined,
          accessToken,
        );
        const body = (await response.json()) as { items: { databaseId: string }[] };

        expect(response.status).toBe(200);
        expect(
          body.items.find(item => item.databaseId === String(withoutContainer._id)),
        ).toBeDefined();
      } finally {
        restoreFetch();
        await databaseModel.deleteOne({ _id: withoutContainer._id });
      }
    });
  });

  describe('GET /databases/:databaseId/consumers', () => {
    test('a member role is authorized and the response carries no secret', async () => {
      const memberEmail = `it-db-stats-member-${Date.now()}@zydock.test`;
      const memberPassword = 'integration-secret-2';

      const member = await userModel.create({
        email: memberEmail,
        name: 'db-stats-member',
        status: 'active',
        password: await hashPassword(memberPassword),
      });

      await createMembership(organizationId, String(member._id), 'member');

      const signin = await json('/auth/signin', 'POST', {
        email: memberEmail,
        password: memberPassword,
      });
      const memberToken = ((await signin.json()) as { accessToken: string }).accessToken;

      const response = await json(
        `/organizations/${organizationId}/databases/${databaseId}/consumers`,
        'GET',
        undefined,
        memberToken,
      );
      const body = (await response.json()) as { items: unknown[] };

      expect(response.status).toBe(200);
      expect(body.items).toEqual([]);
      expect(JSON.stringify(body)).not.toContain('secret');
    });
  });
});
