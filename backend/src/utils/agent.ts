import config from '../config';

/** Everything the backend needs to reach the agent installed on a managed server. */
export type AgentConnection = {
  serverId: string;
  endpoint: string;
  token: string;
};

export type AgentRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: URLSearchParams;
  body?: unknown;
  /** Sent as-is, for archives: bytes travel raw, never wrapped in JSON. */
  raw?: ReadableStream<Uint8Array>;
  /** Streamed calls answer with an event stream, so they use the caller's signal instead of a timeout. */
  signal?: AbortSignal;
  streamed?: boolean;
  allowedStatuses?: number[];
};

export type AgentEvent = {
  event: string;
  data: string;
};

export const searchParams = (values: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  return params;
};

const describeFailure = async (response: Response) => {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as { error?: unknown };

    return typeof parsed.error === 'string' ? parsed.error : body;
  } catch {
    return body.trim() || `HTTP ${response.status}`;
  }
};

const parseEvent = (raw: string): AgentEvent | null => {
  const data: string[] = [];

  let event = 'message';

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice('data:'.length).trimStart());
    }
  }

  return data.length ? { event, data: data.join('\n') } : null;
};

/** Reads a `text/event-stream` answer, one event at a time. */
export const readAgentEvents = async function* (response: Response): AsyncGenerator<AgentEvent> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const parsed = parseEvent(buffer.slice(0, boundary));

        buffer = buffer.slice(boundary + 2);

        if (parsed) {
          yield parsed;
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};

export const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';

/** A failure the agent itself answered carries the status it used. */
type AgentFailure = Error & { agentStatus?: number };

/**
 * Status the API should answer for a failed agent call: a refusal (400/404) blames the request,
 * anything else — including no answer at all — blames the gateway between us and the runtime.
 */
export const agentFailureStatus = (error: unknown): 400 | 404 | 502 => {
  const status = error instanceof Error ? (error as AgentFailure).agentStatus : undefined;

  return status === 400 || status === 404 ? status : 502;
};

/**
 * HTTP client of the agent, shared by every provider that delegates to a managed server. Failures
 * carry the server id, so an error surfaces where it happened.
 */
export const createAgentClient = (connection: AgentConnection) => {
  const send = async (path: string, options: AgentRequest = {}) => {
    const {
      method = 'GET',
      query,
      body,
      raw,
      signal,
      streamed = false,
      allowedStatuses = [],
    } = options;

    const url = new URL(`/api${path}`, connection.endpoint);

    if (query) {
      url.search = query.toString();
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          'X-Agent-Token': connection.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(raw === undefined ? {} : { 'Content-Type': 'application/octet-stream' }),
        },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
        // A streamed request body has to say it does not wait for the answer to start writing.
        ...(raw === undefined ? {} : { duplex: 'half' }),
        signal: streamed ? signal : AbortSignal.timeout(config.node.requestTimeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      throw new Error(
        `Agent of server ${connection.serverId} did not answer ${method} ${path}: ${reason}`,
      );
    }

    if (!response.ok && !allowedStatuses.includes(response.status)) {
      const failure: AgentFailure = new Error(
        `Agent of server ${connection.serverId} refused ${method} ${path}: ${await describeFailure(response)}`,
      );

      failure.agentStatus = response.status;

      throw failure;
    }

    return response;
  };

  const json = async <T>(path: string, options: AgentRequest = {}) =>
    (await send(path, options)).json() as Promise<T>;

  const discard = async (path: string, options: AgentRequest = {}) => {
    await send(path, options);
  };

  return { send, json, discard };
};
