import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const databaseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    serverId: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    engine: { type: 'string', enum: ['postgresql', 'mysql', 'mongodb', 'redis'] },
    version: { type: 'string' },
    status: { type: 'string', enum: ['provisioning', 'running', 'stopped', 'failed', 'unknown'] },
    containerId: { type: 'string' },
    connection: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        port: { type: 'integer' },
        username: { type: 'string' },
        database: { type: 'string' },
      },
    },
    lastError: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const credentialsSchema = {
  type: 'object',
  properties: {
    host: { type: 'string' },
    port: { type: 'integer' },
    username: { type: 'string' },
    database: { type: 'string' },
    password: { type: 'string' },
    connectionUri: { type: 'string' },
  },
};

const unreachable = errorRes('The agent of the server could not be reached.');

const databaseStatsFields = {
  sizeBytes: { type: 'number' },
  connections: { type: 'number' },
  maxConnections: { type: 'number' },
  versionLabel: { type: 'string' },
  diskTotalBytes: { type: 'number' },
  diskUsedBytes: { type: 'number' },
  uptimeSeconds: { type: 'number' },
} as const;

const databaseStatsItemSchema = {
  type: 'object',
  properties: { databaseId: { type: 'string' }, ...databaseStatsFields },
};

const serverDegradationSchema = {
  type: 'object',
  properties: { serverId: { type: 'string' }, reason: { type: 'string' } },
};

export const databasesDocs = {
  list: {
    tags: ['Databases'],
    summary: 'List the managed databases of an organization',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'serverId', in: 'query', schema: { type: 'string' } },
      { name: 'engine', in: 'query', schema: { type: 'string' } },
    ],
    responses: {
      200: jsonRes('Databases.', paginatedSchema(databaseSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  create: {
    tags: ['Databases'],
    summary: 'Provision a managed database',
    description:
      'Runs the engine as a container on the server, on the shared network, and generates the ' +
      'credentials. Applications reach it by the container host name. The response omits the ' +
      'password — read it from the credentials endpoint. `version` defaults to a current image tag ' +
      'for the engine.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Database provisioned.', {
        type: 'object',
        properties: { database: databaseSchema },
      }),
      400: errorRes('Invalid body, or the server is not in this organization.'),
      409: errorRes('A database with this name already exists on the server.'),
      502: unreachable,
    },
  },
  get: {
    tags: ['Databases'],
    summary: 'Read a managed database',
    description: 'Refreshes the status from the agent before answering.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Database.', { type: 'object', properties: { database: databaseSchema } }),
      404: errorRes('Database not found.'),
    },
  },
  stats: {
    tags: ['Databases'],
    summary: 'Read live storage and connection metrics for every database of an organization',
    description:
      'Runs one command inside each database container through the agent, plus one container ' +
      'inspect for uptime — two agent calls per database, never a query against the platform ' +
      "database itself. Degrades to `200` with the item's metrics omitted and a `degraded` entry " +
      "whenever a server's agent is unreachable, grouped once per server rather than once per " +
      'database, so it never returns a 5xx. A database without a container yet is still listed, ' +
      'with no metrics.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Database stats.', {
        type: 'object',
        properties: {
          items: { type: 'array', items: databaseStatsItemSchema },
          degraded: { type: 'array', nullable: true, items: serverDegradationSchema },
        },
      }),
      404: errorRes('Organization not found.'),
    },
  },
  databaseStats: {
    tags: ['Databases'],
    summary: 'Read live storage and connection metrics for a single database',
    description:
      'Same measurement as the bulk `/stats` route, scoped to one database. Degrades to `200` ' +
      'with `degraded: { reason }` whenever the agent is unreachable, the server has no agent ' +
      'yet, or the database has no container yet, never a 5xx.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Database stats.', {
        type: 'object',
        properties: {
          ...databaseStatsFields,
          degraded: {
            type: 'object',
            nullable: true,
            properties: { reason: { type: 'string' } },
          },
        },
      }),
      404: errorRes('Database not found.'),
    },
  },
  consumers: {
    tags: ['Databases'],
    summary: 'List the applications that reference this database',
    description:
      'For a database linked to a compose application, the linked application. For a managed ' +
      'database, every application in the organization whose decrypted variables match this ' +
      "database's host or connection URI. Never returns a variable value — only the application " +
      'and the key of the variable that matched.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Consumers.', {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                applicationId: { type: 'string' },
                name: { type: 'string' },
                variableKey: { type: 'string' },
              },
            },
          },
        },
      }),
      404: errorRes('Database not found.'),
    },
  },
  credentials: {
    tags: ['Databases'],
    summary: 'Read the connection credentials',
    description: 'Returns the password and connection URI in clear. Requires the `admin` role.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Credentials.', {
        type: 'object',
        properties: { credentials: credentialsSchema },
      }),
      404: errorRes('Database not found.'),
    },
  },
  start: {
    tags: ['Databases'],
    summary: 'Start a database',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Status.', { type: 'object', properties: { status: { type: 'string' } } }),
      404: errorRes('Database not found.'),
      502: unreachable,
    },
  },
  stop: {
    tags: ['Databases'],
    summary: 'Stop a database',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Status.', { type: 'object', properties: { status: { type: 'string' } } }),
      404: errorRes('Database not found.'),
      502: unreachable,
    },
  },
  restart: {
    tags: ['Databases'],
    summary: 'Restart a database',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Status.', { type: 'object', properties: { status: { type: 'string' } } }),
      404: errorRes('Database not found.'),
      502: unreachable,
    },
  },
  remove: {
    tags: ['Databases'],
    summary: 'Destroy a managed database',
    description:
      'Removes the container. With `?removeData=true` the data volume is deleted too — the data is ' +
      'lost. Without it, the volume is kept and a database created later with the same name reuses it.',
    security: bearerOrApiKeyAuth,
    parameters: [{ name: 'removeData', in: 'query', schema: { type: 'boolean' } }],
    responses: {
      200: messageRes('Database destroyed.'),
      404: errorRes('Database not found.'),
      502: unreachable,
    },
  },
} satisfies Record<string, DocOptions>;
