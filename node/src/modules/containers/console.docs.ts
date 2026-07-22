import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes } from '../../utils/openapi';

export const consoleDocs = {
  connect: {
    tags: ['Containers'],
    summary: 'Interactive console inside a container',
    description:
      'Upgrades to WebSocket and runs `docker exec -i <shell>` inside the container. The client ' +
      'sends keystrokes as text or binary frames (written to the process stdin) and receives the ' +
      'output as text frames. No TTY is allocated, so a shell reading commands works but ' +
      'full-screen programs do not render. `shell` may be `sh` (default) or `bash`.',
    security: agentAuth,
    parameters: [{ name: 'shell', in: 'query', schema: { type: 'string', enum: ['sh', 'bash'] } }],
    responses: {
      101: { description: 'Protocol switched to WebSocket.' },
      401: errorRes('Invalid agent token.'),
      426: errorRes('Upgrade to WebSocket required.'),
    },
  },
} satisfies Record<string, DocOptions>;
