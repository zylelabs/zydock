process.env.MODE = 'prod';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/zydock_test';
process.env.QUEUE_POLL_INTERVAL_MS = '3600000';

const optional: Record<string, string> = {
  LOG_LEVEL: 'error',
  JWT_SECRET: 'test-secret',
  JWT_ACCESS_TTL_SECONDS: '900',
  ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
  LOCAL_AGENT_TOKEN: 'test-local-agent-token',
  LOCAL_AGENT_HOST: '127.0.0.1',
  ZYDOCK_VERSION: 'v0.2.0-dev.1111111',
  ZYDOCK_COMMIT: '1111111111111111111111111111111111111111',
  ZYDOCK_CHANNEL: 'dev',
};

for (const [key, value] of Object.entries(optional)) {
  process.env[key] ??= value;
}
