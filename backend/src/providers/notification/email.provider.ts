import { createTransport, type Transporter } from 'nodemailer';
import config from '../../config';
import type { NotificationMessage, NotificationProvider } from './notification.contract';

const SEVERITY_PREFIX: Record<NotificationMessage['severity'], string> = {
  info: '',
  success: '✅ ',
  warning: '⚠️ ',
  error: '❌ ',
};

let transporter: Transporter | null = null;

const settings = () => config.providers.notification.smtp;

/** One transport for the whole process: nodemailer reuses the connection between messages. */
const transport = () => {
  const { host, port, secure, user, password } = settings();

  if (!host) {
    throw new Error('SMTP_HOST is not configured');
  }

  transporter ??= createTransport({
    host,
    port,
    secure,
    ...(user ? { auth: { user, pass: password } } : {}),
  });

  return transporter;
};

const bodyOf = (message: NotificationMessage) => {
  const metadata = Object.entries(message.metadata ?? {});

  if (!metadata.length) {
    return message.body;
  }

  return [message.body, '', ...metadata.map(([key, value]) => `${key}: ${value}`)].join('\n');
};

/** SMTP delivery. Fails loudly — `dispatchNotification` is what turns a failure into a result. */
export const createEmailProvider = (): NotificationProvider => ({
  send: async (target, message) => {
    if (target.channel !== 'email') {
      throw new Error(`Email provider cannot deliver to the "${target.channel}" channel`);
    }

    await transport().sendMail({
      from: settings().from,
      to: target.address,
      subject: `${SEVERITY_PREFIX[message.severity]}${message.subject}`,
      text: bodyOf(message),
    });
  },
});
