import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { validateComposeSecurity } from '../../src/modules/compose/compose.schema';
import { parseComposeDocument } from '../../src/modules/compose/compose.service';

const fixturesRoot = join(import.meta.dir, '../fixtures/hostile-compose');

const rejects = (file: string, match: string | RegExp) => {
  const content = readFileSync(join(fixturesRoot, file), 'utf-8');

  expect(() => validateComposeSecurity(parseComposeDocument(content))).toThrow(match);
};

describe('validateComposeSecurity', () => {
  test('accepts a compose file with no forbidden keys, a pinned tag and a named volume', () => {
    const content = readFileSync(join(fixturesRoot, 'safe.yml'), 'utf-8');

    expect(() => validateComposeSecurity(parseComposeDocument(content))).not.toThrow();
  });

  test('rejects "privileged"', () => rejects('privileged.yml', /"privileged"/));

  test('rejects "network_mode: host"', () =>
    rejects('network-mode-host.yml', /network_mode: host/));

  test('rejects "pid: host"', () => rejects('pid-host.yml', /pid: host/));

  test('rejects "ipc: host"', () => rejects('ipc-host.yml', /ipc: host/));

  test('rejects "cap_add"', () => rejects('cap-add.yml', /"cap_add"/));

  test('rejects "devices"', () => rejects('devices.yml', /"devices"/));

  test('rejects "security_opt"', () => rejects('security-opt.yml', /"security_opt"/));

  test('rejects "userns_mode"', () => rejects('userns-mode.yml', /"userns_mode"/));

  test('rejects a bind-mount of a host path (short syntax)', () =>
    rejects('bind-mount-host-path.yml', /bind-mounting a host path/));

  test('rejects a bind-mount of the Docker socket', () =>
    rejects('docker-socket.yml', /bind-mounting a host path.*docker\.sock/));

  test('rejects a bind-mount of a host path (long syntax)', () =>
    rejects('bind-mount-long-syntax.yml', /bind-mounting a host path/));

  test('rejects "build"', () => rejects('build.yml', /"build"/));

  test('rejects the "latest" tag', () => rejects('latest-tag.yml', /must use an immutable tag/));

  test('rejects an image without a tag or digest', () =>
    rejects('missing-tag.yml', /must use an immutable tag/));

  test('rejects a registry outside the allowlist', () =>
    rejects('unlisted-registry.yml', /not in the allowed list/));

  test('rejects a compose file with more services than the configured limit', () =>
    rejects('too-many-services.yml', /more than the limit/));

  test('the refusal message names the offending service and key', () => {
    const content = readFileSync(join(fixturesRoot, 'privileged.yml'), 'utf-8');

    expect(() => validateComposeSecurity(parseComposeDocument(content))).toThrow(
      /Service "app": "privileged"/,
    );
  });

  test('a compose file that looks clean before "docker compose config" can still be rejected after normalization', () => {
    const raw = readFileSync(join(fixturesRoot, 'extends-raw.yml'), 'utf-8');
    const normalized = readFileSync(join(fixturesRoot, 'extends-normalized.yml'), 'utf-8');

    expect(() => validateComposeSecurity(parseComposeDocument(raw))).not.toThrow();
    expect(() => validateComposeSecurity(parseComposeDocument(normalized))).toThrow(/"privileged"/);
  });
});
