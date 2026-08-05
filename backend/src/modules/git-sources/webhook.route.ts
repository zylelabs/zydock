import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { logWarn } from '../../utils/logger';
import gitSourceModel from './git-source.model';
import { gitSourceWebhookDocs } from './webhook.docs';
import { handleGitSourcePush } from './webhook.service';

const { router, post } = createRouter();

post('/github-app/:gitSourceId', gitSourceWebhookDocs.receive, async (c: Context) => {
  const gitSourceId = c.req.param('gitSourceId');
  const body = await c.req.text();

  if (!gitSourceId || gitSourceId.length !== 24) {
    return c.json({ error: 'Git source not found' }, 404);
  }

  const gitSource = await gitSourceModel.findById(gitSourceId).select('+webhookSecret');

  if (!gitSource) {
    return c.json({ error: 'Git source not found' }, 404);
  }

  const outcome = await handleGitSourcePush(gitSource, {
    headers: Object.fromEntries(
      Object.entries(c.req.header()).map(([key, value]) => [key, String(value)]),
    ),
    body,
  });

  if (!outcome.accepted) {
    logWarn('Git source webhook refused', { gitSource: gitSourceId, reason: outcome.reason });

    return c.json({ message: outcome.reason }, outcome.reason === 'Invalid signature' ? 401 : 200);
  }

  return c.json({ message: 'Deployment(s) queued', queued: outcome.queued }, 202);
});

export default router;
