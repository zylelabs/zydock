import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { validateComposeSecurity } from '../../src/modules/compose/compose.schema';
import { parseComposeDocument } from '../../src/modules/compose/compose.service';
import { allTemplates } from '../../src/modules/templates/catalog.service';
import { renderTemplate } from '../../src/modules/templates/render.service';

const runDockerComposeConfig = async (composeYaml: string, env: string) => {
  const dir = await mkdtemp(join(tmpdir(), 'zydock-template-'));

  try {
    await writeFile(join(dir, 'docker-compose.yml'), composeYaml);
    await writeFile(join(dir, '.env'), env);

    const process = Bun.spawn(
      [
        'docker',
        'compose',
        '-f',
        'docker-compose.yml',
        '--env-file',
        '.env',
        '-p',
        'zydock-test',
        'config',
      ],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
    );

    const [stderr, code] = await Promise.all([new Response(process.stderr).text(), process.exited]);

    if (code !== 0) {
      throw new Error(`docker compose config failed: ${stderr}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const dummyValueFor = (input: TemplateInput | TemplateSecret): string => {
  if ('generate' in input) {
    return input.generate === 'hex32' ? 'a'.repeat(64) : 'generated-value';
  }

  if (input.type === 'boolean') {
    return 'false';
  }

  if (input.type === 'number') {
    return '10000';
  }

  return input.options?.[0] ?? 'value';
};

describe('templates catalog', () => {
  test('loads the whole embedded catalog without throwing', () => {
    expect(allTemplates().length).toBeGreaterThanOrEqual(1);
  });

  test('every template has a unique id', () => {
    const ids = allTemplates().map(template => template.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every template compose file passes the Phase 3 denylist', () => {
    for (const template of allTemplates()) {
      expect(() =>
        validateComposeSecurity(parseComposeDocument(template.dockerComposeContent)),
      ).not.toThrow();
    }
  });

  test('every template renders a compose + env that "docker compose config" accepts', async () => {
    for (const template of allTemplates()) {
      const versions = template.versions
        ? template.versions.available.map(entry => entry.value)
        : [undefined];

      for (const version of versions) {
        const answers = Object.fromEntries(
          [...template.inputs, ...template.secrets].map(field => [field.key, dummyValueFor(field)]),
        );

        if (template.versions && version !== undefined) {
          answers[template.versions.key] = version;
        }

        const { composeYaml, env } = renderTemplate(template, answers, {
          applicationSlug: `${template.id}-test`,
          serverHost: 'server.local',
          domain: `${template.id}.example.com`,
        });

        await runDockerComposeConfig(composeYaml, env);
      }
    }
  }, 30000);
});
