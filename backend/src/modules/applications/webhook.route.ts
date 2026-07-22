import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { logWarn } from '../../utils/logger';
import applicationModel from './application.model';
import { webhookDocs } from './webhook.docs';
import { handleGitWebhook } from './webhook.service';

const { router, post } = createRouter();

/**
 * Called by the git host, not by a user: there is no session here. The HMAC signature is the whole
 * authentication, which is why the raw body is read before anything else touches it.
 */
post('/git/:applicationId', webhookDocs.receive, async (c: Context) => {
  const applicationId = c.req.param('applicationId');
  const body = await c.req.text();

  if (!applicationId || applicationId.length !== 24) {
    return c.json({ error: 'Application not found' }, 404);
  }

  const application = await applicationModel
    .findById(applicationId)
    .select('+git.token +git.webhookSecret');

  if (!application) {
    return c.json({ error: 'Application not found' }, 404);
  }

  const outcome = await handleGitWebhook(application, {
    headers: Object.fromEntries(
      Object.entries(c.req.header()).map(([key, value]) => [key, String(value)]),
    ),
    body,
  });

  if (!outcome.accepted) {
    logWarn('Webhook refused', { application: applicationId, reason: outcome.reason });

    // A bad signature is the only case that deserves a refusal status; the rest are valid
    // deliveries that simply do not lead to a deploy, and the host should not retry them.
    return c.json({ message: outcome.reason }, outcome.reason === 'Invalid signature' ? 401 : 200);
  }

  return c.json({ message: 'Deployment queued', deployment: outcome.deploymentId }, 202);
});

export default router;
