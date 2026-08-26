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
      'started with `stdin_open: true`. A container that is part of the Zydock platform refuses ' +
      'the session: the socket opens and immediately sends an error frame before closing. When ' +
      '`replay=1`, history is written to the socket before the live session starts: with ' +
      '`replayFile`, the last `replayTail` lines of that file inside the container (`tail -n ' +
      '<replayTail> -- <replayFile>`); without it, the last `replayTail` lines of the ' +
      "container's stdout/stderr. A replay failure is logged and never blocks the live session.",
    security: agentAuth,
    parameters: [
      { name: 'shell', in: 'query', schema: { type: 'string', enum: ['sh', 'bash'] } },
      { name: 'mode', in: 'query', schema: { type: 'string', enum: ['shell', 'attach'] } },
      { name: 'replay', in: 'query', schema: { type: 'string', enum: ['1'] } },
      { name: 'replayFile', in: 'query', schema: { type: 'string' } },
      { name: 'replayTail', in: 'query', schema: { type: 'integer' } },
    ],
    responses: {
      101: { description: 'Protocol switched to WebSocket.' },
      401: errorRes('Invalid agent token.'),
      426: errorRes('Upgrade to WebSocket required.'),
    },
  },
} satisfies Record<string, DocOptions>;
