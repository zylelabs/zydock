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

const readList = (name: string) =>
  readString(name, '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);

const readEncryptionKey = () => {
  const value = readRequired('ENCRYPTION_KEY');

  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as 64 hexadecimal characters');
  }

  return value.toLowerCase();
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
  port: readNumber('PORT', 8000),
  idleTimeoutSeconds: Math.min(readNumber('SERVER_IDLE_TIMEOUT_SECONDS', 120), 255),
  mode: readString('MODE', 'prod'),
  version: readString('ZYDOCK_VERSION', ''),
  commit: readString('ZYDOCK_COMMIT', ''),
  channel: readString('ZYDOCK_CHANNEL', ''),
  logLevel: readLogLevel(),
  corsOrigin: readString('CORS_ORIGIN', 'http://localhost:3000'),
  appUrl: readString('APP_URL', 'http://localhost:3000'),
  backendUrl: readString('BACKEND_URL', 'http://localhost:8000'),
  frontendUrl: readString('FRONTEND_URL', 'http://frontend:3000'),
  dashboard: {
    domain: readString('ZYDOCK_DOMAIN', ''),
  },
  mongodb: {
    uri: readRequired('MONGO_URI'),
  },
  jwt: {
    secret: readRequired('JWT_SECRET'),
    accessTokenTtlSeconds: readNumber('JWT_ACCESS_TTL_SECONDS', 60 * 15),
    refreshTokenTtlDays: readNumber('JWT_REFRESH_TTL_DAYS', 30),
  },
  auth: {
    superusers: readList('SUPERUSER_EMAILS'),
    passwordResetTtlMinutes: readNumber('PASSWORD_RESET_TTL_MINUTES', 30),
  },
  rateLimit: {
    signin: {
      windowMs: readNumber('RATE_LIMIT_SIGNIN_WINDOW_MS', 15 * 60 * 1000),
      max: readNumber('RATE_LIMIT_SIGNIN_MAX', 10),
    },
    signup: {
      windowMs: readNumber('RATE_LIMIT_SIGNUP_WINDOW_MS', 60 * 60 * 1000),
      max: readNumber('RATE_LIMIT_SIGNUP_MAX', 10),
    },
    forgotPassword: {
      windowMs: readNumber('RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS', 15 * 60 * 1000),
      max: readNumber('RATE_LIMIT_FORGOT_PASSWORD_MAX', 5),
    },
    resetPassword: {
      windowMs: readNumber('RATE_LIMIT_RESET_PASSWORD_WINDOW_MS', 15 * 60 * 1000),
      max: readNumber('RATE_LIMIT_RESET_PASSWORD_MAX', 10),
    },
    refresh: {
      windowMs: readNumber('RATE_LIMIT_REFRESH_WINDOW_MS', 15 * 60 * 1000),
      max: readNumber('RATE_LIMIT_REFRESH_MAX', 30),
    },
    inviteAccept: {
      windowMs: readNumber('RATE_LIMIT_INVITE_ACCEPT_WINDOW_MS', 15 * 60 * 1000),
      max: readNumber('RATE_LIMIT_INVITE_ACCEPT_MAX', 10),
    },
  },
  security: {
    encryptionKey: readEncryptionKey(),
  },
  agent: {
    port: readNumber('AGENT_PORT', 9000),
    requestTimeoutMs: readNumber('AGENT_TIMEOUT_MS', 15000),
    offlineAfterSeconds: readNumber('AGENT_OFFLINE_AFTER_SECONDS', 90),
    bundlePath: readString('AGENT_BUNDLE_PATH', '../agent/dist/agent.js'),
  },
  localServer: {
    token: readString('LOCAL_AGENT_TOKEN', ''),
    name: readString('LOCAL_SERVER_NAME', 'Local'),
    agentHost: readString('LOCAL_AGENT_HOST', 'agent'),
    agentPort: readNumber('LOCAL_AGENT_PORT', 9000),
    publicIp: readString('PUBLIC_IP', ''),
  },
  defaultOrganization: {
    name: readString('DEFAULT_ORGANIZATION_NAME', 'My organization'),
  },
  queue: {
    enabled: readBoolean('QUEUE_ENABLED', true),
    pollIntervalMs: readNumber('QUEUE_POLL_INTERVAL_MS', 1000),
    concurrency: readNumber('QUEUE_CONCURRENCY', 2),
    maxAttempts: readNumber('QUEUE_MAX_ATTEMPTS', 3),
    retryDelayMs: readNumber('QUEUE_RETRY_DELAY_MS', 5000),
    jobTimeoutSeconds: readNumber('QUEUE_JOB_TIMEOUT_SECONDS', 1800),
  },
  deploy: {
    workspacePath: readString('DEPLOY_WORKSPACE_PATH', '/var/lib/zydock/builds'),
    healthcheckTimeoutSeconds: readNumber('DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS', 180),
    healthcheckMaxSeconds: readNumber('DEPLOY_HEALTHCHECK_MAX_SECONDS', 3600),
    logLines: readNumber('DEPLOY_LOG_LINES', 500),
  },
  logs: {
    streamTail: readNumber('LOGS_STREAM_TAIL', 100),
  },
  proxy: {
    network: readString('PROXY_NETWORK', 'zydock'),
    accessRetentionHours: readNumber('PROXY_ACCESS_RETENTION_HOURS', 168),
  },
  autoDomain: {
    enabled: readBoolean('AUTO_DOMAIN_ENABLED', true),
    suffix: readString('AUTO_DOMAIN_SUFFIX', 'backname.io'),
  },
  compose: {
    registryAllowlist: (() => {
      const configured = readList('COMPOSE_REGISTRY_ALLOWLIST');

      return configured.length ? configured : ['docker.io', 'ghcr.io', 'quay.io'];
    })(),
    maxServices: readNumber('COMPOSE_MAX_SERVICES', 10),
    defaultMemoryLimitMb: readNumber('COMPOSE_DEFAULT_MEMORY_LIMIT_MB', 512),
  },
  metrics: {
    retentionHours: readNumber('METRICS_RETENTION_HOURS', 168),
    streamIntervalSeconds: readNumber('METRICS_STREAM_INTERVAL_SECONDS', 5),
  },
  databaseMetrics: {
    enabled: readBoolean('DATABASE_METRICS_ENABLED', true),
    sampleIntervalMinutes: readNumber('DATABASE_METRICS_SAMPLE_INTERVAL_MINUTES', 5),
    retentionHours: readNumber('DATABASE_METRICS_RETENTION_HOURS', 48),
    peakWindowHours: readNumber('DATABASE_METRICS_PEAK_WINDOW_HOURS', 24),
  },
  notifications: {
    retentionHours: readNumber('NOTIFICATIONS_RETENTION_HOURS', 720),
  },
  updates: {
    repository: readString('ZYDOCK_REPOSITORY', 'zylelabs/zydock'),
  },
  templates: {
    catalogPath: readString('TEMPLATES_CATALOG_PATH', '../templates'),
    sourcesCachePath: readString('TEMPLATE_SOURCES_CACHE_PATH', '../template-sources-cache'),
    sourceCloneTimeoutMs: readNumber('TEMPLATE_SOURCES_CLONE_TIMEOUT_MS', 30000),
  },
  providers: {
    container: { runtime: readString('CONTAINER_RUNTIME', 'docker') },
    reverseProxy: { implementation: readString('REVERSE_PROXY', 'caddy') },
    storage: {
      implementation: readString('STORAGE_PROVIDER', 'local'),
      localPath: readString('STORAGE_LOCAL_PATH', './storage'),
    },
    notification: {
      smtp: {
        host: readString('SMTP_HOST', ''),
        port: readNumber('SMTP_PORT', 587),
        secure: readBoolean('SMTP_SECURE', false),
        user: readString('SMTP_USER', ''),
        password: readString('SMTP_PASSWORD', ''),
        from: readString('SMTP_FROM', 'Zydock <no-reply@localhost>'),
      },
    },
    dns: { implementation: readString('DNS_PROVIDER', 'cloudflare') },
    git: { defaultHost: readString('GIT_DEFAULT_HOST', 'github') },
    ssh: { implementation: readString('SSH_PROVIDER', 'ssh2') },
    tls: { implementation: readString('TLS_PROVIDER', 'openssl') },
    registry: {
      enabled: readBoolean('REGISTRY_TAGS_ENABLED', true),
      ttlHours: readNumber('REGISTRY_TAGS_TTL_HOURS', 6),
      timeoutMs: readNumber('REGISTRY_TAGS_TIMEOUT_MS', 5000),
    },
  },
};
