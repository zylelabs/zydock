import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { allTemplates } from '../../src/modules/templates/catalog.service';
import {
  composeHashOf,
  diffComposeContent,
  templateStatusOf,
} from '../../src/modules/templates/template.service';

const baseTemplate: Template = {
  id: 'synthetic-status-app',
  version: 2,
  name: 'Synthetic',
  tagline: 'Synthetic template for templateStatusOf tests',
  category: 'test',
  tags: [],
  icon: 'icon.svg',
  author: 'zydock',
  origin: 'official',
  dockerCompose: 'docker-compose.yml',
  expose: { service: 'app', port: 80, domain: true },
  databases: [],
  inputs: [],
  secrets: [],
  deprecated: false,
  dockerComposeContent: 'services:\n  app:\n    image: nginx:1.27\n',
};

const applicationOf = (origin: Partial<ApplicationOrigin>): Application =>
  ({
    source: 'compose',
    origin: { templateId: baseTemplate.id, templateVersion: 1, inputs: {}, ...origin },
  }) as unknown as Application;

describe('templateStatusOf', () => {
  test('returns undefined for an application not created from a template', () => {
    expect(templateStatusOf({ source: 'compose' } as unknown as Application)).toBeUndefined();
    expect(templateStatusOf({ source: 'git' } as unknown as Application)).toBeUndefined();
  });

  test('returns "unknown" when the template is no longer in the catalog', () => {
    const application = applicationOf({ templateId: 'does-not-exist-in-catalog' });

    expect(templateStatusOf(application)).toBe('unknown');
  });

  describe('with the template registered in the catalog', () => {
    const deployedTemplate: Template = { ...baseTemplate };

    beforeAll(() => {
      allTemplates().push(deployedTemplate);
    });

    afterAll(() => {
      const index = allTemplates().findIndex(template => template.id === deployedTemplate.id);

      if (index >= 0) {
        allTemplates().splice(index, 1);
      }
    });

    test('returns "up-to-date" when the installed version matches the catalog', () => {
      const application = applicationOf({ templateVersion: deployedTemplate.version });

      expect(templateStatusOf(application)).toBe('up-to-date');
    });

    test('returns "update-available" when the catalog version is newer', () => {
      const application = applicationOf({ templateVersion: deployedTemplate.version - 1 });

      expect(templateStatusOf(application)).toBe('update-available');
    });

    test('returns "deprecated" when the template left the storefront', () => {
      deployedTemplate.deprecated = true;

      const application = applicationOf({ templateVersion: deployedTemplate.version });

      expect(templateStatusOf(application)).toBe('deprecated');

      deployedTemplate.deprecated = false;
    });
  });
});

describe('composeHashOf', () => {
  test('is stable for the same content and changes when the content changes', () => {
    const content = 'services:\n  app:\n    image: nginx:1.27\n';

    expect(composeHashOf(content)).toBe(composeHashOf(content));
    expect(composeHashOf(content)).not.toBe(composeHashOf(`${content}\n`));
  });
});

describe('diffComposeContent', () => {
  test('marks unchanged lines as context and only tags the changed ones', () => {
    const before = 'services:\n  app:\n    image: nginx:1.27\n';
    const after = 'services:\n  app:\n    image: nginx:1.28\n';

    const diff = diffComposeContent(before, after);

    expect(diff).toEqual([
      { type: 'context', content: 'services:' },
      { type: 'context', content: '  app:' },
      { type: 'removed', content: '    image: nginx:1.27' },
      { type: 'added', content: '    image: nginx:1.28' },
      { type: 'context', content: '' },
    ]);
  });

  test('is empty when the content is identical', () => {
    const content = 'services:\n  app:\n    image: nginx:1.27\n';

    expect(diffComposeContent(content, content).every(line => line.type === 'context')).toBe(true);
  });
});
