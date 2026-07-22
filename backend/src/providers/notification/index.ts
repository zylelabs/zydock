import { logWarn } from '../../utils/logger';
import {
  type NotificationChannel,
  type NotificationMessage,
  type NotificationProvider,
  type NotificationProviderFactory,
  type NotificationResult,
  type NotificationTarget,
} from './notification.contract';
import { createEmailProvider } from './email.provider';
import { createWebhookProvider } from './webhook.provider';

const factories: Partial<Record<NotificationChannel, NotificationProviderFactory>> = {
  email: createEmailProvider,
  webhook: createWebhookProvider,
};

export const resolveNotificationProvider = (channel: NotificationChannel): NotificationProvider => {
  const factory = factories[channel];

  if (!factory) {
    throw new Error(`Notification channel "${channel}" has no registered implementation`);
  }

  return factory();
};

const deliver = async (
  target: NotificationTarget,
  message: NotificationMessage,
): Promise<NotificationResult> => {
  try {
    const provider = resolveNotificationProvider(target.channel);

    await provider.send(target, message);

    return { target, delivered: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    logWarn('Notification delivery failed', { channel: target.channel, error: reason });

    return { target, delivered: false, error: reason };
  }
};

export const dispatchNotification = async (
  message: NotificationMessage,
  targets: NotificationTarget[],
): Promise<NotificationResult[]> => Promise.all(targets.map(target => deliver(target, message)));

export type * from './notification.contract';
