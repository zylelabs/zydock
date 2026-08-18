import type { DocOptions } from 'hono-route-docs';
import { errorRes } from '../../utils/openapi';

export const consoleDocs = {
  connect: {
    tags: ['Console'],
    summary: 'Interactive console inside an application container',
    description:
      'Upgrades to WebSocket and bridges to `docker exec -i <shell>` on the server, through its ' +
      'agent. Keystrokes sent as frames go to the process stdin; its output comes back as text ' +
      'frames. Authentication uses the `token` query parameter, because browsers cannot set ' +
      'headers on a WebSocket handshake. No TTY is allocated, so full-screen programs do not ' +
      'render. `shell` may be `sh` (default) or `bash`. `mode` selects `shell` (default) or ' +
      '`attach` — `attach` connects to the container\'s main process (PID 1) instead of a new ' +
      'shell, and fails with an explanatory message if the container was not started with ' +
      '`stdin_open: true`. Closing the connection does not stop the attached process; it only ' +
      'detaches. Requires the `admin` role.',
    parameters: [
      {
        name: 'token',
        in: 'query',
        required: true,
        description: 'Access token (the same JWT used as a Bearer token).',
        schema: { type: 'string' },
      },
      { name: 'shell', in: 'query', schema: { type: 'string', enum: ['sh', 'bash'] } },
      { name: 'mode', in: 'query', schema: { type: 'string', enum: ['shell', 'attach'] } },
    ],
    responses: {
      101: { description: 'Protocol switched to WebSocket.' },
      401: errorRes('Access token not provided, invalid or expired.'),
      403: errorRes('Permission denied.'),
      426: errorRes('Upgrade to WebSocket required.'),
    },
  },
} satisfies Record<string, DocOptions>;
