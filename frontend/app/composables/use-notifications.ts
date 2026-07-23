import type { Paginated } from '~/composables/use-api';

export const NOTIFICATION_CHANNELS = ['email', 'webhook'] as const;

export type NotificationChannelKind = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_EVENTS = [
  'deployment.started',
  'deployment.succeeded',
  'deployment.failed',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export type NotificationStatus = 'pending' | 'sent' | 'failed';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface NotificationChannel {
  id: string;
  organizationId: string;
  name: string;
  channel: NotificationChannelKind;
  address: string;
  hasSecret: boolean;
  events: NotificationEvent[];
  enabled: boolean;
  lastDeliveryAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  channelId: string;
  event: NotificationEvent;
  subject: string;
  body: string;
  severity: NotificationSeverity;
  metadata: Record<string, string>;
  status: NotificationStatus;
  sentAt?: string;
  error?: string;
  createdAt: string;
}

export interface CreateNotificationChannelBody {
  name: string;
  channel: NotificationChannelKind;
  address: string;
  secret?: string;
  events: NotificationEvent[];
  enabled: boolean;
}

export interface UpdateNotificationChannelBody {
  name?: string;
  address?: string;
  secret?: string | null;
  events?: NotificationEvent[];
  enabled?: boolean;
}

export const useNotifications = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/notifications`;

  const listChannels = (filter: { channel?: NotificationChannelKind; enabled?: boolean } = {}) =>
    api.get<Paginated<NotificationChannel>>(`${base()}/channels`, {
      query: { size: 100, ...filter },
    });
  const createChannel = (body: CreateNotificationChannelBody) =>
    api.post<{ channel: NotificationChannel }>(`${base()}/channels`, { body });
  const updateChannel = (channelId: string, body: UpdateNotificationChannelBody) =>
    api.patch<{ channel: NotificationChannel }>(`${base()}/channels/${channelId}`, { body });
  const testChannel = (channelId: string) =>
    api.post<{ delivered: boolean; error?: string }>(`${base()}/channels/${channelId}/test`);
  const removeChannel = (channelId: string) =>
    api.del<{ message: string }>(`${base()}/channels/${channelId}`);

  const listNotifications = (
    filter: { channelId?: string; event?: NotificationEvent; status?: NotificationStatus } = {},
  ) => api.get<Paginated<Notification>>(base(), { query: { size: 50, ...filter } });

  return {
    listChannels,
    createChannel,
    updateChannel,
    testChannel,
    removeChannel,
    listNotifications,
  };
};
