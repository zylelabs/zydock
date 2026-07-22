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
  port: readNumber('PORT', 8000),
  mode: readString('MODE', 'prod'),
  logLevel: readLogLevel(),
  corsOrigin: readString('CORS_ORIGIN', 'http://localhost:3000'),
  mongodb: {
    uri: readRequired('MONGO_URI'),
  },
  providers: {
    container: { runtime: readString('CONTAINER_RUNTIME', 'docker') },
    reverseProxy: { implementation: readString('REVERSE_PROXY', 'caddy') },
    storage: { implementation: readString('STORAGE_PROVIDER', 'local') },
    dns: { implementation: readString('DNS_PROVIDER', 'cloudflare') },
    git: { defaultHost: readString('GIT_DEFAULT_HOST', 'github') },
  },
};
