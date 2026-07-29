import config from '../config';

export type AgentConnection = {
  serverId: string;
  endpoint: string;
  token: string;
};

export type AgentRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: URLSearchParams;
  body?: unknown;
  raw?: ReadableStream<Uint8Array>;
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

type AgentFailure = Error & { agentStatus?: number };

export const agentFailureStatus = (error: unknown): 400 | 404 | 502 => {
  const status = error instanceof Error ? (error as AgentFailure).agentStatus : undefined;

  return status === 400 || status === 404 ? status : 502;
};

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
        ...(raw === undefined ? {} : { duplex: 'half' }),
        signal: streamed ? signal : AbortSignal.timeout(config.agent.requestTimeoutMs),
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
