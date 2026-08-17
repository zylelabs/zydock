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

let app: ReturnType<typeof createApp>;

const email = `it-app-services-${Date.now()}@zydock.test`;
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

const twoServiceCompose =
  'services:\n  app:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n  db:\n    image: postgres:16-alpine\n';

const originalFetch = globalThis.fetch;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

let currentSlug = '';

const installAgentMock = () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (method === 'GET' && /\/api\/compose\/[^/]+\/ps$/.test(path)) {
      return jsonResponse([
        {
          name: `zydock-${currentSlug}-app-1`,
          service: 'app',
          state: 'running',
          health: 'none',
          publishers: [],
        },
      ]);
    }

    if (method === 'GET' && /\/api\/metrics\/containers$/.test(path)) {
      return jsonResponse([
        {
          id: 'container-id',
          name: `zydock-${currentSlug}-app-1`,
          cpuPercent: 1.5,
          memoryUsedMb: 128,
          memoryLimitMb: 512,
        },
      ]);
    }

    if (method === 'POST' && /\/api\/compose\/[^/]+\/restart$/.test(path)) {
      return jsonResponse({ message: 'Restarted' });
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

  const user = await userModel.create({
    email,
    name: 'app-services-user',
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

describe('application services routes', () => {
  let organizationId = '';
  let serverId = '';
  let environmentId = '';
  let applicationId = '';

  test('setup: org, project, environment and a two-service compose application', async () => {
    const org = await json('/organizations', 'POST', { name: 'App Services Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    serverId = getLocalServerId()!;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'App Services Project' },
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

    const create = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'services-app',
        environmentId,
        serverId,
        compose: { content: twoServiceCompose, expose: { service: 'app', port: 80 } },
      },
      accessToken,
    );
    const created = (await create.json()) as { application: { id: string; slug: string } };

    expect(create.status).toBe(201);

    applicationId = created.application.id;
    currentSlug = created.application.slug;
  });

  describe('GET /applications/:applicationId/services', () => {
    test('keeps the old shape and adds the new fields plus networkName', async () => {
      const response = await json(
        `/organizations/${organizationId}/applications/${applicationId}/services`,
        'GET',
        undefined,
        accessToken,
      );
      const body = (await response.json()) as {
        services: {
          service: string;
          containerName: string;
          exposed: boolean;
          role: string;
          image?: string;
          internalPort?: number;
          kind?: string;
        }[];
        networkName?: string;
      };

      expect(response.status).toBe(200);
      expect(body.networkName).toBe(`${currentSlug}_default`);

      const primary = body.services.find(service => service.service === 'app');
      const linked = body.services.find(service => service.service === 'db');

      expect(primary).toMatchObject({
        service: 'app',
        exposed: true,
        role: 'primary',
        image: 'nginx:1.27',
        internalPort: 80,
        kind: 'Application',
      });
      expect(primary?.containerName).toBeString();

      expect(linked).toMatchObject({
        service: 'db',
        exposed: false,
        role: 'linked',
        image: 'postgres:16-alpine',
      });
    });
  });

  describe('GET /applications/:applicationId/services/status', () => {
    test('matches state and memory by container name when the agent responds', async () => {
      installAgentMock();

      try {
        const response = await json(
          `/organizations/${organizationId}/applications/${applicationId}/services/status`,
          'GET',
          undefined,
          accessToken,
        );
        const body = (await response.json()) as {
          services: { service: string; state: string; memoryUsedMb?: number }[];
        };

        expect(response.status).toBe(200);

        const app = body.services.find(service => service.service === 'app');
        const db = body.services.find(service => service.service === 'db');

        expect(app?.state).toBe('running');
        expect(app?.memoryUsedMb).toBe(128);
        expect(db?.state).toBe('unknown');
      } finally {
        restoreFetch();
      }
    });

    test('degrades to a 200 with a reason when the agent is unreachable', async () => {
      globalThis.fetch = (async () => {
        throw new Error('connection refused');
      }) as unknown as typeof fetch;

      try {
        const response = await json(
          `/organizations/${organizationId}/applications/${applicationId}/services/status`,
          'GET',
          undefined,
          accessToken,
        );
        const body = (await response.json()) as {
          services: unknown[];
          degraded?: { reason: string };
        };

        expect(response.status).toBe(200);
        expect(body.services).toEqual([]);
        expect(body.degraded?.reason).toBeString();
      } finally {
        restoreFetch();
      }
    });
  });

  describe('POST /applications/:applicationId/services/:service/restart', () => {
    test('member role is denied', async () => {
      const memberEmail = `it-app-services-member-${Date.now()}@zydock.test`;
      const memberPassword = 'integration-secret-2';

      const member = await userModel.create({
        email: memberEmail,
        name: 'app-services-member',
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
        `/organizations/${organizationId}/applications/${applicationId}/services/app/restart`,
        'POST',
        undefined,
        memberToken,
      );

      expect(response.status).toBe(403);
    });

    test('an unknown service returns 404 without calling the agent', async () => {
      globalThis.fetch = (async () => {
        throw new Error('the agent must not be called for an unknown service');
      }) as unknown as typeof fetch;

      try {
        const response = await json(
          `/organizations/${organizationId}/applications/${applicationId}/services/missing/restart`,
          'POST',
          undefined,
          accessToken,
        );

        expect(response.status).toBe(404);
      } finally {
        restoreFetch();
      }
    });

    test('restarts just that service through the compose provider', async () => {
      installAgentMock();

      let restartedPath = '';
      const wrapped = globalThis.fetch;

      globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));

        if (
          (init?.method ?? 'GET') === 'POST' &&
          /\/api\/compose\/[^/]+\/restart$/.test(url.pathname)
        ) {
          restartedPath = url.pathname + url.search;
        }

        return wrapped(input, init);
      }) as typeof fetch;

      try {
        const response = await json(
          `/organizations/${organizationId}/applications/${applicationId}/services/db/restart`,
          'POST',
          undefined,
          accessToken,
        );

        expect(response.status).toBe(200);
        expect(restartedPath).toContain('service=db');
      } finally {
        restoreFetch();
      }
    });
  });

  describe('a git application has no services to restart', () => {
    test('setup: a git application', async () => {
      const create = await json(
        `/organizations/${organizationId}/applications`,
        'POST',
        {
          source: 'git',
          name: 'git-app',
          environmentId,
          serverId,
          git: { repository: 'zydock/example' },
          port: 3000,
        },
        accessToken,
      );

      expect(create.status).toBe(201);

      const created = (await create.json()) as { application: { id: string } };

      const response = await json(
        `/organizations/${organizationId}/applications/${created.application.id}/services/app/restart`,
        'POST',
        undefined,
        accessToken,
      );

      expect(response.status).toBe(409);
    });
  });
});
