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
    publicAccess: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        hostPort: { type: 'integer', nullable: true },
        appliedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    externalHost: { type: 'string', nullable: true },
    externalPort: { type: 'integer', nullable: true },
    publicConnectionUriMasked: { type: 'string', nullable: true },
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
    publicConnectionUri: { type: 'string', nullable: true },
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
  peakConnections: { type: 'number' },
  peakWindowHours: { type: 'number' },
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
  versions: {
    tags: ['Databases'],
    summary: 'List the available image versions for every engine',
    description:
      'Reads the 10 most recent tags per engine from Docker Hub, cached for ' +
      '`REGISTRY_TAGS_TTL_HOURS` hours and served stale if Docker Hub is unreachable. Falls back to ' +
      'a hardcoded list when the registry lookup is disabled or fails outright.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Versions by engine.', {
        type: 'object',
        properties: {
          versions: {
            type: 'object',
            properties: {
              postgresql: { type: 'array', items: { type: 'string' } },
              mysql: { type: 'array', items: { type: 'string' } },
              mongodb: { type: 'array', items: { type: 'string' } },
              redis: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      }),
      404: errorRes('Organization not found.'),
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
      'with no metrics. `peakConnections` is the highest connection count sampled by the platform ' +
      'itself over the last `peakWindowHours`, read from Mongo in a single aggregation for the ' +
      "whole list — it never depends on the agent, so it's still present when a server's agent is " +
      'unreachable. Absent when no sample fell inside the window, never `0`.',
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
      'yet, or the database has no container yet, never a 5xx. `peakConnections` still arrives ' +
      "in that case — it comes from the platform's own samples, not from the agent.",
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
      'Union of who declares the database (compose link, or a decrypted variable matching its ' +
      "host or connection URI) and who connects to it (the container's client IP, matched against " +
      "every container's network address on the server). An application that connects without a " +
      'matching variable is still listed, without `variableKey`. Connections from an IP that ' +
      "doesn't match any container are summed in `otherConnections`, never guessed into an " +
      'application. Degrades to `200` with `degraded: { reason }` and no `connections` counts ' +
      'whenever the agent is unreachable — the declared list is unaffected. Never returns a ' +
      'variable value or a container IP — only the application, the key of the variable that ' +
      'matched, and a connection count.',
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
                variableKey: { type: 'string', nullable: true },
                connections: { type: 'number', nullable: true },
              },
            },
          },
          otherConnections: { type: 'number', nullable: true },
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
  updateAccess: {
    tags: ['Databases'],
    summary: 'Enable or disable external access to a managed database',
    description:
      'Publishes (or unpublishes) a host port on the server, so the database is reachable from ' +
      'outside its internal network. Recreates the container to apply the change — the data is ' +
      'kept, since it lives on a named volume that is reattached to the new container. Only ' +
      '`managed` databases support this; compose-linked databases do not. Requires the `admin` role.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Database.', { type: 'object', properties: { database: databaseSchema } }),
      400: errorRes(
        'Invalid body, the host port is already in use, or the database is not managed.',
      ),
      404: errorRes('Database not found.'),
      409: errorRes('This server has no agent yet.'),
      502: unreachable,
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
  reconcile: {
    tags: ['Databases'],
    summary: 'Recreate the container of a managed database if it went missing from the host',
    description:
      'Inspects the container by its stored id. When it still exists, this just refreshes the ' +
      "status. When it doesn't — the host lost it, the volume did not — recreates it from the " +
      "record's decrypted credentials and the existing data volume, without regenerating the " +
      'password or touching the volume. Only `managed` databases support this. Requires the ' +
      '`admin` role.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Reconciliation result.', {
        type: 'object',
        properties: { recreated: { type: 'boolean' }, status: { type: 'string' } },
      }),
      400: errorRes('The database is not managed.'),
      404: errorRes('Database not found.'),
      409: errorRes('This server has no agent yet.'),
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
