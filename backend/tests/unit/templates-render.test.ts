import { describe, expect, test } from 'bun:test';
import { renderTemplate } from '../../src/modules/templates/render.service';

const template: Template = {
  id: 'sample',
  version: 1,
  name: 'Sample',
  tagline: 'A sample template',
  category: 'automation',
  tags: [],
  icon: 'icon.svg',
  author: 'zydock',
  origin: 'official',
  dockerCompose: 'docker-compose.yml',
  expose: { service: 'app', port: 8080, domain: true },
  databases: [],
  inputs: [{ key: 'TIMEZONE', label: 'Timezone', type: 'text', default: 'UTC', required: false }],
  secrets: [{ key: 'APP_SECRET', generate: 'hex32' }],
  deprecated: false,
  dockerComposeContent: 'services:\n  app:\n    image: nginx:1.27\n',
};

describe('renderTemplate', () => {
  test('fills declared inputs with their default when the answer is missing', () => {
    const { env } = renderTemplate(
      template,
      { APP_SECRET: 'x' },
      {
        applicationSlug: 'my-app',
        serverHost: 'host1',
      },
    );

    expect(env).toContain('TIMEZONE=UTC');
    expect(env).toContain('APP_SECRET=x');
  });

  test('an explicit answer overrides the default', () => {
    const { env } = renderTemplate(
      template,
      { TIMEZONE: 'America/Sao_Paulo', APP_SECRET: 'x' },
      {
        applicationSlug: 'my-app',
        serverHost: 'host1',
      },
    );

    expect(env).toContain('TIMEZONE=America/Sao_Paulo');
  });

  test('injects the ZYDOCK_* context variables', () => {
    const { env } = renderTemplate(
      template,
      { APP_SECRET: 'x' },
      {
        applicationSlug: 'my-app',
        serverHost: 'host1',
        domain: 'my-app.example.com',
      },
    );

    expect(env).toContain('ZYDOCK_APPLICATION_SLUG=my-app');
    expect(env).toContain('ZYDOCK_SERVER_HOST=host1');
    expect(env).toContain('ZYDOCK_DOMAIN=my-app.example.com');
  });

  test('omits ZYDOCK_DOMAIN when no domain is given', () => {
    const { env } = renderTemplate(
      template,
      { APP_SECRET: 'x' },
      {
        applicationSlug: 'my-app',
        serverHost: 'host1',
      },
    );

    expect(env).not.toContain('ZYDOCK_DOMAIN');
  });

  test('never rewrites the compose content', () => {
    const { composeYaml } = renderTemplate(
      template,
      { APP_SECRET: 'x' },
      {
        applicationSlug: 'my-app',
        serverHost: 'host1',
      },
    );

    expect(composeYaml).toBe(template.dockerComposeContent);
  });

  test('rejects an answer that is not declared in inputs or secrets', () => {
    expect(() =>
      renderTemplate(
        template,
        { APP_SECRET: 'x', UNKNOWN: 'y' },
        {
          applicationSlug: 'my-app',
          serverHost: 'host1',
        },
      ),
    ).toThrow(/not declared/);
  });

  test('rejects when a required secret answer is missing', () => {
    expect(() =>
      renderTemplate(template, {}, { applicationSlug: 'my-app', serverHost: 'host1' }),
    ).toThrow(/Secret "APP_SECRET" is required/);
  });

  test('rejects when a required input answer is missing and has no default', () => {
    const requiredInputTemplate: Template = {
      ...template,
      inputs: [{ key: 'API_KEY', label: 'API key', type: 'text', required: true }],
    };

    expect(() =>
      renderTemplate(
        requiredInputTemplate,
        { APP_SECRET: 'x' },
        {
          applicationSlug: 'my-app',
          serverHost: 'host1',
        },
      ),
    ).toThrow(/Input "API_KEY" is required/);
  });
});
