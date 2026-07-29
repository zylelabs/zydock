export type WebSocketStatus = 'idle' | 'connecting' | 'open' | 'closed';

export type TopicMessage = {
  topic: string;
  event: string;
  data: unknown;
};

export type TopicHandler = (message: TopicMessage) => void;

const PING_INTERVAL_MS = 30000;
const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 15000;

const handlers = new Map<string, Set<TopicHandler>>();

const status = ref<WebSocketStatus>('idle');

let socket: WebSocket | null = null;
let ping: ReturnType<typeof setInterval> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let retryDelay = FIRST_RETRY_MS;

const send = (payload: Record<string, unknown>) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));

    return true;
  }

  return false;
};

const stopTimers = () => {
  clearInterval(ping);
  clearTimeout(retry);
  ping = undefined;
  retry = undefined;
};

const dispatch = (raw: string) => {
  const message = JSON.parse(raw) as Partial<TopicMessage>;

  if (!message.topic) {
    return;
  }

  for (const handler of handlers.get(message.topic) ?? []) {
    handler({ topic: message.topic, event: message.event ?? 'message', data: message.data });
  }
};

const open = () => {
  const { public: runtime } = useRuntimeConfig();
  const session = useSessionStore();

  if (!session.accessToken) {
    status.value = 'closed';
    return;
  }

  const url = new URL(runtime.wsUrl);

  url.searchParams.set('token', session.accessToken);

  status.value = 'connecting';

  let opened = false;

  socket = new WebSocket(url.toString());

  socket.onopen = () => {
    opened = true;
    status.value = 'open';
    retryDelay = FIRST_RETRY_MS;

    for (const topic of handlers.keys()) {
      send({ action: 'subscribe', topic });
    }

    ping = setInterval(() => send({ action: 'ping' }), PING_INTERVAL_MS);
  };

  socket.onmessage = event => {
    if (typeof event.data === 'string') {
      dispatch(event.data);
    }
  };

  socket.onclose = () => {
    status.value = 'closed';
    socket = null;
    stopTimers();

    if (!handlers.size) {
      return;
    }

    const attempt = opened ? open : reopenWithFreshToken;

    retry = setTimeout(attempt, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
  };
};

const reopenWithFreshToken = async () => {
  await renewSession();

  open();
};

const ensureConnection = () => {
  if (import.meta.server || socket || !useSessionStore().accessToken) {
    return;
  }

  open();
};

const close = () => {
  stopTimers();
  handlers.clear();

  const current = socket;

  socket = null;
  status.value = 'idle';

  if (!current) {
    return;
  }

  current.onopen = null;
  current.onmessage = null;
  current.onclose = null;
  current.close();
};

export const useWebSocket = () => {
  const subscribe = (topic: string, handler: TopicHandler) => {
    const existing = handlers.get(topic);

    if (existing) {
      existing.add(handler);
    } else {
      handlers.set(topic, new Set([handler]));
      send({ action: 'subscribe', topic });
    }

    ensureConnection();

    const stop = () => {
      const listeners = handlers.get(topic);

      if (!listeners?.delete(handler) || listeners.size) {
        return;
      }

      handlers.delete(topic);
      send({ action: 'unsubscribe', topic });
    };

    if (getCurrentScope()) {
      onScopeDispose(stop);
    }

    return stop;
  };

  return { status: readonly(status), subscribe, close };
};
