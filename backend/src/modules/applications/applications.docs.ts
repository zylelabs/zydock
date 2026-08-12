import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const applicationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    projectId: { type: 'string' },
    environmentId: { type: 'string' },
    serverId: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    status: { type: 'string', enum: ['created', 'deploying', 'running', 'stopped', 'failed'] },
    git: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        repository: { type: 'string' },
        branch: { type: 'string' },
        dockerfilePath: { type: 'string' },
        buildContext: { type: 'string' },
        autoDeploy: { type: 'boolean' },
        hasToken: { type: 'boolean' },
      },
    },
    port: { type: 'integer' },
    portMappings: {
      type: 'array',
      description: 'Host port publishes (`host:container`), next to the reverse proxy.',
      items: {
        type: 'object',
        properties: {
          hostPort: { type: 'integer' },
          containerPort: { type: 'integer' },
          protocol: { type: 'string', enum: ['tcp', 'udp'] },
        },
      },
    },
    variables: {
      type: 'array',
      description: 'Only the names: values never leave the platform through this endpoint.',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, secret: { type: 'boolean' } },
      },
    },
    volumes: { type: 'array', items: { type: 'object' } },
    networks: { type: 'array', items: { type: 'string' } },
    healthcheck: { type: 'object' },
    resources: { type: 'object' },
    restartPolicy: { type: 'string' },
    origin: {
      type: 'object',
      nullable: true,
      description: 'Present when the application was created from a marketplace template.',
      properties: {
        templateId: { type: 'string' },
        templateVersion: { type: 'integer' },
        inputs: { type: 'object' },
        composeHash: { type: 'string' },
      },
    },
    templateStatus: {
      type: 'string',
      nullable: true,
      enum: ['up-to-date', 'update-available', 'deprecated', 'unknown'],
      description: 'Only for compose applications created from a template.',
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const applicationResponse = { type: 'object', properties: { application: applicationSchema } };

const variablesResponse = {
  type: 'object',
  properties: {
    variables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          secret: { type: 'boolean' },
        },
      },
    },
  },
};

export const applicationsDocs = {
  list: {
    tags: ['Applications'],
    summary: 'List the applications of an organization',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'projectId', in: 'query', schema: { type: 'string' } },
      { name: 'environmentId', in: 'query', schema: { type: 'string' } },
      { name: 'serverId', in: 'query', schema: { type: 'string' } },
    ],
    responses: {
      200: jsonRes('Applications.', paginatedSchema(applicationSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  create: {
    tags: ['Applications'],
    summary: 'Create an application',
    description:
      'The environment and the server must belong to the organization. Variable values and the ' +
      'git token are encrypted before being stored.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Application created.', applicationResponse),
      400: errorRes('Unknown environment or server.'),
      403: errorRes('Permission denied.'),
    },
  },
  get: {
    tags: ['Applications'],
    summary: 'Read an application',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Application.', applicationResponse),
      404: errorRes('Application not found.'),
    },
  },
  update: {
    tags: ['Applications'],
    summary: 'Update an application',
    description:
      'Only the informed fields change. Sending `healthcheck: null` removes the healthcheck. ' +
      'Changes take effect on the next deploy.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Application updated.', applicationResponse),
      400: errorRes('Unknown server.'),
      404: errorRes('Application not found.'),
    },
  },
  templateUpdate: {
    tags: ['Applications'],
    summary: 'Preview a pending template update',
    description:
      'Only for `source: "compose"` applications created from a template. Compares the ' +
      'installed template version against the current catalog: the compose diff, variables that ' +
      'would be added or removed, changes to `expose`/`databases`, and whether the compose file ' +
      'was edited by hand (`origin.composeHash`). The catalog is embedded in the backend binary, ' +
      'so a template update ships with a Zydock platform update, not on its own schedule.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Update preview.', {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['up-to-date', 'update-available', 'deprecated', 'unknown'],
          },
          installedVersion: { type: 'integer' },
          availableVersion: { type: 'integer' },
          manuallyEdited: { type: 'boolean' },
          composeDiff: { type: 'array', items: { type: 'object' } },
          variables: {
            type: 'object',
            properties: {
              added: { type: 'array', items: { type: 'string' } },
              removed: { type: 'array', items: { type: 'string' } },
            },
          },
          expose: { type: 'object' },
          databases: { type: 'object' },
        },
      }),
      400: errorRes('Not a template application.'),
      404: errorRes('Application not found.'),
    },
  },
  applyTemplateUpdate: {
    tags: ['Applications'],
    summary: 'Apply a pending template update',
    description:
      'Only for `source: "compose"` applications created from a template with a newer version in ' +
      'the catalog. Rewrites the compose file and `expose` from the current template, preserves ' +
      'every existing variable whose key still exists, generates new secrets on the server, and ' +
      'blocks with 400 if the new template requires an input that was never answered (the message ' +
      'names the missing keys). The running version is kept if still valid for the new template, ' +
      'otherwise it falls back to the default (`versionFellBackToDefault` says so). If the compose ' +
      'file was edited by hand (`origin.composeHash` no longer matches), the request is rejected ' +
      'with 409 until `confirmOverwrite: true` is sent — the edit is then discarded. Never removes ' +
      'a volume, domain or port. Unless `deployNow` is `false`, a deployment is queued right away.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Template updated.', {
        type: 'object',
        properties: {
          application: applicationSchema,
          deployment: { type: 'object' },
          versionFellBackToDefault: { type: 'boolean' },
        },
      }),
      400: errorRes(
        'Not a template application, template no longer in the catalog or deprecated, already on ' +
          'the latest version, or a required input is missing.',
      ),
      404: errorRes('Application not found.'),
      409: errorRes('The compose file was edited by hand; resend with "confirmOverwrite: true".'),
    },
  },
  deploy: {
    tags: ['Applications'],
    summary: 'Deploy the application now',
    description:
      'Creates the deployment and hands it to the queue: the answer comes back before the ' +
      'pipeline runs. Follow the progress on the `deployment:<id>:steps` WebSocket topic.',
    security: bearerOrApiKeyAuth,
    responses: {
      202: jsonRes('Deployment queued.', {
        type: 'object',
        properties: { deployment: { type: 'object' } },
      }),
      404: errorRes('Application not found.'),
    },
  },
  rollback: {
    tags: ['Applications'],
    summary: 'Roll back to a previous deployment',
    description:
      'Redeploys the image of an earlier successful deployment (given its `deploymentId`) without ' +
      'cloning or building — recreates the container and reapplies the proxy. The image must still ' +
      'exist on the server. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      202: jsonRes('Rollback deployment queued.', {
        type: 'object',
        properties: { deployment: { type: 'object' } },
      }),
      400: errorRes('The target deployment has no reusable image.'),
      404: errorRes('Application or deployment not found.'),
    },
  },
  restart: {
    tags: ['Applications'],
    summary: 'Restart the application',
    description: 'Restarts the running container of the application on its server. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Application restarted.', applicationResponse),
      400: errorRes('No running container, or the agent failed.'),
      404: errorRes('Application not found.'),
    },
  },
  stop: {
    tags: ['Applications'],
    summary: 'Stop the application',
    description: 'Stops the running container of the application. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Application stopped.', applicationResponse),
      400: errorRes('No running container, or the agent failed.'),
      404: errorRes('Application not found.'),
    },
  },
  start: {
    tags: ['Applications'],
    summary: 'Start the application',
    description: 'Starts the stopped container of the application. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Application started.', applicationResponse),
      400: errorRes('No container, or the agent failed.'),
      404: errorRes('Application not found.'),
    },
  },
  remove: {
    tags: ['Applications'],
    summary: 'Remove an application',
    description:
      'For compose applications this also runs `docker compose down`. With `?removeData=true` ' +
      'the compose volumes are deleted too — the data is not recoverable afterwards.',
    security: bearerOrApiKeyAuth,
    parameters: [{ name: 'removeData', in: 'query', schema: { type: 'boolean' } }],
    responses: {
      200: messageRes('Application removed successfully.'),
      404: errorRes('Application not found.'),
    },
  },
  services: {
    tags: ['Applications'],
    summary: 'List the services of a compose application',
    description:
      'Derived from the compose file, not a live query: always available, even with the agent ' +
      'offline. Empty for `source: "git"` applications, which are a single container.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Services.', {
        type: 'object',
        properties: {
          services: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                service: { type: 'string' },
                containerName: { type: 'string' },
                exposed: { type: 'boolean' },
              },
            },
          },
        },
      }),
      404: errorRes('Application not found.'),
    },
  },
  listVariables: {
    tags: ['Applications'],
    summary: 'Read the environment variables of an application',
    description: 'Returns the decrypted values — the only endpoint that does.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Variables.', variablesResponse),
      403: errorRes('Permission denied.'),
      404: errorRes('Application not found.'),
    },
  },
  replaceVariables: {
    tags: ['Applications'],
    summary: 'Replace the environment variables of an application',
    description: 'Replaces the whole set; variables left out are removed.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Variables replaced.', variablesResponse),
      404: errorRes('Application not found.'),
    },
  },
  regenerateVariable: {
    tags: ['Applications'],
    summary: 'Regenerate a secret generated by the template',
    description:
      'Only for `source: "compose"` applications created from a template, and only for a key ' +
      "declared in that template's `secrets`. Generates a new value on the server with the same " +
      'generator and queues a deployment right away — a secret never rotates silently.',
    security: bearerOrApiKeyAuth,
    responses: {
      202: jsonRes('New value generated, deployment queued.', {
        type: 'object',
        properties: { application: applicationSchema, deployment: { type: 'object' } },
      }),
      400: errorRes('Not a template application, or "key" is not a generated secret.'),
      404: errorRes('Application not found.'),
    },
  },
  changeVersion: {
    tags: ['Applications'],
    summary: 'Change the running version of a template application',
    description:
      'Only for `source: "compose"` applications created from a template that declares ' +
      '`versions`. Writes the new value to the version variable and, unless `deployNow` is ' +
      '`false`, queues a deployment right away — no compose file is edited by hand.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Version changed.', {
        type: 'object',
        properties: { application: applicationSchema, deployment: { type: 'object' } },
      }),
      400: errorRes(
        'Not a template application, template has no selectable versions, invalid version, or ' +
          'the application is already on that version.',
      ),
      404: errorRes('Application not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
