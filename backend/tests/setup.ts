/**
 * Test environment. Preloaded by `bunfig.toml` so it runs before `src/config` reads the environment.
 *
 * `MONGO_URI` and `MODE` are **forced** — never inherited — so a developer's `.env` (which Bun
 * auto-loads and which may point at a real database) can never be touched by the suite. The
 * integration tests drop this database when they finish.
 */
process.env.MODE = 'prod';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/zydock_test';
// High enough that the worker never polls during a test run.
process.env.QUEUE_POLL_INTERVAL_MS = '3600000';

const optional: Record<string, string> = {
  LOG_LEVEL: 'error',
  JWT_SECRET: 'test-secret',
  JWT_ACCESS_TTL_SECONDS: '900',
  ENCRYPTION_KEY: '8874c9eba1f0ffabac2e7cf6b945c0a6746207f2bc618e01d5faaa4c2c95b905',
};

for (const [key, value] of Object.entries(optional)) {
  process.env[key] ??= value;
}
