import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

export const serverSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string', nullable: true },
    name: { type: 'string' },
    type: { type: 'string', enum: ['ssh', 'local'] },
    status: {
      type: 'string',
      enum: ['pending', 'validating', 'provisioning', 'online', 'offline', 'failed'],
    },
    online: { type: 'boolean' },
    managed: {
      type: 'boolean',
      description: 'True for the local server that comes installed with the system.',
    },
    publicIp: {
      type: 'string',
      nullable: true,
      description:
        'Routable public IP address, derived from the SSH host or the source address of the ' +
        'agent heartbeat request, or set manually when the server sits behind NAT.',
    },
    ssh: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        port: { type: 'integer' },
        username: { type: 'string' },
        fingerprint: { type: 'string', nullable: true },
      },
    },
    agent: {
      type: 'object',
      properties: {
        host: { type: 'string', nullable: true },
        port: { type: 'integer' },
        version: { type: 'string', nullable: true },
        installedAt: { type: 'string', format: 'date-time', nullable: true },
        lastHeartbeatAt: { type: 'string', format: 'date-time', nullable: true },
        tlsIssuedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    resources: {
      type: 'object',
      properties: {
        cpuCount: { type: 'integer', nullable: true },
        memoryMb: { type: 'integer', nullable: true },
        diskGb: { type: 'integer', nullable: true },
        osRelease: { type: 'string', nullable: true },
        dockerVersion: { type: 'string', nullable: true },
        composeVersion: {
          type: 'string',
          nullable: true,
          description:
            'Reported by the agent heartbeat. Absent until the Compose plugin is detected.',
        },
      },
    },
    lastError: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const serverWrapped = { type: 'object', properties: { server: serverSchema } };

const probeSchema = {
  type: 'object',
  properties: {
    reachable: { type: 'boolean' },
    fingerprint: { type: 'string', nullable: true },
    osRelease: { type: 'string', nullable: true },
    cpuCount: { type: 'integer', nullable: true },
    memoryMb: { type: 'integer', nullable: true },
    diskGb: { type: 'integer', nullable: true },
    dockerVersion: { type: 'string', nullable: true },
    error: { type: 'string', nullable: true },
  },
};

const provisioningSchema = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step: { type: 'string' },
          ok: { type: 'boolean' },
          detail: { type: 'string', nullable: true },
        },
      },
    },
  },
};

export const serversDocs = {
  list: {
    tags: ['Servers'],
    summary: 'List servers',
    description: 'Lists the servers of an organization (paginated). Any member can read.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
    ],
    responses: {
      200: jsonRes('Servers.', paginatedSchema(serverSchema)),
      404: errorRes('Organization not found or not accessible.'),
    },
  },
  validate: {
    tags: ['Servers'],
    summary: 'Validate an SSH connection',
    description:
      'Opens an SSH connection with the given credentials and reports the host fingerprint and ' +
      'the detected resources, without persisting anything. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Probe result.', probeSchema),
      403: errorRes('Permission denied.'),
    },
  },
  create: {
    tags: ['Servers'],
    summary: 'Register a remote server',
    description:
      'Registers a server reachable over SSH: validates the connection, stores the credentials ' +
      'encrypted with AES-256-GCM and pins the host fingerprint — call the provision endpoint ' +
      'next. The server starts as `pending`. Admin or owner. The local server is not created ' +
      'through this endpoint: it comes installed with the system.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Server registered.', serverWrapped),
      400: errorRes('The SSH connection failed.'),
      403: errorRes('Permission denied.'),
    },
  },
  get: {
    tags: ['Servers'],
    summary: 'Get a server',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Server.', serverWrapped),
      404: errorRes('Server not found.'),
    },
  },
  update: {
    tags: ['Servers'],
    summary: 'Update a server',
    description:
      'Updates the name, the SSH credentials and/or the public IP. Admin or owner. Set `publicIp` ' +
      'to an empty string to clear a manual override and fall back to auto-detection.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated server.', serverWrapped),
      400: errorRes(
        'The SSH connection failed, the public IP is not a routable address, or the target is the local server.',
      ),
      403: errorRes('Permission denied.'),
      404: errorRes('Server not found.'),
    },
  },
  remove: {
    tags: ['Servers'],
    summary: 'Remove a server',
    description:
      'Removes the server from the organization. Admin or owner. The local server cannot be ' +
      'removed.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Server removed.'),
      400: errorRes('The local server is part of the installation and cannot be removed.'),
      403: errorRes('Permission denied.'),
      404: errorRes('Server not found.'),
    },
  },
  provision: {
    tags: ['Servers'],
    summary: 'Provision a server',
    description:
      'Runs the bootstrap over SSH: installs Docker and the Bun runtime (both idempotent), ' +
      'uploads the agent bundle, writes the environment file and the systemd unit, starts the ' +
      'service and verifies its health. Progress is published to the ' +
      '`server:<id>:provisioning` WebSocket topic. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Provisioning finished — inspect each step.', provisioningSchema),
      403: errorRes('Permission denied.'),
      404: errorRes('Server not found.'),
    },
  },
  refresh: {
    tags: ['Servers'],
    summary: 'Refresh server resources',
    description: 'Reconnects over SSH and updates CPU, memory, disk and Docker version.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Probe result.', probeSchema),
      403: errorRes('Permission denied.'),
      404: errorRes('Server not found.'),
    },
  },
  heartbeat: {
    tags: ['Servers'],
    summary: 'Agent heartbeat',
    description:
      'Called by the agent installed on the server, authenticated with its own token via the ' +
      '`X-Agent-Token` header. Updates the status and the reported metrics, republishes them to ' +
      "the `server:<id>:metrics` WebSocket topic, and fills `publicIp` from the connection's " +
      'source address (falling back to the address reported in the body) when the server does ' +
      'not have one yet.',
    responses: {
      200: messageRes('Heartbeat accepted.'),
      401: errorRes('Invalid agent token.'),
      404: errorRes('Server not found.'),
    },
  },
  identity: {
    tags: ['Servers'],
    summary: 'Resolve the local server id',
    description:
      'Called by the agent installed alongside the system when it boots without a `SERVER_ID`, ' +
      'authenticated with the local server token via `X-Agent-Token`. Lets it discover its own id ' +
      'without the token/id pair being fixed at build time.',
    responses: {
      200: jsonRes('Local server id.', {
        type: 'object',
        properties: { serverId: { type: 'string' } },
      }),
      401: errorRes('Invalid agent token.'),
      503: errorRes('The local server has not been bootstrapped yet.'),
    },
  },
  applicationStatus: {
    tags: ['Servers'],
    summary: 'Application status (agent auto-heal check)',
    description:
      'Called by the agent before reviving an exited/unhealthy container, authenticated with the ' +
      'token of the server the application runs on via `X-Agent-Token`. Lets the health sweep ' +
      'tell an intentional Stop apart from a crash, without keeping any local state.',
    responses: {
      200: jsonRes('Application status.', {
        type: 'object',
        properties: { status: { type: 'string' } },
      }),
      401: errorRes('Invalid agent token.'),
      404: errorRes('Application not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
