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

const readBoolean = (name: string, fallback: boolean) => {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return value.trim().toLowerCase() === 'true';
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

const accessAggregateIntervalSeconds = readNumber('PROXY_ACCESS_AGGREGATE_INTERVAL_SECONDS', 30);

export default {
  port: readNumber('PORT', 9000),
  bindHost: readString('BIND_HOST', '127.0.0.1'),
  idleTimeoutSeconds: Math.min(readNumber('SERVER_IDLE_TIMEOUT_SECONDS', 120), 255),
  mode: readString('MODE', 'prod'),
  logLevel: readLogLevel(),
  serverId: readString('SERVER_ID', ''),
  agentToken: readRequired('AGENT_TOKEN'),
  backendUrl: readString('BACKEND_URL', 'http://localhost:8000'),
  heartbeatIntervalSeconds: readNumber('HEARTBEAT_INTERVAL_SECONDS', 30),
  healthCheckIntervalSeconds: readNumber('HEALTH_CHECK_INTERVAL_SECONDS', 30),
  metricsCacheTtlSeconds: readNumber('METRICS_CACHE_TTL_SECONDS', 8),
  workspacePath: readString('WORKSPACE_PATH', '/var/lib/zydock/builds'),
  dockerSocketPath: readString('DOCKER_SOCKET_PATH', '/var/run/docker.sock'),
  allowSystemContainerRemoval: readBoolean('ALLOW_SYSTEM_CONTAINER_REMOVAL', false),
  installPath: readString('ZYDOCK_INSTALL_DIR', '/data/zydock'),
  updaterImage: readString('UPDATER_IMAGE', 'docker:cli'),
  files: {
    maxUploadBytes: readNumber('FILES_MAX_UPLOAD_BYTES', 500 * 1024 * 1024),
    maxReadAsTextBytes: readNumber('FILES_MAX_READ_AS_TEXT_BYTES', 2 * 1024 * 1024),
    maxListEntries: readNumber('FILES_MAX_LIST_ENTRIES', 1000),
    maxPathDepth: readNumber('FILES_MAX_PATH_DEPTH', 16),
  },
  tls: {
    certPath: readString('TLS_CERT_PATH', ''),
    keyPath: readString('TLS_KEY_PATH', ''),
    caPath: readString('TLS_CA_PATH', ''),
  },
  proxy: {
    adminUrl: readString('CADDY_ADMIN_URL', 'http://127.0.0.1:2019'),
    httpsHost: readString('PROXY_HTTPS_HOST', '127.0.0.1'),
    httpsPort: readNumber('PROXY_HTTPS_PORT', 443),
    containerService: readString('PROXY_CONTAINER_SERVICE', 'caddy'),
    accessAggregateIntervalSeconds,
    accessAggregateMaxTailLines: readNumber(
      'PROXY_ACCESS_AGGREGATE_MAX_TAIL_LINES',
      Math.min(5000, Math.max(200, accessAggregateIntervalSeconds * 50)),
    ),
  },
};
