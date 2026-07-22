import { createHmac } from 'node:crypto';
import type { NotificationProvider } from './notification.contract';

const REQUEST_TIMEOUT_MS = 10000;
const SIGNATURE_HEADER = 'X-Zydock-Signature';

/**
 * HTTP delivery. When the target carries a secret, the body is signed the same way Zydock verifies
 * incoming webhooks: `sha256=<hmac hex>`, so the receiver can prove the message came from here.
 */
export const createWebhookProvider = (): NotificationProvider => ({
  send: async (target, message) => {
    if (target.channel !== 'webhook') {
      throw new Error(`Webhook provider cannot deliver to the "${target.channel}" channel`);
    }

    const body = JSON.stringify({
      subject: message.subject,
      body: message.body,
      severity: message.severity,
      metadata: message.metadata ?? {},
      sentAt: new Date().toISOString(),
    });

    let response: Response;

    try {
      response = await fetch(target.address, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(target.secret
            ? {
                [SIGNATURE_HEADER]: `sha256=${createHmac('sha256', target.secret)
                  .update(body, 'utf8')
                  .digest('hex')}`,
              }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      throw new Error(`Webhook ${target.address} did not answer: ${reason}`);
    }

    if (!response.ok) {
      throw new Error(`Webhook ${target.address} answered ${response.status}`);
    }
  },
});
