import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes } from '../../utils/openapi';

export const consoleDocs = {
  connect: {
    tags: ['Containers'],
    summary: 'Interactive console inside a container',
    description:
      'Upgrades to WebSocket and attaches to a `<shell>` exec created through the Docker Engine ' +
      'API with `Tty: true`, so the shell gets a real pseudo-terminal: prompt, echo, control keys ' +
      'and full-screen programs all work. Text frames from the client are keystrokes written to ' +
      'the terminal; binary frames are control messages (`{"type":"resize","columns":N,"rows":N}`) ' +
      'and never reach the shell. Output is sent back as text frames. `shell` may be `sh` ' +
      '(default) or `bash`. `mode` selects `shell` (default, `docker exec`) or `attach` ' +
      '(`docker attach` to the main process, PID 1) — attach fails if the container was not ' +
      'started with `stdin_open: true`.',
    security: agentAuth,
    parameters: [
      { name: 'shell', in: 'query', schema: { type: 'string', enum: ['sh', 'bash'] } },
      { name: 'mode', in: 'query', schema: { type: 'string', enum: ['shell', 'attach'] } },
    ],
    responses: {
      101: { description: 'Protocol switched to WebSocket.' },
      401: errorRes('Invalid agent token.'),
      426: errorRes('Upgrade to WebSocket required.'),
    },
  },
} satisfies Record<string, DocOptions>;
