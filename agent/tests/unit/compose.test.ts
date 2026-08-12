import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import config from '../../src/config';
import { ALLOWED_COMMANDS, runCommandSchema } from '../../src/modules/commands/commands.schema';
import {
  configComposeProject,
  downComposeProject,
  psComposeProject,
  pullComposeProject,
  restartComposeProject,
  upComposeProject,
  writeComposeProject,
} from '../../src/modules/compose/compose.service';
import { projectParamSchema, writeComposeSchema } from '../../src/modules/compose/compose.schema';

const composeFile = (name: string) => `
services:
  app:
    image: alpine:3
    container_name: zydock-test-${name}
    command: sleep 3600
`;

describe('compose module argv discipline', () => {
  test('only the fixed allowlist reaches Bun.spawn', () => {
    expect(ALLOWED_COMMANDS).toContain('docker.compose-version');
  });

  test('an unknown operation is rejected by Zod before it reaches the agent', () => {
    expect(runCommandSchema.safeParse({ name: 'docker.compose-exec' }).success).toBe(false);
    expect(runCommandSchema.safeParse({ name: 'docker.compose-version' }).success).toBe(true);
  });

  test('project ids are restricted to a safe character set', () => {
    expect(projectParamSchema.safeParse({ project: 'n8n' }).success).toBe(true);
    expect(projectParamSchema.safeParse({ project: '../etc' }).success).toBe(false);
    expect(projectParamSchema.safeParse({ project: 'rm -rf /' }).success).toBe(false);
  });

  test('only known file names are accepted, and docker-compose.yml is required', () => {
    expect(
      writeComposeSchema.safeParse({ files: [{ name: '.env', content: 'A=1' }] }).success,
    ).toBe(false);

    expect(
      writeComposeSchema.safeParse({
        files: [{ name: 'compose.yaml', content: 'services: {}' }],
      }).success,
    ).toBe(false);

    expect(
      writeComposeSchema.safeParse({
        files: [{ name: 'docker-compose.yml', content: 'services: {}' }],
      }).success,
    ).toBe(true);
  });
});

describe('compose workspace guard', () => {
  test('a project id that tries to escape the workspace root is rejected', async () => {
    await expect(
      writeComposeProject('../outside', {
        files: [{ name: 'docker-compose.yml', content: 'services: {}' }],
      }),
    ).rejects.toThrow('Invalid project');
  });
});

describe('compose lifecycle', () => {
  const project = `t${randomUUID().slice(0, 8)}`;

  test('write then read the same files back from the workspace', async () => {
    const result = await writeComposeProject(project, {
      files: [{ name: 'docker-compose.yml', content: composeFile(project) }],
    });

    expect(result.project).toBe(project);
    expect(result.files).toEqual(['docker-compose.yml']);
    expect(await Bun.file(join(result.path, 'docker-compose.yml')).text()).toContain('alpine:3');
  });

  test('.env is written with 0600 permissions, unlike the other files', async () => {
    const result = await writeComposeProject(project, {
      files: [
        { name: 'docker-compose.yml', content: composeFile(project) },
        { name: '.env', content: 'SECRET=hunter2' },
      ],
    });

    const envMode = (await stat(join(result.path, '.env'))).mode & 0o777;
    const composeMode = (await stat(join(result.path, 'docker-compose.yml'))).mode & 0o777;

    expect(envMode).toBe(0o600);
    expect(composeMode).not.toBe(0o600);
  });

  test('config validates the project and normalizes it', async () => {
    const result = await configComposeProject(project);

    expect(result.valid).toBe(true);
    expect(result.output).toContain('alpine:3');
  });

  test('config on a project outside the workspace never sees a raw path', async () => {
    await expect(configComposeProject('never-written')).rejects.toThrow('was not found');
  });

  test('an invalid compose file returns a readable error instead of throwing garbage', async () => {
    const brokenProject = `${project}-broken`;

    await writeComposeProject(brokenProject, {
      files: [{ name: 'docker-compose.yml', content: 'services:\n  app:\n    not_a_key: [' }],
    });

    const result = await configComposeProject(brokenProject);

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('pull, up, ps, restart and down are idempotent', async () => {
    await pullComposeProject(project);
    await upComposeProject(project);
    await upComposeProject(project);

    const running = await psComposeProject(project);

    expect(running).toHaveLength(1);
    expect(running[0]?.service).toBe('app');
    expect(running[0]?.state).toBe('running');

    await restartComposeProject(project, 'app');
    await restartComposeProject(project);

    await downComposeProject(project, true);
    await downComposeProject(project, true);

    expect(await psComposeProject(project)).toHaveLength(0);
  }, 60000);

  test('cleanup', async () => {
    await downComposeProject(project, true).catch(() => undefined);
    await rm(join(config.workspacePath, 'compose'), { recursive: true, force: true });
    await rm(join(tmpdir(), 'zydock-test-workspace'), { recursive: true, force: true });
  });
});
