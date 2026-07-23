import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes } from '../../utils/openapi';
import { ALLOWED_COMMANDS } from './commands.schema';

export const commandsDocs = {
  list: {
    tags: ['Commands'],
    summary: 'List authorized commands',
    description: 'Returns the closed set of commands the agent is allowed to run.',
    security: agentAuth,
    responses: {
      200: jsonRes('Authorized commands.', {
        type: 'object',
        properties: {
          commands: { type: 'array', items: { type: 'string', enum: [...ALLOWED_COMMANDS] } },
        },
      }),
      401: errorRes('Invalid agent token.'),
    },
  },
  run: {
    tags: ['Commands'],
    summary: 'Run an authorized command',
    description:
      'Runs one command from the allowlist. The agent never executes arbitrary shell input: ' +
      'the request carries only the command name, and the argv is built on the agent side.',
    security: agentAuth,
    responses: {
      200: jsonRes('Command result.', {
        type: 'object',
        properties: {
          name: { type: 'string' },
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
        },
      }),
      400: errorRes('Unknown command.'),
      401: errorRes('Invalid agent token.'),
    },
  },
} satisfies Record<string, DocOptions>;
