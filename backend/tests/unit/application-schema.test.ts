import { describe, expect, test } from 'bun:test';
import { createApplicationSchema } from '../../src/modules/applications/application.schema';

describe('createApplicationSchema', () => {
  test('defaults to source "git" when omitted, keeping existing clients valid', () => {
    const result = createApplicationSchema.safeParse({
      name: 'legacy-app',
      environmentId: '0'.repeat(24),
      serverId: '0'.repeat(24),
      git: { host: 'github', repository: 'acme/app' },
      port: 3000,
    });

    expect(result.success).toBeTrue();

    if (result.success) {
      expect(result.data.source).toBe('git');
    }
  });

  test('accepts a compose payload', () => {
    const result = createApplicationSchema.safeParse({
      source: 'compose',
      name: 'compose-app',
      environmentId: '0'.repeat(24),
      serverId: '0'.repeat(24),
      compose: {
        content: 'services:\n  app:\n    image: nginx\n',
        expose: { service: 'app', port: 80 },
      },
    });

    expect(result.success).toBeTrue();
  });

  test('rejects a compose payload without an exposed service', () => {
    const result = createApplicationSchema.safeParse({
      source: 'compose',
      name: 'compose-app',
      environmentId: '0'.repeat(24),
      serverId: '0'.repeat(24),
      compose: { content: 'services:\n  app:\n    image: nginx\n' },
    });

    expect(result.success).toBeFalse();
  });

  test('rejects a git payload when source is compose', () => {
    const result = createApplicationSchema.safeParse({
      source: 'compose',
      name: 'compose-app',
      environmentId: '0'.repeat(24),
      serverId: '0'.repeat(24),
      git: { host: 'github', repository: 'acme/app' },
    });

    expect(result.success).toBeFalse();
  });
});
