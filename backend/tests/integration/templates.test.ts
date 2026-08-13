import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { decryptSecret } from '../../src/utils/crypto';
import {
  removeApplication,
  serializeApplication,
} from '../../src/modules/applications/application.service';
import applicationModel from '../../src/modules/applications/application.model';
import databaseModel from '../../src/modules/databases/database.model';
import { composeContainerNameOf } from '../../src/modules/deployments/naming';
import { findEnvironmentOfOrganization } from '../../src/modules/projects/environment.service';
import { createMembership } from '../../src/modules/organizations/membership.service';
import { runDeployment } from '../../src/modules/deployments/pipeline.service';
import {
  ensureLocalServer,
  getLocalServerId,
} from '../../src/modules/servers/local-server.service';
import serverModel from '../../src/modules/servers/server.model';
import { stopWorker } from '../../src/modules/queue/queue.service';
import { allTemplates } from '../../src/modules/templates/catalog.service';
import { deployTemplateApplication } from '../../src/modules/templates/template.service';
import userModel from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/modules/users/user.service';

const password = 'templates-secret-1';
const email = `templates-${Date.now()}@zydock.test`;

let app: ReturnType<typeof createApp>;
let token = '';
let userId = '';

const json = (path: string, method: string, body?: unknown, authToken?: string) =>
  app.request(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  await connectDatabase();
  await ensureLocalServer();

  const user = await userModel.create({
    email,
    name: 'templates-user',
    status: 'active',
    password: await hashPassword(password),
  });

  userId = String(user._id);

  app = createApp();

  const response = await json('/auth/signin', 'POST', { email, password });
  const body = (await response.json()) as { accessToken: string };

  token = body.accessToken;
});

afterAll(async () => {
  stopWorker();
  await serverModel.deleteMany({ type: 'local' });
  await userModel.deleteMany({ email });
  await disconnectDatabase();
});

describe('GET /templates', () => {
  test('requires authentication', async () => {
    const response = await json('/templates', 'GET');

    expect(response.status).toBe(401);
  });

  test('lists the embedded catalog', async () => {
    const response = await json('/templates', 'GET', undefined, token);
    const body = (await response.json()) as { items: { id: string }[]; total: number };

    expect(response.status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.some(item => item.id === 'uptime-kuma')).toBe(true);
  });

  test('filters by category', async () => {
    const response = await json('/templates?category=monitoring', 'GET', undefined, token);
    const body = (await response.json()) as { items: { id: string; category: string }[] };

    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every(item => item.category === 'monitoring')).toBe(true);
  });

  test('filters by free-text search', async () => {
    const response = await json('/templates?search=status-page', 'GET', undefined, token);
    const body = (await response.json()) as { items: { id: string }[] };

    expect(body.items.some(item => item.id === 'uptime-kuma')).toBe(true);
  });
});

describe('GET /templates/:templateId', () => {
  test('returns the template with its inputs and secrets', async () => {
    const response = await json('/templates/uptime-kuma', 'GET', undefined, token);
    const body = (await response.json()) as {
      template: { id: string; inputs: unknown[]; secrets: { key: string; generate: string }[] };
    };

    expect(response.status).toBe(200);
    expect(body.template.id).toBe('uptime-kuma');
    expect(body.template.inputs).toEqual([]);
    expect(body.template.secrets).toEqual([]);
  });

  test('returns 404 for an unknown template', async () => {
    const response = await json('/templates/does-not-exist', 'GET', undefined, token);

    expect(response.status).toBe(404);
  });
});

describe('GET /templates/:templateId/versions', () => {
  const originalFetch = globalThis.fetch;

  const jsonResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const noVersionsTemplate: Template = {
    id: 'synthetic-no-versions-app',
    version: 1,
    name: 'Synthetic without versions',
    tagline: 'Synthetic template for the versions-route tests',
    category: 'test',
    tags: [],
    icon: 'icon.svg',
    author: 'zydock',
    origin: 'official',
    dockerCompose: 'docker-compose.yml',
    expose: { service: 'app', port: 80, domain: true },
    databases: [],
    inputs: [],
    secrets: [],
    deprecated: false,
    dockerComposeContent: 'services:\n  app:\n    image: nginx:1.27\n',
  };

  const curatedOnlyTemplate: Template = {
    ...noVersionsTemplate,
    id: 'synthetic-curated-only-versions-app',
    versions: {
      key: 'APP_VERSION',
      default: '1',
      available: [{ value: '1' }, { value: '2', label: '2.x (stable)' }],
    },
  };

  const registryRepository = `zydock-test/synthetic-versions-${Date.now()}`;

  const registryTemplate: Template = {
    ...noVersionsTemplate,
    id: 'synthetic-registry-versions-app',
    versions: {
      key: 'APP_VERSION',
      default: '1',
      available: [{ value: '1' }, { value: '2', label: '2.x (stable)' }],
      registry: { limit: 50 },
    },
    dockerComposeContent: `services:\n  app:\n    image: ${registryRepository}:\${APP_VERSION}\n`,
  };

  const outageRepository = `zydock-test/synthetic-versions-outage-${Date.now()}`;

  const outageTemplate: Template = {
    ...noVersionsTemplate,
    id: 'synthetic-registry-outage-versions-app',
    versions: {
      key: 'APP_VERSION',
      default: '1',
      available: [{ value: '1' }],
      registry: { limit: 50 },
    },
    dockerComposeContent: `services:\n  app:\n    image: ${outageRepository}:\${APP_VERSION}\n`,
  };

  const searchRepository = `zydock-test/synthetic-versions-search-${Date.now()}`;

  const searchTemplate: Template = {
    ...noVersionsTemplate,
    id: 'synthetic-registry-search-versions-app',
    versions: {
      key: 'APP_VERSION',
      default: '1',
      available: [{ value: '1' }],
      registry: { limit: 1 },
    },
    dockerComposeContent: `services:\n  app:\n    image: ${searchRepository}:\${APP_VERSION}\n`,
  };

  beforeAll(() => {
    allTemplates().push(
      noVersionsTemplate,
      curatedOnlyTemplate,
      registryTemplate,
      outageTemplate,
      searchTemplate,
    );
  });

  afterAll(() => {
    for (const id of [
      noVersionsTemplate.id,
      curatedOnlyTemplate.id,
      registryTemplate.id,
      outageTemplate.id,
      searchTemplate.id,
    ]) {
      const index = allTemplates().findIndex(template => template.id === id);

      if (index >= 0) {
        allTemplates().splice(index, 1);
      }
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns 404 for an unknown template', async () => {
    const response = await json('/templates/does-not-exist/versions', 'GET', undefined, token);

    expect(response.status).toBe(404);
  });

  test('returns 400 for a template with no selectable versions', async () => {
    const response = await json(
      `/templates/${noVersionsTemplate.id}/versions`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('no selectable versions');
  });

  test('without "versions.registry" it returns only the curated list', async () => {
    const response = await json(
      `/templates/${curatedOnlyTemplate.id}/versions`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      source: string;
      versions: { value: string; label?: string; origin: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe('catalog');
    expect(body.versions).toEqual([
      { value: '1', origin: 'catalog' },
      { value: '2', label: '2.x (stable)', origin: 'catalog' },
    ]);
  });

  test('with the registry reachable, returns the union sorted with the newest first', async () => {
    globalThis.fetch = (async (url: string) => {
      expect(url).toContain(`/repositories/${registryRepository}/tags`);

      return jsonResponse({
        results: [
          { name: '1', last_updated: '2024-01-01T00:00:00Z' },
          { name: '2', last_updated: '2024-02-01T00:00:00Z' },
          { name: '3', last_updated: '2024-03-01T00:00:00Z' },
          { name: '2.5.0', last_updated: '2024-02-15T00:00:00Z' },
          { name: 'latest', last_updated: '2024-03-02T00:00:00Z' },
          { name: 'nightly', last_updated: '2024-03-02T00:00:00Z' },
        ],
        next: null,
      });
    }) as unknown as typeof fetch;

    const response = await json(
      `/templates/${registryTemplate.id}/versions`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      source: string;
      versions: { value: string; label?: string; origin: string; updatedAt?: string }[];
      fetchedAt?: string;
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe('mixed');
    expect(body.fetchedAt).toBeString();
    expect(body.versions).toEqual([
      { value: '1', origin: 'catalog' },
      { value: '2', label: '2.x (stable)', origin: 'catalog' },
      { value: '3', origin: 'registry', updatedAt: '2024-03-01T00:00:00.000Z' },
      { value: '2.5.0', origin: 'registry', updatedAt: '2024-02-15T00:00:00.000Z' },
    ]);
  });

  test('when the registry is unreachable, degrades to the curated list with a reason', async () => {
    globalThis.fetch = (async () => {
      throw new Error('registry unreachable');
    }) as unknown as typeof fetch;

    const response = await json(
      `/templates/${outageTemplate.id}/versions`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      source: string;
      versions: { value: string; origin: string }[];
      degraded?: { reason: string };
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe('catalog');
    expect(body.versions).toEqual([{ value: '1', origin: 'catalog' }]);
    expect(body.degraded?.reason).toBeString();
  });

  test('"search" is applied before the "limit" cutoff', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        results: [
          { name: '1.0.0', last_updated: '2024-01-01T00:00:00Z' },
          { name: '2.0.0', last_updated: '2024-02-01T00:00:00Z' },
          { name: '3.0.0', last_updated: '2024-03-01T00:00:00Z' },
        ],
        next: null,
      })) as unknown as typeof fetch;

    const response = await json(
      `/templates/${searchTemplate.id}/versions?search=1.0.0`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      versions: { value: string; origin: string; updatedAt?: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.versions).toEqual([
      { value: '1.0.0', origin: 'registry', updatedAt: '2024-01-01T00:00:00.000Z' },
    ]);
  });
});

const versionedTemplate: Template = {
  id: 'synthetic-versioned-app',
  version: 1,
  name: 'Synthetic with versions',
  tagline: 'Synthetic template for the deploy-version tests',
  category: 'test',
  tags: [],
  icon: 'icon.svg',
  author: 'zydock',
  origin: 'official',
  dockerCompose: 'docker-compose.yml',
  expose: { service: 'app', port: 80, domain: true },
  databases: [],
  inputs: [],
  secrets: [],
  versions: {
    key: 'APP_VERSION',
    default: '1',
    available: [{ value: '1' }, { value: '2', label: '2.x (stable)' }],
  },
  deprecated: false,
  dockerComposeContent: 'services:\n  app:\n    image: nginx:${APP_VERSION}\n',
};

describe('POST /templates/:templateId/deploy', () => {
  let organizationId = '';
  let environmentId = '';
  let projectId = '';

  beforeAll(() => {
    allTemplates().push(versionedTemplate);
  });

  afterAll(() => {
    const index = allTemplates().findIndex(template => template.id === versionedTemplate.id);

    if (index >= 0) {
      allTemplates().splice(index, 1);
    }
  });

  test('setup: org, project and environment', async () => {
    const org = await json('/organizations', 'POST', { name: 'Templates Deploy Co' }, token);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Templates Deploy Project' },
      token,
    );
    projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      token,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    expect(environmentId).toBeString();
  });

  test('rejects when the server has no Docker Compose plugin detected yet', async () => {
    const response = await json(
      '/templates/uptime-kuma/deploy',
      'POST',
      {
        organizationId,
        name: 'kuma-no-compose',
        environmentId,
        serverId: getLocalServerId(),
        inputs: {},
      },
      token,
    );

    expect(response.status).toBe(409);
  });

  test('creates the application without deploying when deployNow is false', async () => {
    await serverModel.updateOne(
      { _id: getLocalServerId() },
      { $set: { 'resources.composeVersion': 'v2.29.1' } },
    );

    const response = await json(
      '/templates/uptime-kuma/deploy',
      'POST',
      {
        organizationId,
        name: 'kuma-create-only',
        environmentId,
        serverId: getLocalServerId(),
        inputs: {},
        deployNow: false,
      },
      token,
    );
    const body = (await response.json()) as {
      application: {
        id: string;
        source: string;
        origin?: { templateId: string; templateVersion: number; inputs: Record<string, string> };
      };
      deployment?: unknown;
    };

    expect(response.status).toBe(201);
    expect(body.application.source).toBe('compose');
    expect(body.application.origin?.templateId).toBe('uptime-kuma');
    expect(body.application.origin?.templateVersion).toBe(3);
    expect(body.deployment).toBeUndefined();
  });

  test('creates the application and queues a deployment for a template with a database and secrets', async () => {
    const server = await serverModel.findById(getLocalServerId());

    const databaseTemplate: Template = {
      id: 'synthetic-database-app',
      version: 1,
      name: 'Synthetic with database',
      tagline: 'Synthetic template for the database + secrets test',
      category: 'test',
      tags: [],
      icon: 'icon.svg',
      author: 'zydock',
      origin: 'official',
      dockerCompose: 'docker-compose.yml',
      expose: { service: 'app', port: 80, domain: true },
      databases: [
        {
          service: 'db',
          engine: 'postgresql',
          credentials: {
            username: { value: 'postgres' },
            password: { key: 'POSTGRES_PASSWORD' },
            database: { value: 'postgres' },
          },
        },
      ],
      inputs: [],
      secrets: [{ key: 'POSTGRES_PASSWORD', generate: 'password' }],
      deprecated: false,
      dockerComposeContent:
        'services:\n' +
        '  app:\n' +
        '    image: nginx:1.27\n' +
        '    environment:\n' +
        '      DB_PASSWORD: ${POSTGRES_PASSWORD}\n' +
        '  db:\n' +
        '    image: postgres:16-alpine\n' +
        '    environment:\n' +
        '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}\n',
    };

    const { application, deployment } = await deployTemplateApplication({
      template: databaseTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'synthetic-database-app',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: true,
      },
      triggeredBy: userId,
    });

    expect(deployment?.status).toBe('queued');

    const variables = await json(
      `/organizations/${organizationId}/applications/${application._id}/variables`,
      'GET',
      undefined,
      token,
    );
    const variablesBody = (await variables.json()) as {
      variables: { key: string; value: string; secret: boolean }[];
    };
    const password = variablesBody.variables.find(variable => variable.key === 'POSTGRES_PASSWORD');
    const slugVariable = variablesBody.variables.find(
      variable => variable.key === 'ZYDOCK_APPLICATION_SLUG',
    );

    expect(password?.secret).toBe(true);
    expect(password?.value.length).toBeGreaterThan(0);
    expect(slugVariable?.secret).toBe(false);

    const registered = await databaseModel.findOne({ 'link.applicationId': application._id });

    expect(registered).not.toBeNull();
    expect(registered!.source).toBe('compose');
    expect(registered!.engine).toBe('postgresql');
    expect(registered!.containerName).toBe(composeContainerNameOf(application.slug, 'db'));

    const list = await json(
      `/organizations/${organizationId}/databases?serverId=${getLocalServerId()}`,
      'GET',
      undefined,
      token,
    );
    const listBody = (await list.json()) as { items: { id: string; source: string }[] };

    expect(listBody.items.some(item => item.id === String(registered!._id))).toBe(true);
    expect(listBody.items.find(item => item.id === String(registered!._id))?.source).toBe(
      'compose',
    );

    const credentials = await json(
      `/organizations/${organizationId}/databases/${registered!._id}/credentials`,
      'GET',
      undefined,
      token,
    );
    const credentialsBody = (await credentials.json()) as {
      credentials: {
        host: string;
        port: number;
        username: string;
        database: string;
        password: string;
      };
    };

    expect(credentials.status).toBe(200);
    expect(credentialsBody.credentials.host).toBe(composeContainerNameOf(application.slug, 'db'));
    expect(credentialsBody.credentials.port).toBe(5432);
    expect(credentialsBody.credentials.username).toBe('postgres');
    expect(credentialsBody.credentials.password).toBe(password!.value);

    await removeApplication(String(application._id));

    expect(await databaseModel.findOne({ 'link.applicationId': application._id })).toBeNull();
  });

  test('rejects a template deploy from a member without admin rights', async () => {
    const memberEmail = `templates-member-${Date.now()}@zydock.test`;
    const memberPassword = 'templates-member-secret-1';

    const member = await userModel.create({
      email: memberEmail,
      name: 'templates-member',
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
      '/templates/uptime-kuma/deploy',
      'POST',
      {
        organizationId,
        name: 'kuma-member',
        environmentId,
        serverId: getLocalServerId(),
        inputs: {},
      },
      memberToken,
    );

    expect(response.status).toBe(403);

    await userModel.deleteOne({ _id: member._id });
  });

  test('the service layer rejects a required input left unanswered', async () => {
    const server = await serverModel.findById(getLocalServerId());
    const environment = await findEnvironmentOfOrganization(organizationId, environmentId);

    const requiredInputTemplate: Template = {
      id: 'synthetic-required-input',
      version: 1,
      name: 'Synthetic',
      tagline: 'Synthetic template for the required-input test',
      category: 'test',
      tags: [],
      icon: 'icon.svg',
      author: 'zydock',
      origin: 'official',
      dockerCompose: 'docker-compose.yml',
      expose: { service: 'app', port: 80, domain: true },
      databases: [],
      inputs: [{ key: 'API_KEY', label: 'API key', type: 'text', required: true }],
      secrets: [],
      deprecated: false,
      dockerComposeContent: 'services:\n  app:\n    image: nginx:1.27\n',
    };

    await expect(
      deployTemplateApplication({
        template: requiredInputTemplate,
        organizationId,
        projectId,
        server: server!,
        body: {
          organizationId,
          name: 'synthetic-required-input-app',
          environmentId,
          serverId: getLocalServerId()!,
          inputs: {},
          deployNow: false,
        },
        triggeredBy: 'test-user',
      }),
    ).rejects.toThrow(/Input "API_KEY" is required/);

    expect(String(environment!.projectId)).toBe(projectId);
  });

  test('deploys with the default version when none is chosen', async () => {
    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: versionedTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'synthetic-versioned-default',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: userId,
    });

    const raw = await applicationModel.findById(application._id).select('+variables.value');
    const variable = raw!.variables.find(item => item.key === 'APP_VERSION');

    expect(variable?.secret).toBe(false);
    expect(decryptSecret(variable!.value)).toBe('1');
  });

  test('deploys with the version explicitly chosen', async () => {
    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: versionedTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'synthetic-versioned-chosen',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        version: '2',
        deployNow: false,
      },
      triggeredBy: userId,
    });

    const raw = await applicationModel.findById(application._id).select('+variables.value');
    const variable = raw!.variables.find(item => item.key === 'APP_VERSION');

    expect(decryptSecret(variable!.value)).toBe('2');
    expect(application.origin?.inputs).not.toHaveProperty('APP_VERSION');
    expect(serializeApplication(application).version).toEqual({
      key: 'APP_VERSION',
      current: '2',
    });
  });

  test('rejects an invalid version naming the valid options', async () => {
    const server = await serverModel.findById(getLocalServerId());

    await expect(
      deployTemplateApplication({
        template: versionedTemplate,
        organizationId,
        projectId,
        server: server!,
        body: {
          organizationId,
          name: 'synthetic-versioned-invalid',
          environmentId,
          serverId: getLocalServerId()!,
          inputs: {},
          version: '99',
          deployNow: false,
        },
        triggeredBy: userId,
      }),
    ).rejects.toThrow('"version" must be one of: 1, 2');
  });

  test('rejects the version key submitted as a plain input', async () => {
    const server = await serverModel.findById(getLocalServerId());

    await expect(
      deployTemplateApplication({
        template: versionedTemplate,
        organizationId,
        projectId,
        server: server!,
        body: {
          organizationId,
          name: 'synthetic-versioned-as-input',
          environmentId,
          serverId: getLocalServerId()!,
          inputs: { APP_VERSION: '2' },
          deployNow: false,
        },
        triggeredBy: userId,
      }),
    ).rejects.toThrow(/"APP_VERSION" is the version selector/);
  });

  test('a template without "versions" keeps working unaffected', async () => {
    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: {
        ...versionedTemplate,
        id: 'synthetic-unversioned-app',
        versions: undefined,
        dockerComposeContent: 'services:\n  app:\n    image: nginx:1.27\n',
      },
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'synthetic-unversioned',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        version: '2',
        deployNow: false,
      },
      triggeredBy: userId,
    });

    const raw = await applicationModel.findById(application._id).select('+variables.value');

    expect(raw!.variables.some(item => item.key === 'APP_VERSION')).toBe(false);
  });
});

describe('template secrets never leak', () => {
  let organizationId = '';
  let environmentId = '';
  let applicationId = '';
  let secretValue = '';

  const originalFetch = globalThis.fetch;

  const jsonResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const sse = (events: { event: string; data: unknown }[]) =>
    new Response(
      events
        .map(entry => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`)
        .join(''),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

  const restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  const installMock = (options: {
    config: { valid: boolean; output?: string; error?: string };
    logLines: string[];
  }) => {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const path = url.pathname;

      if (method === 'POST' && /\/api\/compose\/[^/]+\/files$/.test(path)) {
        return jsonResponse({ project: 'secrets-app', path: '/tmp', files: [] }, 201);
      }

      if (method === 'GET' && /\/api\/compose\/[^/]+\/config$/.test(path)) {
        return jsonResponse({
          valid: options.config.valid,
          output: options.config.output ?? '',
          error: options.config.error,
        });
      }

      if (method === 'POST' && /\/api\/compose\/[^/]+\/(pull|up)$/.test(path)) {
        return sse([
          ...options.logLines.map(message => ({
            event: 'log',
            data: { stream: 'stdout', message },
          })),
          { event: 'result', data: { project: 'secrets-app' } },
        ]);
      }

      if (method === 'GET' && /\/api\/compose\/[^/]+\/ps$/.test(path)) {
        return jsonResponse([
          { name: 'app-1', service: 'app', state: 'running', health: 'none', publishers: [] },
          { name: 'db-1', service: 'db', state: 'running', health: 'none', publishers: [] },
        ]);
      }

      if (method === 'GET' && /\/api\/containers\/[^/]+$/.test(path)) {
        return jsonResponse({
          id: 'container-id',
          name: 'app-1',
          image: 'nginx:1.27',
          state: 'running',
          health: 'none',
          restartCount: 0,
          ports: [],
          labels: {},
        });
      }

      throw new Error(`Unhandled agent request in test mock: ${method} ${path}`);
    }) as typeof fetch;
  };

  test('setup: org, project, environment and a template deploy with generated secrets', async () => {
    const org = await json('/organizations', 'POST', { name: 'Secrets Co' }, token);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Secrets Project' },
      token,
    );
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      token,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    await serverModel.updateOne(
      { _id: getLocalServerId() },
      { $set: { 'resources.composeVersion': 'v2.29.1' } },
    );

    const server = await serverModel.findById(getLocalServerId());

    const secretsTemplate: Template = {
      id: 'synthetic-secrets-app',
      version: 1,
      name: 'Synthetic with secrets',
      tagline: 'Synthetic template for the secret-masking tests',
      category: 'test',
      tags: [],
      icon: 'icon.svg',
      author: 'zydock',
      origin: 'official',
      dockerCompose: 'docker-compose.yml',
      expose: { service: 'app', port: 80, domain: true },
      databases: [
        {
          service: 'db',
          engine: 'postgresql',
          credentials: {
            username: { value: 'postgres' },
            password: { key: 'POSTGRES_PASSWORD' },
            database: { value: 'postgres' },
          },
        },
      ],
      inputs: [],
      secrets: [
        { key: 'POSTGRES_PASSWORD', generate: 'password' },
        { key: 'APP_ENCRYPTION_KEY', generate: 'hex32' },
      ],
      deprecated: false,
      dockerComposeContent:
        'services:\n' +
        '  app:\n' +
        '    image: nginx:1.27\n' +
        '    environment:\n' +
        '      DB_PASSWORD: ${POSTGRES_PASSWORD}\n' +
        '      ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY}\n' +
        '  db:\n' +
        '    image: postgres:16-alpine\n' +
        '    environment:\n' +
        '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}\n',
    };

    const { application } = await deployTemplateApplication({
      template: secretsTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'synthetic-secrets-app',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: 'test-user',
    });

    applicationId = String(application._id);

    expect(application.origin?.inputs).not.toHaveProperty('POSTGRES_PASSWORD');
    expect(application.origin?.inputs).not.toHaveProperty('APP_ENCRYPTION_KEY');

    const raw = await applicationModel.findById(applicationId).select('+variables.value');

    expect(raw!.origin!.inputs).not.toHaveProperty('POSTGRES_PASSWORD');
    expect(raw!.origin!.inputs).not.toHaveProperty('APP_ENCRYPTION_KEY');

    const variables = await json(
      `/organizations/${organizationId}/applications/${applicationId}/variables`,
      'GET',
      undefined,
      token,
    );
    const variablesBody = (await variables.json()) as {
      variables: { key: string; value: string; secret: boolean }[];
    };

    secretValue = variablesBody.variables.find(
      variable => variable.key === 'POSTGRES_PASSWORD',
    )!.value;

    expect(secretValue.length).toBeGreaterThan(0);
  });

  test('a docker compose config failure never surfaces the secret value', async () => {
    installMock({
      config: { valid: false, error: `exit status 1: DB_POSTGRESDB_PASSWORD=${secretValue}` },
      logLines: [],
    });

    let deploymentId = '';

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${applicationId}/deploy`,
        'POST',
        {},
        token,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      deploymentId = body.deployment.id;

      await runDeployment(deploymentId);
    } finally {
      restoreFetch();
    }

    const response = await json(
      `/organizations/${organizationId}/deployments/${deploymentId}`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      deployment: {
        status: string;
        error?: string;
        steps: { step: string; detail?: string }[];
        log: string[];
      };
    };
    const raw = JSON.stringify(body);

    expect(body.deployment.status).toBe('failed');
    expect(raw).not.toContain(secretValue);
    expect(body.deployment.error).toContain('***');
  });

  test('pull and up output are masked before they ever become a deploy log line', async () => {
    installMock({
      config: {
        valid: true,
        output: 'services:\n  app:\n    image: nginx:1.27\n  db:\n    image: nginx:1.27\n',
      },
      logLines: [
        `pulling app: using DB_POSTGRESDB_PASSWORD=${secretValue}`,
        `container app-1 started with password ${secretValue}`,
      ],
    });

    let deploymentId = '';

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${applicationId}/deploy`,
        'POST',
        {},
        token,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      deploymentId = body.deployment.id;

      await runDeployment(deploymentId);
    } finally {
      restoreFetch();
    }

    const response = await json(
      `/organizations/${organizationId}/deployments/${deploymentId}`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      deployment: { status: string; log: string[] };
    };

    expect(body.deployment.status).toBe('succeeded');
    expect(body.deployment.log.join('\n')).not.toContain(secretValue);
    expect(body.deployment.log.some(line => line.includes('***'))).toBe(true);
  });

  test('the application document never holds the secret in the clear', async () => {
    const raw = await applicationModel.findById(applicationId).select('+variables.value');
    const stored = raw!.variables.find(variable => variable.key === 'POSTGRES_PASSWORD')!.value;

    expect(stored).not.toBe(secretValue);
    expect(stored).not.toContain(secretValue);
  });
});

describe('POST /applications/:applicationId/variables/:key/regenerate', () => {
  let organizationId = '';
  let environmentId = '';
  let applicationId = '';

  test('setup: deploy a template application without running the pipeline', async () => {
    const org = await json('/organizations', 'POST', { name: 'Rotation Co' }, token);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Rotation Project' },
      token,
    );
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      token,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    await serverModel.updateOne(
      { _id: getLocalServerId() },
      { $set: { 'resources.composeVersion': 'v2.29.1' } },
    );

    const server = await serverModel.findById(getLocalServerId());

    const secretsTemplate: Template = {
      id: 'synthetic-rotation-app',
      version: 1,
      name: 'Synthetic with secrets',
      tagline: 'Synthetic template for the rotation-guard tests',
      category: 'test',
      tags: [],
      icon: 'icon.svg',
      author: 'zydock',
      origin: 'official',
      dockerCompose: 'docker-compose.yml',
      expose: { service: 'app', port: 80, domain: true },
      databases: [],
      inputs: [],
      secrets: [{ key: 'API_KEY', generate: 'password' }],
      deprecated: false,
      dockerComposeContent:
        'services:\n' +
        '  app:\n' +
        '    image: nginx:1.27\n' +
        '    environment:\n' +
        '      API_KEY: ${API_KEY}\n',
    };

    const { application } = await deployTemplateApplication({
      template: secretsTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'synthetic-rotation-app',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: 'test-user',
    });

    applicationId = String(application._id);
  });

  test('rejects a key that is not a generated secret of the template', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}/variables/TIMEZONE/regenerate`,
      'POST',
      {},
      token,
    );

    expect(response.status).toBe(400);
  });

  test('rejects a non-template compose application', async () => {
    const create = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'plain-compose-app',
        environmentId,
        serverId: getLocalServerId(),
        compose: {
          content: 'services:\n  app:\n    image: nginx:1.27\n',
          expose: { service: 'app', port: 80 },
        },
        variables: [{ key: 'FOO', value: 'bar', secret: true }],
      },
      token,
    );
    const created = (await create.json()) as { application: { id: string } };

    const response = await json(
      `/organizations/${organizationId}/applications/${created.application.id}/variables/FOO/regenerate`,
      'POST',
      {},
      token,
    );

    expect(response.status).toBe(400);
  });
});

describe('POST /applications/:applicationId/version', () => {
  let organizationId = '';
  let environmentId = '';
  let projectId = '';
  let versionedApplicationId = '';
  let plainComposeApplicationId = '';
  let gitApplicationId = '';
  let unknownTemplateApplicationId = '';
  let noVersionsApplicationId = '';

  const catalogTemplate: Template = {
    ...versionedTemplate,
    id: 'synthetic-changeable-version-app',
  };

  beforeAll(() => {
    allTemplates().push(catalogTemplate);
  });

  afterAll(() => {
    const index = allTemplates().findIndex(template => template.id === catalogTemplate.id);

    if (index >= 0) {
      allTemplates().splice(index, 1);
    }
  });

  test('setup: org, project, environment and one application of every guarded shape', async () => {
    const org = await json('/organizations', 'POST', { name: 'Version Change Co' }, token);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Version Change Project' },
      token,
    );
    projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      token,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    await serverModel.updateOne(
      { _id: getLocalServerId() },
      { $set: { 'resources.composeVersion': 'v2.29.1' } },
    );

    const server = await serverModel.findById(getLocalServerId());

    const { application: versionedApplication } = await deployTemplateApplication({
      template: catalogTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'version-change-app',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: userId,
    });
    versionedApplicationId = String(versionedApplication._id);

    const composeApp = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'plain-compose-app-for-version',
        environmentId,
        serverId: getLocalServerId(),
        compose: {
          content: 'services:\n  app:\n    image: nginx:1.27\n',
          expose: { service: 'app', port: 80 },
        },
      },
      token,
    );
    plainComposeApplicationId = ((await composeApp.json()) as { application: { id: string } })
      .application.id;

    const gitApp = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'git',
        name: 'git-app-for-version',
        environmentId,
        serverId: getLocalServerId(),
        git: { repository: 'zydock/example', source: 'pat' },
        port: 3000,
      },
      token,
    );
    gitApplicationId = ((await gitApp.json()) as { application: { id: string } }).application.id;

    const { application: unknownTemplateApplication } = await deployTemplateApplication({
      template: { ...catalogTemplate, id: 'synthetic-template-not-in-catalog' },
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'unknown-template-app',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: userId,
    });
    unknownTemplateApplicationId = String(unknownTemplateApplication._id);

    const excalidrawDeploy = await json(
      '/templates/excalidraw/deploy',
      'POST',
      {
        organizationId,
        name: 'no-versions-app',
        environmentId,
        serverId: getLocalServerId(),
        inputs: {},
        deployNow: false,
      },
      token,
    );
    noVersionsApplicationId = ((await excalidrawDeploy.json()) as { application: { id: string } })
      .application.id;
  });

  test('404 for an unknown application', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/000000000000000000000000/version`,
      'POST',
      { version: '2' },
      token,
    );

    expect(response.status).toBe(404);
  });

  test('rejects a plain compose application without a template origin', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${plainComposeApplicationId}/version`,
      'POST',
      { version: '2' },
      token,
    );

    expect(response.status).toBe(400);
  });

  test('rejects a git application', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${gitApplicationId}/version`,
      'POST',
      { version: '2' },
      token,
    );

    expect(response.status).toBe(400);
  });

  test('rejects when the template is no longer in the catalog', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${unknownTemplateApplicationId}/version`,
      'POST',
      { version: '2' },
      token,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('no longer in the catalog');
  });

  test('rejects when the template has no selectable versions', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${noVersionsApplicationId}/version`,
      'POST',
      { version: '2' },
      token,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('no selectable versions');
  });

  test('rejects an invalid version, naming the valid options', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${versionedApplicationId}/version`,
      'POST',
      { version: '99' },
      token,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('"version" must be one of: 1, 2');
  });

  test('rejects when the application is already on that version', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${versionedApplicationId}/version`,
      'POST',
      { version: '1' },
      token,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('already running this version');
  });

  test('rejects a version change from a member without admin rights', async () => {
    const memberEmail = `version-change-member-${Date.now()}@zydock.test`;
    const memberPassword = 'version-change-member-secret-1';

    const member = await userModel.create({
      email: memberEmail,
      name: 'version-change-member',
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
      `/organizations/${organizationId}/applications/${versionedApplicationId}/version`,
      'POST',
      { version: '2' },
      memberToken,
    );

    expect(response.status).toBe(403);

    await userModel.deleteOne({ _id: member._id });
  });

  test('changes the version without deploying when deployNow is false', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${versionedApplicationId}/version`,
      'POST',
      { version: '2', deployNow: false },
      token,
    );
    const body = (await response.json()) as {
      application: { version?: { key: string; current: string } };
      deployment?: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.application.version).toEqual({ key: 'APP_VERSION', current: '2' });
    expect(body.deployment).toBeUndefined();

    const raw = await applicationModel.findById(versionedApplicationId).select('+variables.value');
    const variable = raw!.variables.find(item => item.key === 'APP_VERSION');

    expect(decryptSecret(variable!.value)).toBe('2');
  });

  test('changes the version and queues a deployment by default', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${versionedApplicationId}/version`,
      'POST',
      { version: '1' },
      token,
    );
    const body = (await response.json()) as {
      application: { version?: { key: string; current: string } };
      deployment?: { status: string };
    };

    expect(response.status).toBe(200);
    expect(body.application.version).toEqual({ key: 'APP_VERSION', current: '1' });
    expect(body.deployment?.status).toBe('queued');
  });
});

const registryPolicyRepository = `zydock-test/synthetic-policy-${Date.now()}`;

const registryPolicyTemplate: Template = {
  id: 'synthetic-policy-versioned-app',
  version: 1,
  name: 'Synthetic with registry policy',
  tagline: 'Synthetic template for the version-policy tests',
  category: 'test',
  tags: [],
  icon: 'icon.svg',
  author: 'zydock',
  origin: 'official',
  dockerCompose: 'docker-compose.yml',
  expose: { service: 'app', port: 80, domain: true },
  databases: [],
  inputs: [],
  secrets: [],
  versions: {
    key: 'APP_VERSION',
    default: '1',
    available: [{ value: '1' }],
    registry: { limit: 50 },
  },
  deprecated: false,
  dockerComposeContent: `services:\n  app:\n    image: ${registryPolicyRepository}:\${APP_VERSION}\n`,
};

describe('version policy: registry tags on deploy and version change (Fase 4)', () => {
  const originalFetch = globalThis.fetch;
  let organizationId = '';
  let environmentId = '';
  let projectId = '';

  beforeAll(async () => {
    allTemplates().push(registryPolicyTemplate);

    const org = await json('/organizations', 'POST', { name: 'Version Policy Co' }, token);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Version Policy Project' },
      token,
    );
    projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      token,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;
  });

  afterAll(() => {
    const index = allTemplates().findIndex(template => template.id === registryPolicyTemplate.id);

    if (index >= 0) {
      allTemplates().splice(index, 1);
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('deploys with a tag that only exists in the registry, once the manifest HEAD confirms it', async () => {
    globalThis.fetch = (async (url: string, init?: { method?: string }) => {
      expect(init?.method).toBe('HEAD');
      expect(url).toContain(`/repositories/${registryPolicyRepository}/tags/2.4.0/`);

      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: registryPolicyTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'policy-deploy-registry-tag',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        version: '2.4.0',
        deployNow: false,
      },
      triggeredBy: userId,
    });

    const raw = await applicationModel.findById(application._id).select('+variables.value');
    const variable = raw!.variables.find(item => item.key === 'APP_VERSION');

    expect(decryptSecret(variable!.value)).toBe('2.4.0');
  });

  test('rejects a tag outside the "include" policy without listing every option', async () => {
    const server = await serverModel.findById(getLocalServerId());

    await expect(
      deployTemplateApplication({
        template: registryPolicyTemplate,
        organizationId,
        projectId,
        server: server!,
        body: {
          organizationId,
          name: 'policy-deploy-bad-tag',
          environmentId,
          serverId: getLocalServerId()!,
          inputs: {},
          version: 'nightly',
          deployNow: false,
        },
        triggeredBy: userId,
      }),
    ).rejects.toThrow(/must match/);
  });

  test('rejects "latest" even with a registry policy configured', async () => {
    const server = await serverModel.findById(getLocalServerId());

    await expect(
      deployTemplateApplication({
        template: registryPolicyTemplate,
        organizationId,
        projectId,
        server: server!,
        body: {
          organizationId,
          name: 'policy-deploy-latest',
          environmentId,
          serverId: getLocalServerId()!,
          inputs: {},
          version: 'latest',
          deployNow: false,
        },
        triggeredBy: userId,
      }),
    ).rejects.toThrow(/not an allowed version/);
  });

  test('does not block the deploy when the registry does not answer the existence check', async () => {
    globalThis.fetch = (async () => {
      throw new Error('registry unreachable');
    }) as unknown as typeof fetch;

    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: registryPolicyTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'policy-deploy-outage',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        version: '3.0.0',
        deployNow: false,
      },
      triggeredBy: userId,
    });

    const raw = await applicationModel.findById(application._id).select('+variables.value');
    const variable = raw!.variables.find(item => item.key === 'APP_VERSION');

    expect(decryptSecret(variable!.value)).toBe('3.0.0');
  });

  test('blocks the deploy when the manifest HEAD confirms the tag is missing (404)', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    const server = await serverModel.findById(getLocalServerId());

    await expect(
      deployTemplateApplication({
        template: registryPolicyTemplate,
        organizationId,
        projectId,
        server: server!,
        body: {
          organizationId,
          name: 'policy-deploy-missing-tag',
          environmentId,
          serverId: getLocalServerId()!,
          inputs: {},
          version: '4.5.6',
          deployNow: false,
        },
        triggeredBy: userId,
      }),
    ).rejects.toThrow(/was not found in the registry/);
  });

  test('changing the version also accepts a registry tag once the manifest HEAD confirms it', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: registryPolicyTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'policy-change-base',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: userId,
    });

    const response = await json(
      `/organizations/${organizationId}/applications/${String(application._id)}/version`,
      'POST',
      { version: '2.7.0', deployNow: false },
      token,
    );
    const body = (await response.json()) as {
      application: { version?: { key: string; current: string } };
    };

    expect(response.status).toBe(200);
    expect(body.application.version).toEqual({ key: 'APP_VERSION', current: '2.7.0' });
  });

  test('changing the version blocks when the manifest HEAD confirms the tag is missing (404)', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: registryPolicyTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'policy-change-missing-tag-base',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: userId,
    });

    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    const response = await json(
      `/organizations/${organizationId}/applications/${String(application._id)}/version`,
      'POST',
      { version: '9.9.9', deployNow: false },
      token,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('was not found in the registry');
  });
});

describe('GET /applications/:applicationId/template-update', () => {
  let organizationId = '';
  let environmentId = '';
  let projectId = '';
  let plainComposeApplicationId = '';
  let gitApplicationId = '';

  const installedTemplate: Template = {
    id: 'synthetic-update-preview-app',
    version: 1,
    name: 'Synthetic update preview',
    tagline: 'Synthetic template for the template-update preview tests',
    category: 'test',
    tags: [],
    icon: 'icon.svg',
    author: 'zydock',
    origin: 'official',
    dockerCompose: 'docker-compose.yml',
    expose: { service: 'app', port: 80, domain: true },
    databases: [],
    inputs: [],
    secrets: [],
    deprecated: false,
    dockerComposeContent: 'services:\n  app:\n    image: nginx:1.27\n',
  };

  const catalogTemplate: Template = { ...installedTemplate };

  let templateApplicationId = '';

  beforeAll(() => {
    allTemplates().push(catalogTemplate);
  });

  afterAll(() => {
    const index = allTemplates().findIndex(template => template.id === catalogTemplate.id);

    if (index >= 0) {
      allTemplates().splice(index, 1);
    }
  });

  test('setup: org, project, environment and one application of every guarded shape', async () => {
    const org = await json('/organizations', 'POST', { name: 'Template Update Preview Co' }, token);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Template Update Preview Project' },
      token,
    );
    projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      token,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    await serverModel.updateOne(
      { _id: getLocalServerId() },
      { $set: { 'resources.composeVersion': 'v2.29.1' } },
    );

    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: installedTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'template-update-preview-app',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: userId,
    });
    templateApplicationId = String(application._id);

    const composeApp = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'plain-compose-app-for-update-preview',
        environmentId,
        serverId: getLocalServerId(),
        compose: {
          content: 'services:\n  app:\n    image: nginx:1.27\n',
          expose: { service: 'app', port: 80 },
        },
      },
      token,
    );
    plainComposeApplicationId = ((await composeApp.json()) as { application: { id: string } })
      .application.id;

    const gitApp = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'git',
        name: 'git-app-for-update-preview',
        environmentId,
        serverId: getLocalServerId(),
        git: { repository: 'zydock/example', source: 'pat' },
        port: 3000,
      },
      token,
    );
    gitApplicationId = ((await gitApp.json()) as { application: { id: string } }).application.id;
  });

  test('404 for an unknown application', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/000000000000000000000000/template-update`,
      'GET',
      undefined,
      token,
    );

    expect(response.status).toBe(404);
  });

  test('rejects a plain compose application without a template origin', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${plainComposeApplicationId}/template-update`,
      'GET',
      undefined,
      token,
    );

    expect(response.status).toBe(400);
  });

  test('rejects a git application', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${gitApplicationId}/template-update`,
      'GET',
      undefined,
      token,
    );

    expect(response.status).toBe(400);
  });

  test('"up-to-date" when the catalog is on the same version, with no compose diff', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${templateApplicationId}/template-update`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      status: string;
      installedVersion: number;
      availableVersion: number;
      manuallyEdited: boolean;
      composeDiff: { type: string; content: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('up-to-date');
    expect(body.installedVersion).toBe(1);
    expect(body.availableVersion).toBe(1);
    expect(body.manuallyEdited).toBe(false);
    expect(body.composeDiff.every(line => line.type === 'context')).toBe(true);
  });

  test('"update-available" once the catalog version moves ahead, with the diff and no removed variables', async () => {
    catalogTemplate.version = 2;
    catalogTemplate.dockerComposeContent = 'services:\n  app:\n    image: nginx:1.28\n';

    const response = await json(
      `/organizations/${organizationId}/applications/${templateApplicationId}/template-update`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      status: string;
      installedVersion: number;
      availableVersion: number;
      composeDiff: { type: string; content: string }[];
      variables: { added: string[]; removed: string[] };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('update-available');
    expect(body.installedVersion).toBe(1);
    expect(body.availableVersion).toBe(2);
    expect(body.composeDiff.some(line => line.type === 'removed')).toBe(true);
    expect(body.composeDiff.some(line => line.type === 'added')).toBe(true);
    expect(body.variables).toEqual({ added: [], removed: [] });
  });

  test('flags the compose as manually edited once it diverges from the recorded hash', async () => {
    await json(
      `/organizations/${organizationId}/applications/${templateApplicationId}`,
      'PATCH',
      { compose: { content: 'services:\n  app:\n    image: nginx:1.27\n    restart: always\n' } },
      token,
    );

    const response = await json(
      `/organizations/${organizationId}/applications/${templateApplicationId}/template-update`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as { manuallyEdited: boolean };

    expect(response.status).toBe(200);
    expect(body.manuallyEdited).toBe(true);
  });

  test('"deprecated" when the template is still in the catalog but taken off the storefront', async () => {
    catalogTemplate.deprecated = true;

    const response = await json(
      `/organizations/${organizationId}/applications/${templateApplicationId}/template-update`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('deprecated');

    catalogTemplate.deprecated = false;
  });

  test('"unknown" once the template leaves the catalog entirely, with no compose diff or available version', async () => {
    const index = allTemplates().findIndex(template => template.id === catalogTemplate.id);

    allTemplates().splice(index, 1);

    const response = await json(
      `/organizations/${organizationId}/applications/${templateApplicationId}/template-update`,
      'GET',
      undefined,
      token,
    );
    const body = (await response.json()) as {
      status: string;
      availableVersion?: number;
      composeDiff?: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('unknown');
    expect(body.availableVersion).toBeUndefined();
    expect(body.composeDiff).toBeUndefined();

    allTemplates().push(catalogTemplate);
  });
});

describe('POST /applications/:applicationId/template-update', () => {
  let organizationId = '';
  let environmentId = '';
  let projectId = '';
  let applicationId = '';
  let plainComposeApplicationId = '';
  let gitApplicationId = '';

  const v2ComposeContent =
    'services:\n' +
    '  app:\n' +
    '    image: nginx:${APP_VERSION}\n' +
    '    environment:\n' +
    '      TZ: ${TIMEZONE}\n' +
    '      API_KEY: ${API_KEY}\n' +
    '      DB_PASSWORD: ${DB_PASSWORD}\n' +
    '  db:\n' +
    '    image: postgres:16-alpine\n' +
    '    environment:\n' +
    '      POSTGRES_PASSWORD: ${DB_PASSWORD}\n';

  const installedTemplate: Template = {
    id: 'synthetic-apply-update-app',
    version: 1,
    name: 'Synthetic apply update',
    tagline: 'Synthetic template for the apply-template-update tests',
    category: 'test',
    tags: [],
    icon: 'icon.svg',
    author: 'zydock',
    origin: 'official',
    dockerCompose: 'docker-compose.yml',
    expose: { service: 'app', port: 80, domain: true },
    databases: [],
    inputs: [{ key: 'TIMEZONE', label: 'Timezone', type: 'text', required: false }],
    secrets: [],
    versions: {
      key: 'APP_VERSION',
      default: '1',
      available: [{ value: '1' }],
    },
    deprecated: false,
    dockerComposeContent:
      'services:\n' +
      '  app:\n' +
      '    image: nginx:${APP_VERSION}\n' +
      '    environment:\n' +
      '      TZ: ${TIMEZONE}\n',
  };

  const catalogTemplate: Template = { ...installedTemplate };

  beforeAll(() => {
    allTemplates().push(catalogTemplate);
  });

  afterAll(() => {
    const index = allTemplates().findIndex(template => template.id === catalogTemplate.id);

    if (index >= 0) {
      allTemplates().splice(index, 1);
    }
  });

  test('setup: org, project, environment and one application of every guarded shape', async () => {
    const org = await json('/organizations', 'POST', { name: 'Apply Update Co' }, token);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Apply Update Project' },
      token,
    );
    projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      token,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    await serverModel.updateOne(
      { _id: getLocalServerId() },
      { $set: { 'resources.composeVersion': 'v2.29.1' } },
    );

    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: installedTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'apply-update-app',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: { TIMEZONE: 'UTC' },
        deployNow: false,
      },
      triggeredBy: userId,
    });
    applicationId = String(application._id);

    const composeApp = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'plain-compose-app-for-apply-update',
        environmentId,
        serverId: getLocalServerId(),
        compose: {
          content: 'services:\n  app:\n    image: nginx:1.27\n',
          expose: { service: 'app', port: 80 },
        },
      },
      token,
    );
    plainComposeApplicationId = ((await composeApp.json()) as { application: { id: string } })
      .application.id;

    const gitApp = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'git',
        name: 'git-app-for-apply-update',
        environmentId,
        serverId: getLocalServerId(),
        git: { repository: 'zydock/example', source: 'pat' },
        port: 3000,
      },
      token,
    );
    gitApplicationId = ((await gitApp.json()) as { application: { id: string } }).application.id;
  });

  test('404 for an unknown application', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/000000000000000000000000/template-update`,
      'POST',
      {},
      token,
    );

    expect(response.status).toBe(404);
  });

  test('rejects a plain compose application without a template origin', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${plainComposeApplicationId}/template-update`,
      'POST',
      {},
      token,
    );

    expect(response.status).toBe(400);
  });

  test('rejects a git application', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${gitApplicationId}/template-update`,
      'POST',
      {},
      token,
    );

    expect(response.status).toBe(400);
  });

  test('rejects when the application is already on the latest template version', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}/template-update`,
      'POST',
      {},
      token,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('already on the latest template version');
  });

  test('rejects an update from a member without admin rights', async () => {
    catalogTemplate.version = 2;

    const memberEmail = `apply-update-member-${Date.now()}@zydock.test`;
    const memberPassword = 'apply-update-member-secret-1';

    const member = await userModel.create({
      email: memberEmail,
      name: 'apply-update-member',
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
      `/organizations/${organizationId}/applications/${applicationId}/template-update`,
      'POST',
      {},
      memberToken,
    );

    expect(response.status).toBe(403);

    await userModel.deleteOne({ _id: member._id });
  });

  test('blocks with 400 when the new template requires an input that was never answered', async () => {
    catalogTemplate.inputs = [
      { key: 'TIMEZONE', label: 'Timezone', type: 'text', required: false },
      { key: 'API_KEY', label: 'API key', type: 'text', required: true },
    ];
    catalogTemplate.secrets = [{ key: 'DB_PASSWORD', generate: 'password' }];
    catalogTemplate.databases = [
      {
        service: 'db',
        engine: 'postgresql',
        credentials: {
          username: { value: 'postgres' },
          password: { key: 'DB_PASSWORD' },
          database: { value: 'postgres' },
        },
      },
    ];
    catalogTemplate.versions = { key: 'APP_VERSION', default: '2', available: [{ value: '2' }] };
    catalogTemplate.dockerComposeContent = v2ComposeContent;

    const response = await json(
      `/organizations/${organizationId}/applications/${applicationId}/template-update`,
      'POST',
      {},
      token,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('Missing required input(s)');
    expect(body.error).toContain('API_KEY');
  });

  test(
    'applies the update: preserves the existing variable, generates the new secret, registers ' +
      'the new database and falls the version back to the default',
    async () => {
      const response = await json(
        `/organizations/${organizationId}/applications/${applicationId}/template-update`,
        'POST',
        { inputs: { API_KEY: 'abc123' }, deployNow: false },
        token,
      );
      const body = (await response.json()) as {
        application: {
          origin?: { templateVersion: number; inputs: Record<string, string> };
          version?: { key: string; current: string };
        };
        deployment?: unknown;
        versionFellBackToDefault: boolean;
      };

      expect(response.status).toBe(200);
      expect(body.application.origin?.templateVersion).toBe(2);
      expect(body.application.origin?.inputs).toEqual({ TIMEZONE: 'UTC', API_KEY: 'abc123' });
      expect(body.application.version).toEqual({ key: 'APP_VERSION', current: '2' });
      expect(body.versionFellBackToDefault).toBe(true);
      expect(body.deployment).toBeUndefined();

      const variables = await json(
        `/organizations/${organizationId}/applications/${applicationId}/variables`,
        'GET',
        undefined,
        token,
      );
      const variablesBody = (await variables.json()) as {
        variables: { key: string; value: string; secret: boolean }[];
      };

      const timezone = variablesBody.variables.find(variable => variable.key === 'TIMEZONE');
      const dbPassword = variablesBody.variables.find(variable => variable.key === 'DB_PASSWORD');

      expect(timezone?.value).toBe('UTC');
      expect(dbPassword?.secret).toBe(true);
      expect(dbPassword?.value.length).toBeGreaterThan(0);

      const registered = await databaseModel.findOne({ 'link.applicationId': applicationId });

      expect(registered).not.toBeNull();
      expect(registered!.engine).toBe('postgresql');
      expect(registered!.link!.service).toBe('db');
    },
  );

  test('blocks with 409 when the compose file was edited by hand, and applies with confirmOverwrite', async () => {
    catalogTemplate.version = 3;
    catalogTemplate.dockerComposeContent = `# v3\n${v2ComposeContent}`;
    catalogTemplate.versions = {
      key: 'APP_VERSION',
      default: '2',
      available: [{ value: '2' }, { value: '3' }],
    };

    await json(
      `/organizations/${organizationId}/applications/${applicationId}`,
      'PATCH',
      { compose: { content: `${v2ComposeContent}    # hand-edited\n` } },
      token,
    );

    const blocked = await json(
      `/organizations/${organizationId}/applications/${applicationId}/template-update`,
      'POST',
      { deployNow: false },
      token,
    );
    const blockedBody = (await blocked.json()) as { error: string };

    expect(blocked.status).toBe(409);
    expect(blockedBody.error).toContain('confirmOverwrite');

    const confirmed = await json(
      `/organizations/${organizationId}/applications/${applicationId}/template-update`,
      'POST',
      { confirmOverwrite: true, deployNow: false },
      token,
    );
    const confirmedBody = (await confirmed.json()) as {
      application: { origin?: { templateVersion: number }; version?: { current: string } };
      versionFellBackToDefault: boolean;
    };

    expect(confirmed.status).toBe(200);
    expect(confirmedBody.application.origin?.templateVersion).toBe(3);
    expect(confirmedBody.application.version?.current).toBe('2');
    expect(confirmedBody.versionFellBackToDefault).toBe(false);

    const raw = await applicationModel.findById(applicationId);

    expect(raw!.compose!.content).toBe(catalogTemplate.dockerComposeContent);
  });
});
