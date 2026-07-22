import { createBunWebSocket } from 'hono/bun';
import type { WSContext } from 'hono/ws';
import { logDebug } from '../../utils/logger';
import { clientMessageSchema } from './websocket.schema';

type Client = {
  id: string;
  socket: WSContext;
  topics: Set<string>;
};

const { upgradeWebSocket, websocket } = createBunWebSocket();

const clients = new Map<string, Client>();

export { upgradeWebSocket, websocket };

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const countClients = () => clients.size;

export const registerClient = (socket: WSContext) => {
  const id = crypto.randomUUID();

  clients.set(id, { id, socket, topics: new Set() });

  logDebug('WebSocket client connected', { clientId: id, clients: clients.size });

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

export const subscribeClient = (id: string, topic: string) => {
  const client = clients.get(id);

  if (!client) {
    return false;
  }

  client.topics.add(topic);

  return true;
};

export const unsubscribeClient = (id: string, topic: string) => {
  const client = clients.get(id);

  if (!client) {
    return false;
  }

  client.topics.delete(topic);

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

export const handleClientMessage = (id: string, raw: unknown) => {
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

  if (message.action === 'subscribe') {
    subscribeClient(id, message.topic);
    sendToClient(id, 'subscribed', { topic: message.topic });
    return;
  }

  unsubscribeClient(id, message.topic);
  sendToClient(id, 'unsubscribed', { topic: message.topic });
};
