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

/**
 * One connection for the whole application: topics are multiplexed over it, so ten panels watching
 * logs and metrics cost one socket. The state lives in the module, not in the composable call.
 */
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

  // The token travels in the query string because a browser WebSocket cannot carry headers; it is
  // the short-lived access token, and the connection is upgraded before anything else is read.
  const url = new URL(runtime.wsUrl);

  url.searchParams.set('token', session.accessToken);

  status.value = 'connecting';

  let opened = false;

  socket = new WebSocket(url.toString());

  socket.onopen = () => {
    opened = true;
    status.value = 'open';
    retryDelay = FIRST_RETRY_MS;

    // A reconnection has to say again what it was watching: the server keeps no memory of it.
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

    // Reconnects only while something is still being watched, with a growing delay.
    if (!handlers.size) {
      return;
    }

    // A connection that never opened was most likely refused for an expired access token — the one
    // failure a retry alone can never fix, since the token in the query string would be the same.
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

  // Detached before closing: the late `onclose` of a socket nobody wants anymore must not put the
  // status back to `closed` — this connection was ended on purpose.
  current.onopen = null;
  current.onmessage = null;
  current.onclose = null;
  current.close();
};

/**
 * Real time of the whole interface: deploy steps, logs and metrics arrive as events of a topic
 * (`<resource>:<id>:<channel>`), authorized by the backend at subscription time.
 */
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

    // Inside a component, watching stops when the component goes — nobody has to remember it.
    if (getCurrentScope()) {
      onScopeDispose(stop);
    }

    return stop;
  };

  return { status: readonly(status), subscribe, close };
};
