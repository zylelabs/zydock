import { describe, expect, test } from 'bun:test';
import { parse } from 'yaml';
import { encryptSecret } from '../../src/utils/crypto';
import {
  applicationPortMappingsOf,
  applicationVolumesOf,
  findComposeService,
  listApplicationServices,
  maskSecrets,
  namedVolumesOf,
  parseComposeDocument,
  publishedPortMappingsOf,
  publishedPortsOf,
  resolveComposeVariables,
  secretValuesOf,
} from '../../src/modules/compose/compose.service';
import { renderOverrideDocument } from '../../src/modules/compose/override.service';

describe('parseComposeDocument', () => {
  test('parses services and their published ports', () => {
    const parsed = parseComposeDocument(
      'services:\n  app:\n    image: nginx\n    ports:\n      - "8080:80"\n  db:\n    image: postgres\n',
    );

    expect(parsed.services.map(service => service.name)).toEqual(['app', 'db']);
    expect(findComposeService(parsed, 'app')?.ports).toEqual([
      { published: 8080, target: 80, protocol: 'tcp' },
    ]);
    expect(publishedPortsOf(parsed)).toEqual([8080]);
  });

  test('parses the "/udp" suffix on the short form', () => {
    const parsed = parseComposeDocument(
      'services:\n  game:\n    image: game\n    ports:\n      - "25565:25565/udp"\n',
    );

    expect(findComposeService(parsed, 'game')?.ports).toEqual([
      { published: 25565, target: 25565, protocol: 'udp' },
    ]);
  });

  test('reads "protocol" from the long form, and falls back to "tcp" when absent', () => {
    const parsed = parseComposeDocument(
      'services:\n' +
        '  game:\n' +
        '    image: game\n' +
        '    ports:\n' +
        '      - published: 25565\n' +
        '        target: 25565\n' +
        '        protocol: udp\n' +
        '      - published: 8080\n' +
        '        target: 80\n',
    );

    expect(publishedPortMappingsOf(parsed)).toEqual([
      { published: 25565, target: 25565, protocol: 'udp' },
      { published: 8080, target: 80, protocol: 'tcp' },
    ]);
    expect(applicationPortMappingsOf(parsed)).toEqual([
      { hostPort: 25565, containerPort: 25565, protocol: 'udp' },
      { hostPort: 8080, containerPort: 80, protocol: 'tcp' },
    ]);
  });

  test('drops a published port that is not a resolvable number', () => {
    const parsed = parseComposeDocument(
      'services:\n  game:\n    image: game\n    ports:\n      - "${HOST_PORT}:25565"\n',
    );

    expect(findComposeService(parsed, 'game')?.ports).toEqual([
      { published: undefined, target: 25565, protocol: 'tcp' },
    ]);
    expect(publishedPortsOf(parsed)).toEqual([]);
    expect(applicationPortMappingsOf(parsed)).toEqual([]);
  });

  test('drops a port outside the 1-65535 range', () => {
    const parsed = parseComposeDocument(
      'services:\n  app:\n    image: app\n    ports:\n      - "70000:80"\n',
    );

    expect(publishedPortsOf(parsed)).toEqual([]);
  });

  test('rejects invalid YAML', () => {
    expect(() => parseComposeDocument('not: [valid')).toThrow();
  });

  test('rejects a document without a services section', () => {
    expect(() => parseComposeDocument('version: "3"\n')).toThrow(
      /must declare a "services" section/,
    );
  });

  test('rejects a services section with no entries', () => {
    expect(() => parseComposeDocument('services: {}\n')).toThrow(
      /must declare at least one service/,
    );
  });
});

describe('resolveComposeVariables', () => {
  test('replaces a declared variable and leaves an undeclared one untouched', () => {
    expect(
      resolveComposeVariables('ports:\n  - "${HOST_PORT}:25565"\n  - "${OTHER}:80"', {
        HOST_PORT: '25565',
      }),
    ).toBe('ports:\n  - "25565:25565"\n  - "${OTHER}:80"');
  });

  test('resolves the port a template deploy would publish', () => {
    const parsed = parseComposeDocument(
      resolveComposeVariables(
        'services:\n  game:\n    image: game\n    ports:\n      - "${HOST_PORT}:25565"\n',
        { HOST_PORT: '25577' },
      ),
    );

    expect(applicationPortMappingsOf(parsed)).toEqual([
      { hostPort: 25577, containerPort: 25565, protocol: 'tcp' },
    ]);
  });

  test('applies ":-" for an unset or empty value, and "-" only for an unset one', () => {
    expect(resolveComposeVariables('${A:-fallback} ${B:-fallback}', { A: '', B: 'set' })).toBe(
      'fallback set',
    );
    expect(resolveComposeVariables('${A-fallback} ${C-fallback}', { A: '' })).toBe(' fallback');
  });

  test('leaves an escaped "$$" alone', () => {
    expect(resolveComposeVariables('$${HOST_PORT}', { HOST_PORT: '25565' })).toBe('$${HOST_PORT}');
  });
});

describe('namedVolumesOf / applicationVolumesOf', () => {
  test('reads the short form and prefixes the volume by compose project', () => {
    const parsed = parseComposeDocument(
      'services:\n  app:\n    image: uptime-kuma\n    volumes:\n      - uptime-kuma-data:/app/data\nvolumes:\n  uptime-kuma-data:\n',
    );

    expect(namedVolumesOf(parsed)).toEqual([
      { name: 'uptime-kuma-data', target: '/app/data', readOnly: false },
    ]);
    expect(applicationVolumesOf(parsed, 'zydock-my-app')).toEqual([
      { source: 'zydock-my-app_uptime-kuma-data', target: '/app/data', readOnly: false },
    ]);
  });

  test('reads the long form and the ":ro" suffix', () => {
    const parsed = parseComposeDocument(
      'services:\n' +
        '  app:\n' +
        '    image: app\n' +
        '    volumes:\n' +
        '      - config:/etc/app:ro\n' +
        '      - type: volume\n' +
        '        source: data\n' +
        '        target: /data\n' +
        'volumes:\n  config:\n  data:\n',
    );

    expect(namedVolumesOf(parsed)).toEqual([
      { name: 'config', target: '/etc/app', readOnly: true },
      { name: 'data', target: '/data', readOnly: false },
    ]);
  });

  test('ignores anonymous volumes with no named source', () => {
    const parsed = parseComposeDocument(
      'services:\n  app:\n    image: app\n    volumes:\n      - /data\n',
    );

    expect(namedVolumesOf(parsed)).toEqual([]);
  });
});

describe('listApplicationServices', () => {
  const composeApplication = {
    source: 'compose',
    slug: 'n8n-abc',
    compose: {
      content: 'services:\n  app:\n    image: n8n\n  db:\n    image: postgres\n',
      expose: { service: 'app', port: 5678 },
    },
  } as unknown as Application;

  test('derives service and container name from the compose content', () => {
    expect(listApplicationServices(composeApplication)).toEqual([
      {
        service: 'app',
        containerName: 'zydock-n8n-abc-app-1',
        exposed: true,
        role: 'primary',
        image: 'n8n',
        internalPort: 5678,
      },
      {
        service: 'db',
        containerName: 'zydock-n8n-abc-db-1',
        exposed: false,
        role: 'linked',
        image: 'postgres',
        internalPort: undefined,
      },
    ]);
  });

  test('returns nothing for a git application', () => {
    expect(listApplicationServices({ source: 'git' } as unknown as Application)).toEqual([]);
  });

  test('returns nothing when the compose content is invalid', () => {
    const broken = {
      source: 'compose',
      slug: 'broken',
      compose: { content: 'not: [valid', expose: { service: 'app', port: 80 } },
    } as unknown as Application;

    expect(listApplicationServices(broken)).toEqual([]);
  });

  test('extracts the internalPort of a linked service from its first declared target port', () => {
    const application = {
      source: 'compose',
      slug: 'stack-abc',
      compose: {
        content:
          'services:\n  app:\n    image: n8n\n  db:\n    image: postgres\n    ports:\n      - "5432:5432"\n',
        expose: { service: 'app', port: 5678 },
      },
    } as unknown as Application;

    expect(listApplicationServices(application).find(service => service.service === 'db')).toEqual({
      service: 'db',
      containerName: 'zydock-stack-abc-db-1',
      exposed: false,
      role: 'linked',
      image: 'postgres',
      internalPort: 5432,
    });
  });
});

describe('secretValuesOf / maskSecrets', () => {
  test('secretValuesOf only decrypts variables flagged as secret', () => {
    const application = {
      variables: [
        { key: 'POSTGRES_PASSWORD', value: encryptSecret('sup3r-secret'), secret: true },
        { key: 'TIMEZONE', value: encryptSecret('UTC'), secret: false },
      ],
    } as unknown as Application;

    expect(secretValuesOf(application)).toEqual(['sup3r-secret']);
  });

  test('maskSecrets replaces every occurrence of a known value', () => {
    const output = maskSecrets(
      'db password mismatch: expected sup3r-secret, got sup3r-secret (retry)',
      ['sup3r-secret'],
    );

    expect(output).toBe('db password mismatch: expected ***, got *** (retry)');
  });

  test('maskSecrets treats secret values as literal text, not regex', () => {
    const output = maskSecrets('token is a.b+c(d)', ['a.b+c(d)']);

    expect(output).toBe('token is ***');
  });

  test('maskSecrets leaves text untouched when there is nothing to mask', () => {
    expect(maskSecrets('all good', [])).toBe('all good');
  });
});

describe('renderOverrideDocument', () => {
  const application = {
    _id: '000000000000000000000001',
    slug: 'my-app',
    restartPolicy: 'unless-stopped',
  } as unknown as Application;

  const serviceOf = (name: string, hasMemoryLimit = false) => ({ name, hasMemoryLimit });

  test('injects Zydock labels, network and restart policy for every service', () => {
    const output = renderOverrideDocument(
      [serviceOf('app'), serviceOf('db')],
      application,
      'deployment-1',
    );
    const document = parse(output) as {
      services: Record<string, { labels: Record<string, string>; restart: string }>;
      networks: Record<string, { external: boolean }>;
    };

    for (const service of ['app', 'db']) {
      expect(document.services[service]?.labels).toEqual({
        'zydock.application': '000000000000000000000001',
        'zydock.deployment': 'deployment-1',
        'zydock.autoheal': 'true',
      });
      expect(document.services[service]?.restart).toBe('unless-stopped');
    }

    expect(document.networks.zydock?.external).toBeTrue();
  });

  test('omits the autoheal label when the restart policy is "no"', () => {
    const output = renderOverrideDocument(
      [serviceOf('app')],
      { ...application, restartPolicy: 'no' } as unknown as Application,
      'deployment-1',
    );
    const document = parse(output) as {
      services: Record<string, { labels: Record<string, string> }>;
    };

    expect(document.services.app?.labels).not.toHaveProperty('zydock.autoheal');
  });

  test('injects the organization default memory limit when the service declares none', () => {
    const output = renderOverrideDocument([serviceOf('app')], application, 'deployment-1');
    const document = parse(output) as {
      services: Record<string, { deploy?: { resources?: { limits?: { memory?: string } } } }>;
    };

    expect(document.services.app?.deploy?.resources?.limits?.memory).toBe('512M');
  });

  test('does not override a memory limit the service already declares', () => {
    const output = renderOverrideDocument([serviceOf('app', true)], application, 'deployment-1');
    const document = parse(output) as {
      services: Record<string, { deploy?: { resources?: { limits?: { memory?: string } } } }>;
    };

    expect(document.services.app?.deploy?.resources?.limits?.memory).toBeUndefined();
  });

  test('application-level resources take precedence over both defaults', () => {
    const output = renderOverrideDocument(
      [serviceOf('app', true)],
      { ...application, resources: { memoryMb: 1024, cpus: 2 } } as unknown as Application,
      'deployment-1',
    );
    const document = parse(output) as {
      services: Record<
        string,
        { deploy?: { resources?: { limits?: { memory?: string; cpus?: string } } } }
      >;
    };

    expect(document.services.app?.deploy?.resources?.limits?.memory).toBe('1024M');
    expect(document.services.app?.deploy?.resources?.limits?.cpus).toBe('2');
  });
});
