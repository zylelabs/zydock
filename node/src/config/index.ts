const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const readString = (name: string, fallback: string) => {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return value.trim();
};

const readNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
};

const readRequired = (name: string) => {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not defined in the environment`);
  }

  return value.trim();
};

const readLogLevel = (): LogLevel => {
  const value = readString('LOG_LEVEL', 'info');
  const level = LOG_LEVELS.find(candidate => candidate === value);

  if (!level) {
    throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  return level;
};

export default {
  port: readNumber('PORT', 9000),
  mode: readString('MODE', 'prod'),
  logLevel: readLogLevel(),
  serverId: readRequired('SERVER_ID'),
  agentToken: readRequired('AGENT_TOKEN'),
  backendUrl: readString('BACKEND_URL', 'http://localhost:8000'),
  heartbeatIntervalSeconds: readNumber('HEARTBEAT_INTERVAL_SECONDS', 30),
  healthCheckIntervalSeconds: readNumber('HEALTH_CHECK_INTERVAL_SECONDS', 30),
  metricsCacheTtlSeconds: readNumber('METRICS_CACHE_TTL_SECONDS', 5),
  workspacePath: readString('WORKSPACE_PATH', '/var/lib/zydock/builds'),
  proxy: {
    // The proxy runs on this same host; its admin API must never be exposed to the network.
    adminUrl: readString('CADDY_ADMIN_URL', 'http://127.0.0.1:2019'),
    httpsPort: readNumber('PROXY_HTTPS_PORT', 443),
  },
};
