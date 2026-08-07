const optional: Record<string, string> = {
  LOG_LEVEL: 'error',
  AGENT_TOKEN: 'test-agent-token',
};

for (const [key, value] of Object.entries(optional)) {
  process.env[key] ??= value;
}
