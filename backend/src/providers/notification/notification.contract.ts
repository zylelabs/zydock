export const NOTIFICATION_CHANNELS = ['email', 'webhook'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

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
