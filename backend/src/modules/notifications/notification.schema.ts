import { z } from 'zod';
// Imported from the contract, not the index: the index re-exports them as types only.
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SEVERITIES,
} from '../../providers/notification/notification.contract';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export type NotificationChannelKind = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationSeverityName = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_EVENTS = [
  'deployment.started',
  'deployment.succeeded',
  'deployment.failed',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const notificationChannelIdParamSchema = organizationIdParamSchema.extend({
  channelId: z.string().length(24),
});

export type NotificationChannelIdParam = z.infer<typeof notificationChannelIdParamSchema>;

const emailAddressSchema = z.email().max(320);

const webhookAddressSchema = z
  .url()
  .max(500)
  .refine(value => /^https?:\/\//i.test(value), 'The webhook URL must use http or https');

/**
 * The address means a different thing per channel: an e-mail for `email`, an HTTP endpoint for
 * `webhook`. Returns the problem, or nothing when the address fits the channel.
 */
export const addressIssue = (channel: NotificationChannelKind, address: string) => {
  if (channel === 'email') {
    return emailAddressSchema.safeParse(address).success
      ? undefined
      : 'The address must be an e-mail';
  }

  return webhookAddressSchema.safeParse(address).success
    ? undefined
    : 'The address must be an http or https URL';
};

const channelFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  channel: z.enum(NOTIFICATION_CHANNELS),
  address: z.string().trim().min(1).max(500),
  // Only a webhook uses it: the body is signed with it, like every webhook Zydock verifies.
  secret: z.string().trim().min(8).max(200).optional(),
  events: z
    .array(z.enum(NOTIFICATION_EVENTS))
    .min(1)
    .default([...NOTIFICATION_EVENTS]),
  enabled: z.boolean().default(true),
});

export const createNotificationChannelSchema = channelFieldsSchema.superRefine((value, ctx) => {
  const issue = addressIssue(value.channel, value.address);

  if (issue) {
    ctx.addIssue({ code: 'custom', path: ['address'], message: issue });
  }

  if (value.channel === 'email' && value.secret) {
    ctx.addIssue({
      code: 'custom',
      path: ['secret'],
      message: 'Only a webhook channel accepts a secret',
    });
  }
});

export type CreateNotificationChannelDTO = z.infer<typeof createNotificationChannelSchema>;

// The channel is immutable: an e-mail address is not a URL, and the secret only fits one of them.
export const updateNotificationChannelSchema = channelFieldsSchema
  .omit({ channel: true })
  .extend({ secret: z.string().trim().min(8).max(200).nullable() })
  .partial();

export type UpdateNotificationChannelDTO = z.infer<typeof updateNotificationChannelSchema>;

export const listNotificationChannelsQuerySchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  enabled: z.stringbool().optional(),
});

export type ListNotificationChannelsQuery = z.infer<typeof listNotificationChannelsQuerySchema>;

export const listNotificationsQuerySchema = z.object({
  channelId: z.string().length(24).optional(),
  event: z.enum(NOTIFICATION_EVENTS).optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
