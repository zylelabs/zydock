import { join } from 'node:path';
import { tmpdir } from 'node:os';

const optional: Record<string, string> = {
  LOG_LEVEL: 'error',
  AGENT_TOKEN: 'test-agent-token',
  ZYDOCK_INSTALL_DIR: join(tmpdir(), 'zydock-test-install'),
};

for (const [key, value] of Object.entries(optional)) {
  process.env[key] ??= value;
}

// Always isolated, regardless of a local .env: tests must never touch the real build workspace.
process.env.WORKSPACE_PATH = join(tmpdir(), 'zydock-test-workspace');
