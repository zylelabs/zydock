interface NotificationChannelData {
  organizationId: string;
  name: string;
  channel: import('./notification.schema').NotificationChannelKind;
  address: string;
  secret?: string;
  hasSecret: boolean;
  events: import('./notification.schema').NotificationEvent[];
  enabled: boolean;
  lastDeliveryAt?: Date;
  lastError?: string;
}

type NotificationChannel = BaseDocument<NotificationChannelData>;

interface NotificationData {
  organizationId: string;
  channelId: string;
  event: import('./notification.schema').NotificationEvent;
  subject: string;
  body: string;
  severity: import('./notification.schema').NotificationSeverityName;
  metadata: Record<string, string>;
  status: import('./notification.schema').NotificationStatus;
  sentAt?: Date;
  error?: string;
}

type Notification = BaseDocument<NotificationData>;
