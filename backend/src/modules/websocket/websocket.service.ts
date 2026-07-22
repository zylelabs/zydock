import { createBunWebSocket } from 'hono/bun';
import type { WSContext } from 'hono/ws';
import { logDebug } from '../../utils/logger';
import type { AuthPayload } from '../auth/auth.middleware';
import { clientMessageSchema } from './websocket.schema';

type Client = {
  id: string;
  auth: AuthPayload;
  socket: WSContext;
  topics: Set<string>;
};

export type TopicAuthorizer = (
  auth: AuthPayload,
  resourceId: string,
  channel: string,
) => Promise<boolean>;

const { upgradeWebSocket, websocket } = createBunWebSocket();

const clients = new Map<string, Client>();

const authorizers = new Map<string, TopicAuthorizer>();

export { upgradeWebSocket, websocket };

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const parseTopic = (topic: string) => {
  const [resource, resourceId, channel] = topic.split(':');

  if (!resource || !resourceId || !channel) {
    return null;
  }

  return { resource, resourceId, channel };
};

export const registerTopicAuthorizer = (resource: string, authorizer: TopicAuthorizer) => {
  authorizers.set(resource, authorizer);
};

export const authorizeTopic = async (auth: AuthPayload, topic: string) => {
  const parsed = parseTopic(topic);

  if (!parsed) {
    return false;
  }

  const authorizer = authorizers.get(parsed.resource);

  if (!authorizer) {
    return false;
  }

  return authorizer(auth, parsed.resourceId, parsed.channel);
};

export const countClients = () => clients.size;

export const registerClient = (socket: WSContext, auth: AuthPayload) => {
  const id = crypto.randomUUID();

  clients.set(id, { id, auth, socket, topics: new Set() });

  logDebug('WebSocket client connected', { clientId: id, userId: auth.sub, clients: clients.size });

  return id;
};

export const unregisterClient = (id: string) => {
  if (!clients.delete(id)) {
    return;
  }

  logDebug('WebSocket client disconnected', { clientId: id, clients: clients.size });
};

export const sendToClient = (id: string, event: string, data: unknown) => {
  const client = clients.get(id);

  if (!client) {
    return false;
  }

  client.socket.send(JSON.stringify({ event, data }));

  return true;
};

export const publish = (topic: string, event: string, data: unknown) => {
  const payload = JSON.stringify({ topic, event, data });

  let delivered = 0;

  for (const client of clients.values()) {
    if (!client.topics.has(topic)) {
      continue;
    }

    client.socket.send(payload);
    delivered += 1;
  }

  return delivered;
};

export const handleClientMessage = async (id: string, raw: unknown) => {
  const client = clients.get(id);

  if (!client) {
    return;
  }

  if (typeof raw !== 'string') {
    sendToClient(id, 'error', { message: 'Only text messages are supported' });
    return;
  }

  const payload = parseJson(raw);

  if (payload === undefined) {
    sendToClient(id, 'error', { message: 'Invalid JSON payload' });
    return;
  }

  const result = clientMessageSchema.safeParse(payload);

  if (!result.success) {
    sendToClient(id, 'error', { message: 'Unsupported message' });
    return;
  }

  const message = result.data;

  if (message.action === 'ping') {
    sendToClient(id, 'pong', { timestamp: new Date().toISOString() });
    return;
  }

  if (message.action === 'unsubscribe') {
    client.topics.delete(message.topic);
    sendToClient(id, 'unsubscribed', { topic: message.topic });
    return;
  }

  if (!(await authorizeTopic(client.auth, message.topic))) {
    sendToClient(id, 'error', { message: 'Not allowed to subscribe to this topic' });
    return;
  }

  client.topics.add(message.topic);
  sendToClient(id, 'subscribed', { topic: message.topic });
};
