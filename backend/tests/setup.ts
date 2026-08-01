process.env.MODE = 'prod';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/zydock_test';
process.env.QUEUE_POLL_INTERVAL_MS = '3600000';

const optional: Record<string, string> = {
  LOG_LEVEL: 'error',
  JWT_SECRET: 'test-secret',
  JWT_ACCESS_TTL_SECONDS: '900',
  ENCRYPTION_KEY: '8874c9eba1f0ffabac2e7cf6b945c0a6746207f2bc618e01d5faaa4c2c95b905',
  LOCAL_AGENT_TOKEN: 'test-local-agent-token',
  LOCAL_AGENT_HOST: '127.0.0.1',
  SUPERUSER_EMAILS: 'seed-admin@zydock.test',
};

for (const [key, value] of Object.entries(optional)) {
  process.env[key] ??= value;
}
