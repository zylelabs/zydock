import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { commandsDocs } from './commands.docs';
import { ALLOWED_COMMANDS, RunCommandDTO, runCommandSchema } from './commands.schema';
import { runAllowedCommand } from './commands.service';

const { router, get, post } = createRouter();

get('/', commandsDocs.list, agentAuthMiddleware, (c: Context) =>
  c.json({ commands: ALLOWED_COMMANDS }),
);

post(
  '/',
  commandsDocs.run,
  agentAuthMiddleware,
  validator('json', runCommandSchema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as RunCommandDTO;

    return c.json(await runAllowedCommand(body.name));
  },
);

export default router;
