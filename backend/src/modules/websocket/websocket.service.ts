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

export type TopicEvent = {
  topic: string;
  resource: string;
  resourceId: string;
  channel: string;
  clientId: string;
  /** How many clients are subscribed to the topic after this event. */
  subscribers: number;
};

/**
 * Lets the module that owns a resource know when someone starts or stops watching one of its
 * topics — which is what allows a stream to exist only while there is an audience, without the
 * WebSocket knowing any business module, as with the authorizers.
 */
export type TopicListener = {
  subscribed: (event: TopicEvent) => void;
  unsubscribed: (event: TopicEvent) => void;
};

const { upgradeWebSocket, websocket } = createBunWebSocket();

const clients = new Map<string, Client>();

const authorizers = new Map<string, TopicAuthorizer>();

// A resource can have more than one listener — an application streams both logs and metrics, each in
// its own module — so listeners are kept as a list and every one is notified; each filters by channel.
const listeners = new Map<string, TopicListener[]>();

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

export const registerTopicListener = (resource: string, listener: TopicListener) => {
  const existing = listeners.get(resource) ?? [];

  listeners.set(resource, [...existing, listener]);
};

const countSubscribers = (topic: string) => {
  let total = 0;

  for (const client of clients.values()) {
    if (client.topics.has(topic)) {
      total += 1;
    }
  }

  return total;
};

const notifyTopic = (kind: 'subscribed' | 'unsubscribed', topic: string, clientId: string) => {
  const parsed = parseTopic(topic);

  if (!parsed) {
    return;
  }

  const event = { topic, ...parsed, clientId, subscribers: countSubscribers(topic) };

  for (const listener of listeners.get(parsed.resource) ?? []) {
    listener[kind](event);
  }
};

export const countClients = () => clients.size;

export const registerClient = (socket: WSContext, auth: AuthPayload) => {
  const id = crypto.randomUUID();

  clients.set(id, { id, auth, socket, topics: new Set() });

  logDebug('WebSocket client connected', { clientId: id, userId: auth.sub, clients: clients.size });

  return id;
};

export const unregisterClient = (id: string) => {
  const client = clients.get(id);

  if (!client) {
    return;
  }

  // The topics are read before the client leaves the map, so the count each listener sees already
  // excludes it: a disconnect is the same as unsubscribing from everything.
  const topics = [...client.topics];

  clients.delete(id);

  for (const topic of topics) {
    notifyTopic('unsubscribed', topic, id);
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

/** Same shape as `publish`, but for a single subscriber — used to catch a newcomer up. */
export const publishToClient = (clientId: string, topic: string, event: string, data: unknown) => {
  const client = clients.get(clientId);

  if (!client?.topics.has(topic)) {
    return false;
  }

  client.socket.send(JSON.stringify({ topic, event, data }));

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
    const wasSubscribed = client.topics.delete(message.topic);

    sendToClient(id, 'unsubscribed', { topic: message.topic });

    if (wasSubscribed) {
      notifyTopic('unsubscribed', message.topic, id);
    }

    return;
  }

  if (!(await authorizeTopic(client.auth, message.topic))) {
    sendToClient(id, 'error', { message: 'Not allowed to subscribe to this topic' });
    return;
  }

  // Subscribing twice to the same topic must not look like a second audience to the listener.
  const isNew = !client.topics.has(message.topic);

  client.topics.add(message.topic);
  sendToClient(id, 'subscribed', { topic: message.topic });

  if (isNew) {
    notifyTopic('subscribed', message.topic, id);
  }
};
