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
  mode: readString('MODE', 'prod'),
  logLevel: readLogLevel(),
  corsOrigin: readString('CORS_ORIGIN', 'http://localhost:3000'),
  appUrl: readString('APP_URL', 'http://localhost:3000'),
  backendUrl: readString('BACKEND_URL', 'http://localhost:8000'),
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
  security: {
    encryptionKey: readEncryptionKey(),
  },
  node: {
    port: readNumber('NODE_AGENT_PORT', 9000),
    requestTimeoutMs: readNumber('NODE_AGENT_TIMEOUT_MS', 15000),
    offlineAfterSeconds: readNumber('NODE_AGENT_OFFLINE_AFTER_SECONDS', 90),
    bundlePath: readString('NODE_AGENT_BUNDLE_PATH', '../node/dist/agent.js'),
  },
  providers: {
    container: { runtime: readString('CONTAINER_RUNTIME', 'docker') },
    reverseProxy: { implementation: readString('REVERSE_PROXY', 'caddy') },
    storage: { implementation: readString('STORAGE_PROVIDER', 'local') },
    dns: { implementation: readString('DNS_PROVIDER', 'cloudflare') },
    git: { defaultHost: readString('GIT_DEFAULT_HOST', 'github') },
    ssh: { implementation: readString('SSH_PROVIDER', 'ssh2') },
  },
};
