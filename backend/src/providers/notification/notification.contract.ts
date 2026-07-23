export const NOTIFICATION_CHANNELS = ['email', 'webhook'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export type NotificationMessage = {
  subject: string;
  body: string;
  severity: NotificationSeverity;
  metadata?: Record<string, string>;
};

export type NotificationTarget = {
  channel: NotificationChannel;
  address: string;
  secret?: string;
};

export type NotificationResult = {
  target: NotificationTarget;
  delivered: boolean;
  error?: string;
};

export type NotificationProvider = {
  send: (target: NotificationTarget, message: NotificationMessage) => Promise<void>;
};

export type NotificationProviderFactory = () => NotificationProvider;
