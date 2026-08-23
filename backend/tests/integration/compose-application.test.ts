import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { createApp, stopBackgroundWork, waitForBootstrap } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { runDeployment } from '../../src/modules/deployments/pipeline.service';
import applicationModel from '../../src/modules/applications/application.model';
import {
  ensureLocalServer,
  getLocalServerId,
} from '../../src/modules/servers/local-server.service';
import serverModel from '../../src/modules/servers/server.model';
import { allTemplates } from '../../src/modules/templates/catalog.service';
import { deployTemplateApplication } from '../../src/modules/templates/template.service';

let app: ReturnType<typeof createApp>;

const email = `it-compose-${Date.now()}@zydock.test`;
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

const oneServiceCompose = `services:\n  app:\n    image: nginx:1.27\n    ports:\n      - "8081:80"\n`;

const twoServiceCompose = `services:\n  app:\n    image: nginx:1.27\n    depends_on:\n      db:\n        condition: service_healthy\n  db:\n    image: postgres:16-alpine\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres"]\n`;

const originalFetch = globalThis.fetch;

const composeServiceRow = (service: string, slug: string) => ({
  name: `zydock-${slug}-${service}-1`,
  service,
  state: 'running',
  health: 'none',
  publishers: [],
});

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const sseResult = (data: unknown) =>
  new Response(`event: result\ndata: ${JSON.stringify(data)}\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

let currentSlug = '';
let currentServices: string[] = [];

const installAgentMock = () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (method === 'POST' && /\/api\/compose\/[^/]+\/files$/.test(path)) {
      return jsonResponse({ project: currentSlug, path: '/tmp', files: [] }, 201);
    }

    if (method === 'GET' && /\/api\/compose\/[^/]+\/config$/.test(path)) {
      const output = `services:\n${currentServices
        .map(service => `  ${service}:\n    image: nginx:1.27\n`)
        .join('')}`;

      return jsonResponse({ valid: true, output });
    }

    if (method === 'POST' && /\/api\/compose\/[^/]+\/(pull|up)$/.test(path)) {
      return sseResult({ project: currentSlug });
    }

    if (method === 'GET' && /\/api\/compose\/[^/]+\/ps$/.test(path)) {
      return jsonResponse(currentServices.map(service => composeServiceRow(service, currentSlug)));
    }

    if (method === 'POST' && /\/api\/compose\/[^/]+\/down$/.test(path)) {
      return jsonResponse({ message: 'Compose project stopped' });
    }

    if (method === 'GET' && /\/api\/containers\/[^/]+$/.test(path)) {
      return jsonResponse({
        id: 'container-id',
        name: decodeURIComponent(path.split('/').pop() ?? ''),
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

const restoreFetch = () => {
  globalThis.fetch = originalFetch;
};

beforeAll(async () => {
  await connectDatabase();
  await ensureLocalServer();
  app = createApp();
  await waitForBootstrap();
});

afterAll(async () => {
  restoreFetch();
  stopBackgroundWork();
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
});

describe('compose applications', () => {
  let organizationId = '';
  let serverId = '';
  let environmentId = '';
  let applicationId = '';
  let firstDeploymentId = '';

  test('setup: org, local server, project and environment', async () => {
    const signup = await json('/auth/signup', 'POST', { name: 'Compose IT', email, password });
    accessToken = ((await signup.json()) as { accessToken: string }).accessToken;

    const org = await json('/organizations', 'POST', { name: 'Compose Co' }, accessToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    serverId = getLocalServerId()!;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Compose Project' },
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

    expect(environmentId).toBeString();
  });

  test('rejects a compose file that does not declare the exposed service', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'bad-expose',
        environmentId,
        serverId,
        compose: { content: oneServiceCompose, expose: { service: 'missing', port: 80 } },
      },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('rejects an invalid docker-compose.yml', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'bad-yaml',
        environmentId,
        serverId,
        compose: { content: 'not: [valid', expose: { service: 'app', port: 80 } },
      },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  test('rejects a hostile compose file (privileged container)', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'bad-privileged',
        environmentId,
        serverId,
        compose: {
          content:
            'services:\n  app:\n    image: nginx:1.27\n    privileged: true\n    ports:\n      - "8082:80"\n',
          expose: { service: 'app', port: 80 },
        },
      },
      accessToken,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };

    expect(body.error).toContain('privileged');
  });

  test('creates a compose application from a pasted docker-compose.yml', async () => {
    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'my-compose-app',
        environmentId,
        serverId,
        compose: { content: oneServiceCompose, expose: { service: 'app', port: 80 } },
      },
      accessToken,
    );
    const body = (await response.json()) as {
      application: { id: string; slug: string; source: string; port: number };
    };

    expect(response.status).toBe(201);
    expect(body.application.source).toBe('compose');
    expect(body.application.port).toBe(80);

    applicationId = body.application.id;
    currentSlug = body.application.slug;
    currentServices = ['app'];
  });

  test('deploy renders, pulls and starts the compose project', async () => {
    installAgentMock();

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${applicationId}/deploy`,
        'POST',
        {},
        accessToken,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      expect(deploy.status).toBe(202);

      firstDeploymentId = body.deployment.id;

      await runDeployment(firstDeploymentId);
    } finally {
      restoreFetch();
    }

    const status = await json(
      `/organizations/${organizationId}/deployments/${firstDeploymentId}`,
      'GET',
      undefined,
      accessToken,
    );
    const detail = (await status.json()) as {
      deployment: { status: string; steps: { step: string; status: string }[] };
    };

    expect(detail.deployment.status).toBe('succeeded');

    const steps = detail.deployment.steps.map(step => step.step);

    expect(steps).toEqual(['render', 'pull', 'container', 'proxy', 'healthcheck']);

    const application = await json(
      `/organizations/${organizationId}/applications/${applicationId}`,
      'GET',
      undefined,
      accessToken,
    );
    const applicationBody = (await application.json()) as { application: { status: string } };

    expect(applicationBody.application.status).toBe('running');
  });

  test('redeploy runs the pipeline again from the current compose content', async () => {
    installAgentMock();

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${applicationId}/deploy`,
        'POST',
        {},
        accessToken,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      expect(deploy.status).toBe(202);

      await runDeployment(body.deployment.id);
    } finally {
      restoreFetch();
    }

    const list = await json(
      `/organizations/${organizationId}/deployments?applicationId=${applicationId}`,
      'GET',
      undefined,
      accessToken,
    );
    const body = (await list.json()) as { items: { status: string }[] };

    expect(body.items.every(item => item.status === 'succeeded')).toBeTrue();
    expect(body.items.length).toBe(2);
  });

  test('rollback reapplies the pinned compose pair', async () => {
    installAgentMock();

    try {
      const rollback = await json(
        `/organizations/${organizationId}/applications/${applicationId}/rollback`,
        'POST',
        { deploymentId: firstDeploymentId },
        accessToken,
      );

      expect(rollback.status).toBe(202);

      const body = (await rollback.json()) as { deployment: { id: string } };

      await runDeployment(body.deployment.id);

      const status = await json(
        `/organizations/${organizationId}/deployments/${body.deployment.id}`,
        'GET',
        undefined,
        accessToken,
      );
      const detail = (await status.json()) as { deployment: { status: string } };

      expect(detail.deployment.status).toBe('succeeded');
    } finally {
      restoreFetch();
    }
  });

  test('removing the application runs docker compose down', async () => {
    installAgentMock();

    let downCalled = false;
    const wrapped = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));

      if ((init?.method ?? 'GET') === 'POST' && /\/api\/compose\/[^/]+\/down$/.test(url.pathname)) {
        downCalled = true;
      }

      return wrapped(input, init);
    }) as typeof fetch;

    try {
      const response = await json(
        `/organizations/${organizationId}/applications/${applicationId}?removeData=true`,
        'DELETE',
        undefined,
        accessToken,
      );

      expect(response.status).toBe(200);
      expect(downCalled).toBeTrue();
    } finally {
      restoreFetch();
    }

    const getResponse = await json(
      `/organizations/${organizationId}/applications/${applicationId}`,
      'GET',
      undefined,
      accessToken,
    );

    expect(getResponse.status).toBe(404);
  });

  test('deploys a two-service compose with depends_on', async () => {
    const create = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'two-service-app',
        environmentId,
        serverId,
        compose: { content: twoServiceCompose, expose: { service: 'app', port: 80 } },
      },
      accessToken,
    );
    const created = (await create.json()) as { application: { id: string; slug: string } };

    expect(create.status).toBe(201);

    currentSlug = created.application.slug;
    currentServices = ['app', 'db'];

    installAgentMock();

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${created.application.id}/deploy`,
        'POST',
        {},
        accessToken,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      expect(deploy.status).toBe(202);

      await runDeployment(body.deployment.id);
    } finally {
      restoreFetch();
    }

    const list = await json(
      `/organizations/${organizationId}/deployments?applicationId=${created.application.id}`,
      'GET',
      undefined,
      accessToken,
    );
    const deploymentId = ((await list.json()) as { items: { id: string }[] }).items[0]!.id;

    const status = await json(
      `/organizations/${organizationId}/deployments/${deploymentId}`,
      'GET',
      undefined,
      accessToken,
    );
    const detail = (await status.json()) as { deployment: { status: string } };

    expect(detail.deployment.status).toBe('succeeded');
  });
});

describe('rollback reconciles application variables', () => {
  let organizationId = '';
  let serverId = '';
  let environmentId = '';
  let applicationId = '';
  let firstDeploymentId = '';

  const volumeCompose =
    'services:\n' +
    '  app:\n' +
    '    image: nginx:1.27\n' +
    '    environment:\n' +
    '      GREETING: ${GREETING}\n' +
    '    volumes:\n' +
    '      - app-data:/data\n' +
    'volumes:\n' +
    '  app-data:\n';

  test('setup: org, project, environment and a compose application with a named volume', async () => {
    const org = await json(
      '/organizations',
      'POST',
      { name: 'Rollback Reconcile Co' },
      accessToken,
    );
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    serverId = getLocalServerId()!;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Rollback Reconcile Project' },
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
        name: 'volume-app',
        environmentId,
        serverId,
        compose: { content: volumeCompose, expose: { service: 'app', port: 80 } },
        variables: [{ key: 'GREETING', value: 'v1', secret: false }],
      },
      accessToken,
    );
    const created = (await create.json()) as {
      application: { id: string; slug: string; source: string };
    };

    expect(create.status).toBe(201);

    applicationId = created.application.id;
    currentSlug = created.application.slug;
    currentServices = ['app'];
  });

  test('first deploy runs with GREETING=v1', async () => {
    installAgentMock();

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${applicationId}/deploy`,
        'POST',
        {},
        accessToken,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      firstDeploymentId = body.deployment.id;

      await runDeployment(firstDeploymentId);
    } finally {
      restoreFetch();
    }

    const status = await json(
      `/organizations/${organizationId}/deployments/${firstDeploymentId}`,
      'GET',
      undefined,
      accessToken,
    );
    const detail = (await status.json()) as { deployment: { status: string } };

    expect(detail.deployment.status).toBe('succeeded');
  });

  test('changing the variable and redeploying runs with GREETING=v2', async () => {
    const replace = await json(
      `/organizations/${organizationId}/applications/${applicationId}/variables`,
      'PUT',
      { variables: [{ key: 'GREETING', value: 'v2', secret: false }] },
      accessToken,
    );

    expect(replace.status).toBe(200);

    installAgentMock();

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${applicationId}/deploy`,
        'POST',
        {},
        accessToken,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      await runDeployment(body.deployment.id);
    } finally {
      restoreFetch();
    }

    const variables = await json(
      `/organizations/${organizationId}/applications/${applicationId}/variables`,
      'GET',
      undefined,
      accessToken,
    );
    const variablesBody = (await variables.json()) as {
      variables: { key: string; value: string }[];
    };

    expect(variablesBody.variables.find(variable => variable.key === 'GREETING')?.value).toBe('v2');
  });

  test('rolling back to the first deployment reconciles GREETING back to v1 without touching the volume', async () => {
    installAgentMock();

    let downCalled = false;
    const wrapped = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));

      if ((init?.method ?? 'GET') === 'POST' && /\/api\/compose\/[^/]+\/down$/.test(url.pathname)) {
        downCalled = true;
      }

      return wrapped(input, init);
    }) as typeof fetch;

    try {
      const rollback = await json(
        `/organizations/${organizationId}/applications/${applicationId}/rollback`,
        'POST',
        { deploymentId: firstDeploymentId },
        accessToken,
      );

      expect(rollback.status).toBe(202);

      const body = (await rollback.json()) as { deployment: { id: string } };

      await runDeployment(body.deployment.id);

      const status = await json(
        `/organizations/${organizationId}/deployments/${body.deployment.id}`,
        'GET',
        undefined,
        accessToken,
      );
      const detail = (await status.json()) as { deployment: { status: string } };

      expect(detail.deployment.status).toBe('succeeded');
    } finally {
      restoreFetch();
    }

    expect(downCalled).toBeFalse();

    const variables = await json(
      `/organizations/${organizationId}/applications/${applicationId}/variables`,
      'GET',
      undefined,
      accessToken,
    );
    const variablesBody = (await variables.json()) as {
      variables: { key: string; value: string }[];
    };

    expect(variablesBody.variables.find(variable => variable.key === 'GREETING')?.value).toBe('v1');
  });
});

describe('applying a template update never touches the volume', () => {
  let organizationId = '';
  let projectId = '';
  let environmentId = '';
  let applicationId = '';

  const v1ComposeContent =
    'services:\n' +
    '  app:\n' +
    '    image: nginx:1.27\n' +
    '    volumes:\n' +
    '      - app-data:/data\n' +
    'volumes:\n' +
    '  app-data:\n';

  const v2ComposeContent =
    'services:\n' +
    '  app:\n' +
    '    image: nginx:1.28\n' +
    '    volumes:\n' +
    '      - app-data:/data\n' +
    'volumes:\n' +
    '  app-data:\n';

  const installedTemplate: Template = {
    id: 'synthetic-volume-safe-update-app',
    version: 1,
    name: 'Synthetic volume-safe update',
    tagline: 'Synthetic template for the volume-safety test of a template update',
    category: 'test',
    tags: [],
    icon: 'icon.svg',
    author: 'zydock',
    origin: 'official',
    dockerCompose: 'docker-compose.yml',
    expose: { service: 'app', port: 80, kind: 'http', domain: true },
    databases: [],
    inputs: [],
    secrets: [],
    deprecated: false,
    dockerComposeContent: v1ComposeContent,
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

  test('setup: org, project, environment and a template application with a named volume', async () => {
    const org = await json(
      '/organizations',
      'POST',
      { name: 'Volume Safe Update Co' },
      accessToken,
    );
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Volume Safe Update Project' },
      accessToken,
    );
    projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      accessToken,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;

    const server = await serverModel.findById(getLocalServerId());

    const { application } = await deployTemplateApplication({
      template: installedTemplate,
      organizationId,
      projectId,
      server: server!,
      body: {
        organizationId,
        name: 'volume-safe-update-app',
        environmentId,
        serverId: getLocalServerId()!,
        inputs: {},
        deployNow: false,
      },
      triggeredBy: 'test-user',
    });
    applicationId = String(application._id);

    currentSlug = application.slug;
    currentServices = ['app'];
  });

  test('deploying the template application succeeds', async () => {
    installAgentMock();

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${applicationId}/deploy`,
        'POST',
        {},
        accessToken,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      await runDeployment(body.deployment.id);

      const status = await json(
        `/organizations/${organizationId}/deployments/${body.deployment.id}`,
        'GET',
        undefined,
        accessToken,
      );
      const detail = (await status.json()) as { deployment: { status: string } };

      expect(detail.deployment.status).toBe('succeeded');
    } finally {
      restoreFetch();
    }
  });

  test('applying the newer template version and redeploying never calls docker compose down', async () => {
    catalogTemplate.version = 2;
    catalogTemplate.dockerComposeContent = v2ComposeContent;

    const update = await json(
      `/organizations/${organizationId}/applications/${applicationId}/template-update`,
      'POST',
      { deployNow: false },
      accessToken,
    );

    expect(update.status).toBe(200);

    const raw = await applicationModel.findById(applicationId);

    expect(raw!.compose!.content).toBe(v2ComposeContent);
    expect(raw!.compose!.content).toContain('app-data:/data');

    installAgentMock();

    let downCalled = false;
    const wrapped = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));

      if ((init?.method ?? 'GET') === 'POST' && /\/api\/compose\/[^/]+\/down$/.test(url.pathname)) {
        downCalled = true;
      }

      return wrapped(input, init);
    }) as typeof fetch;

    try {
      const deploy = await json(
        `/organizations/${organizationId}/applications/${applicationId}/deploy`,
        'POST',
        {},
        accessToken,
      );
      const body = (await deploy.json()) as { deployment: { id: string } };

      await runDeployment(body.deployment.id);

      const status = await json(
        `/organizations/${organizationId}/deployments/${body.deployment.id}`,
        'GET',
        undefined,
        accessToken,
      );
      const detail = (await status.json()) as { deployment: { status: string } };

      expect(detail.deployment.status).toBe('succeeded');
    } finally {
      restoreFetch();
    }

    expect(downCalled).toBeFalse();
  });
});

describe('published port conflicts across applications (Fase 10)', () => {
  let organizationId = '';
  let environmentId = '';
  let runningPorts: { hostPort: number; owner: string }[] = [];
  let conflictToken = '';

  const installListContainersMock = () => {
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input));

      if (url.pathname === '/api/containers') {
        return jsonResponse(
          runningPorts.map(({ hostPort, owner }) => ({
            id: `container-${hostPort}`,
            name: owner,
            image: 'nginx:1.27',
            state: 'running',
            health: 'none',
            restartCount: 0,
            ports: [{ containerPort: 25565, hostPort, protocol: 'tcp' }],
            labels: {},
          })),
        );
      }

      throw new Error(`Unhandled agent request in test mock: GET ${url.pathname}`);
    }) as typeof fetch;
  };

  beforeAll(async () => {
    const signup = await json('/auth/signup', 'POST', {
      name: 'Port Conflict IT',
      email: `it-port-conflict-${Date.now()}@zydock.test`,
      password: 'integration-secret-1',
    });
    conflictToken = ((await signup.json()) as { accessToken: string }).accessToken;

    const org = await json('/organizations', 'POST', { name: 'Port Conflict Co' }, conflictToken);
    organizationId = ((await org.json()) as { organization: { id: string } }).organization.id;

    const project = await json(
      `/organizations/${organizationId}/projects`,
      'POST',
      { name: 'Port Conflict Project' },
      conflictToken,
    );
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const envs = await json(
      `/organizations/${organizationId}/projects/${projectId}/environments`,
      'GET',
      undefined,
      conflictToken,
    );
    environmentId = ((await envs.json()) as { items: { id: string }[] }).items[0]!.id;
  });

  afterEach(() => {
    restoreFetch();
  });

  test('a first application publishing a TCP port deploys without conflict', async () => {
    runningPorts = [];
    installListContainersMock();

    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'game-server-one',
        environmentId,
        serverId: getLocalServerId()!,
        compose: {
          content: 'services:\n  app:\n    image: nginx:1.27\n    ports:\n      - "25811:25565"\n',
          expose: { service: 'app', port: 25565, kind: 'tcp' },
        },
      },
      conflictToken,
    );
    const body = (await response.json()) as { application: { slug: string } };

    expect(response.status).toBe(201);

    runningPorts = [{ hostPort: 25811, owner: `zydock-${body.application.slug}-app-1` }];
  });

  test('a second application on a different port coexists with the first', async () => {
    installListContainersMock();

    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'game-server-two',
        environmentId,
        serverId: getLocalServerId()!,
        compose: {
          content: 'services:\n  app:\n    image: nginx:1.27\n    ports:\n      - "25812:25565"\n',
          expose: { service: 'app', port: 25565, kind: 'tcp' },
        },
      },
      conflictToken,
    );

    expect(response.status).toBe(201);
  });

  test('the same host port is rejected, naming the application that already owns it', async () => {
    installListContainersMock();

    const response = await json(
      `/organizations/${organizationId}/applications`,
      'POST',
      {
        source: 'compose',
        name: 'game-server-conflict',
        environmentId,
        serverId: getLocalServerId()!,
        compose: {
          content: 'services:\n  app:\n    image: nginx:1.27\n    ports:\n      - "25811:25565"\n',
          expose: { service: 'app', port: 25565, kind: 'tcp' },
        },
      },
      conflictToken,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('25811');
    expect(body.error).toContain('game-server-one-app-1');
  });
});
