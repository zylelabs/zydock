import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../src/app-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import applicationModel from '../../src/modules/applications/application.model';
import { findEnvironmentOfOrganization } from '../../src/modules/projects/environment.service';
import { createMembership } from '../../src/modules/organizations/membership.service';
import { runDeployment } from '../../src/modules/deployments/pipeline.service';
import {
  ensureLocalServer,
  getLocalServerId,
} from '../../src/modules/servers/local-server.service';
import serverModel from '../../src/modules/servers/server.model';
import { stopWorker } from '../../src/modules/queue/queue.service';
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

describe('POST /templates/:templateId/deploy', () => {
  let organizationId = '';
  let environmentId = '';
  let projectId = '';

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
    expect(body.application.origin?.templateVersion).toBe(1);
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
      databases: [{ service: 'db', engine: 'postgresql' }],
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
      databases: [{ service: 'db', engine: 'postgresql' }],
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
