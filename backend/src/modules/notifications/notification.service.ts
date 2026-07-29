import {
  dispatchNotification,
  resolveNotificationProvider,
  type NotificationMessage,
  type NotificationTarget,
} from '../../providers/notification';
import { errorMessage } from '../../utils';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import { logInfo } from '../../utils/logger';
import applicationModel from '../applications/application.model';
import deploymentModel from '../deployments/deployment.model';
import { enqueueJob, registerJobHandler } from '../queue/queue.service';
import notificationChannelModel from './notification-channel.model';
import notificationModel from './notification.model';
import type {
  CreateNotificationChannelDTO,
  NotificationEvent,
  NotificationSeverityName,
  UpdateNotificationChannelDTO,
} from './notification.schema';

export const NOTIFICATION_JOB = 'notification.deliver';

const SEVERITY_OF_EVENT: Record<NotificationEvent, NotificationSeverityName> = {
  'deployment.started': 'info',
  'deployment.succeeded': 'success',
  'deployment.failed': 'error',
};

export const findNotificationChannel = (organizationId: string, channelId: string) =>
  notificationChannelModel.findOne({ _id: channelId, organizationId });

const findChannelWithSecret = (channelId: string) =>
  notificationChannelModel.findById(channelId).select('+secret');

export const createNotificationChannel = (
  organizationId: string,
  body: CreateNotificationChannelDTO,
) =>
  notificationChannelModel.create({
    organizationId,
    name: body.name,
    channel: body.channel,
    address: body.address,
    secret: body.secret ? encryptSecret(body.secret) : undefined,
    hasSecret: Boolean(body.secret),
    events: body.events,
    enabled: body.enabled,
  });

export const updateNotificationChannel = (
  channel: NotificationChannel,
  body: UpdateNotificationChannelDTO,
) =>
  notificationChannelModel.findByIdAndUpdate(
    channel._id,
    {
      $set: {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.address === undefined ? {} : { address: body.address }),
        ...(body.events === undefined ? {} : { events: body.events }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.secret ? { secret: encryptSecret(body.secret), hasSecret: true } : {}),
        ...(body.secret === null ? { hasSecret: false } : {}),
      },
      ...(body.secret === null ? { $unset: { secret: '' } } : {}),
    },
    { new: true },
  );

export const removeNotificationChannel = async (channel: NotificationChannel) => {
  await notificationModel.deleteMany({ channelId: channel._id });
  await notificationChannelModel.deleteOne({ _id: channel._id });
};

export const removeNotificationsOfOrganization = async (organizationId: string) => {
  await notificationModel.deleteMany({ organizationId });
  await notificationChannelModel.deleteMany({ organizationId });
};

const targetOf = (channel: NotificationChannel): NotificationTarget => ({
  channel: channel.channel,
  address: channel.address,
  secret: channel.secret ? decryptSecret(channel.secret) : undefined,
});

const recordChannelOutcome = (channelId: string, error?: string) =>
  notificationChannelModel.updateOne(
    { _id: channelId },
    error
      ? { $set: { lastError: error } }
      : { $set: { lastDeliveryAt: new Date() }, $unset: { lastError: '' } },
  );

export const testNotificationChannel = async (channel: NotificationChannel) => {
  const withSecret = await findChannelWithSecret(String(channel._id));

  const [result] = await dispatchNotification(
    {
      subject: `Test notification — ${channel.name}`,
      body: 'This is a test message sent from Zydock to check this notification channel.',
      severity: 'info',
      metadata: { channel: channel.channel, organization: String(channel.organizationId) },
    },
    [targetOf(withSecret ?? channel)],
  );

  await recordChannelOutcome(String(channel._id), result?.delivered ? undefined : result?.error);

  return { delivered: Boolean(result?.delivered), error: result?.error };
};

export const emitNotification = async (
  organizationId: string,
  event: NotificationEvent,
  message: Omit<NotificationMessage, 'severity'>,
) => {
  const channels = await notificationChannelModel.find({
    organizationId,
    enabled: true,
    events: event,
  });

  for (const channel of channels) {
    const notification = await notificationModel.create({
      organizationId,
      channelId: channel._id,
      event,
      subject: message.subject,
      body: message.body,
      severity: SEVERITY_OF_EVENT[event],
      metadata: message.metadata ?? {},
      status: 'pending',
    });

    await enqueueJob(NOTIFICATION_JOB, { notificationId: String(notification._id) });
  }

  return channels.length;
};

const durationOf = (deployment: Deployment) =>
  deployment.durationMs ? `${Math.round(deployment.durationMs / 1000)}s` : undefined;

const bodyOfDeploymentEvent = (
  event: NotificationEvent,
  application: Application,
  deployment: Deployment,
) => {
  const target = `${application.name} (branch ${deployment.branch})`;

  if (event === 'deployment.started') {
    return `The deploy of ${target} has started.`;
  }

  if (event === 'deployment.succeeded') {
    return `The deploy of ${target} finished successfully.`;
  }

  return `The deploy of ${target} failed: ${deployment.error ?? 'unknown error'}`;
};

const SUBJECT_OF_EVENT: Record<NotificationEvent, string> = {
  'deployment.started': 'Deploy started',
  'deployment.succeeded': 'Deploy succeeded',
  'deployment.failed': 'Deploy failed',
};

export const notifyDeploymentEvent = async (deploymentId: string, event: NotificationEvent) => {
  const deployment = await deploymentModel.findById(deploymentId);

  if (!deployment) {
    return 0;
  }

  const application = await applicationModel.findById(deployment.applicationId);

  if (!application) {
    return 0;
  }

  const metadata: Record<string, string> = {
    event,
    application: application.name,
    applicationId: String(application._id),
    deployment: String(deployment._id),
    branch: deployment.branch,
    trigger: deployment.trigger,
    status: deployment.status,
  };

  const commit = deployment.commit?.sha;
  const duration = durationOf(deployment);

  return emitNotification(String(deployment.organizationId), event, {
    subject: `${SUBJECT_OF_EVENT[event]} — ${application.name}`,
    body: bodyOfDeploymentEvent(event, application, deployment),
    metadata: {
      ...metadata,
      ...(commit ? { commit: commit.slice(0, 7) } : {}),
      ...(duration ? { duration } : {}),
      ...(deployment.error ? { error: deployment.error } : {}),
    },
  });
};

const messageOf = (notification: Notification): NotificationMessage => ({
  subject: notification.subject,
  body: notification.body,
  severity: notification.severity,
  metadata: notification.metadata,
});

const markSent = (notificationId: string) =>
  notificationModel.updateOne(
    { _id: notificationId },
    { $set: { status: 'sent', sentAt: new Date() }, $unset: { error: '' } },
  );

const markFailure = (notificationId: string, error: string, exhausted: boolean) =>
  notificationModel.updateOne(
    { _id: notificationId },
    { $set: { status: exhausted ? 'failed' : 'pending', error } },
  );

registerJobHandler(NOTIFICATION_JOB, async (payload, job) => {
  const notification = await notificationModel.findById(String(payload.notificationId));

  if (!notification || notification.status === 'sent') {
    return;
  }

  const channel = await findChannelWithSecret(String(notification.channelId));

  if (!channel) {
    await markFailure(String(notification._id), 'The notification channel no longer exists', true);
    return;
  }

  try {
    await resolveNotificationProvider(channel.channel).send(
      targetOf(channel),
      messageOf(notification),
    );

    await markSent(String(notification._id));
    await recordChannelOutcome(String(channel._id));

    logInfo('Notification delivered', {
      notification: String(notification._id),
      channel: channel.channel,
      event: notification.event,
    });
  } catch (error) {
    const reason = errorMessage(error);

    await markFailure(String(notification._id), reason, job.attempts >= job.maxAttempts);
    await recordChannelOutcome(String(channel._id), reason);

    throw error;
  }
});

export const listNotificationChannelsOfOrganization = (organizationId: string) =>
  notificationChannelModel.find({ organizationId }).sort({ createdAt: 1 });

export const serializeNotificationChannel = (channel: NotificationChannel) => ({
  id: String(channel._id),
  organizationId: String(channel.organizationId),
  name: channel.name,
  channel: channel.channel,
  address: channel.address,
  hasSecret: channel.hasSecret,
  events: channel.events,
  enabled: channel.enabled,
  lastDeliveryAt: channel.lastDeliveryAt,
  lastError: channel.lastError,
  createdAt: channel.createdAt,
});

export const serializeNotification = (notification: Notification) => ({
  id: String(notification._id),
  channelId: String(notification.channelId),
  event: notification.event,
  subject: notification.subject,
  body: notification.body,
  severity: notification.severity,
  metadata: notification.metadata,
  status: notification.status,
  sentAt: notification.sentAt,
  error: notification.error,
  createdAt: notification.createdAt,
});
