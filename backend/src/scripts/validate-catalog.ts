import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allTemplates } from '../modules/templates/catalog.service';
import { renderTemplate } from '../modules/templates/render.service';

type CatalogFailure = {
  templateId: string;
  check: 'compose-config' | 'image' | 'link';
  message: string;
};

const LINK_TIMEOUT_MS = 10_000;

const dummyValueFor = (field: TemplateInput | TemplateSecret): string => {
  if ('generate' in field) {
    return field.generate === 'hex32' ? 'a'.repeat(64) : 'generated-value';
  }

  if (field.type === 'boolean') {
    return 'false';
  }

  if (field.type === 'number') {
    return '10000';
  }

  return field.options?.[0] ?? 'value';
};

const checkComposeConfig = async (template: Template): Promise<CatalogFailure[]> => {
  const answers = Object.fromEntries(
    [...template.inputs, ...template.secrets].map(field => [field.key, dummyValueFor(field)]),
  );

  const { composeYaml, env } = renderTemplate(template, answers, {
    applicationSlug: `${template.id}-catalog-check`,
    serverHost: 'catalog-check.local',
    domain: `${template.id}.catalog-check.local`,
  });

  const workdir = await mkdtemp(join(tmpdir(), 'zydock-catalog-check-'));

  try {
    await writeFile(join(workdir, 'docker-compose.yml'), composeYaml);
    await writeFile(join(workdir, '.env'), env);

    const process = Bun.spawn(
      [
        'docker',
        'compose',
        '-f',
        'docker-compose.yml',
        '--env-file',
        '.env',
        '-p',
        'zydock-catalog-check',
        'config',
      ],
      { cwd: workdir, stdout: 'pipe', stderr: 'pipe' },
    );

    const [stderr, code] = await Promise.all([new Response(process.stderr).text(), process.exited]);

    if (code !== 0) {
      return [{ templateId: template.id, check: 'compose-config', message: stderr.trim() }];
    }

    return [];
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
};

const checkImages = async (template: Template): Promise<CatalogFailure[]> => {
  const images = [
    ...new Set(
      Array.from(template.dockerComposeContent.matchAll(/^\s*image:\s*(\S+)\s*$/gm)).map(
        match => match[1],
      ),
    ),
  ];

  const results = await Promise.all(
    images.map(async (image): Promise<CatalogFailure | null> => {
      const process = Bun.spawn(['docker', 'buildx', 'imagetools', 'inspect', image], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stderr, code] = await Promise.all([
        new Response(process.stderr).text(),
        process.exited,
      ]);

      if (code !== 0) {
        return {
          templateId: template.id,
          check: 'image',
          message: `image "${image}" was not found in its registry: ${stderr.trim()}`,
        };
      }

      return null;
    }),
  );

  return results.filter((failure): failure is CatalogFailure => failure !== null);
};

const checkLink = async (
  template: Template,
  field: 'website' | 'documentation',
): Promise<CatalogFailure | null> => {
  const url = template[field];

  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        templateId: template.id,
        check: 'link',
        message: `"${field}" (${url}) responded with status ${response.status}`,
      };
    }

    return null;
  } catch (error) {
    return {
      templateId: template.id,
      check: 'link',
      message: `"${field}" (${url}) is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const checkLinks = async (template: Template): Promise<CatalogFailure[]> => {
  const results = await Promise.all([
    checkLink(template, 'website'),
    checkLink(template, 'documentation'),
  ]);

  return results.filter((failure): failure is CatalogFailure => failure !== null);
};

const validateTemplate = async (template: Template): Promise<CatalogFailure[]> => {
  const [composeFailures, imageFailures, linkFailures] = await Promise.all([
    checkComposeConfig(template),
    checkImages(template),
    checkLinks(template),
  ]);

  return [...composeFailures, ...imageFailures, ...linkFailures];
};

const reportPathFrom = (args: string[]): string | undefined => {
  const index = args.indexOf('--report-json');

  return index === -1 ? undefined : args[index + 1];
};

const run = async () => {
  const templates = allTemplates();
  const failuresPerTemplate = await Promise.all(templates.map(validateTemplate));
  const failures = failuresPerTemplate.flat();

  const reportPath = reportPathFrom(process.argv.slice(2));

  if (reportPath) {
    await writeFile(reportPath, JSON.stringify({ failures }, null, 2));
  }

  if (!failures.length) {
    console.log(`Catalog OK — ${templates.length} templates validated.`);
    return;
  }

  console.error(`Catalog validation found ${failures.length} problem(s):`);

  for (const failure of failures) {
    console.error(`- [${failure.templateId}] (${failure.check}) ${failure.message}`);
  }

  process.exitCode = 1;
};

run().catch(error => {
  console.error('Catalog validation crashed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
