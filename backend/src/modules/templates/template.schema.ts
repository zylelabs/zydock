import { z } from 'zod';
import { resourcesSchema } from '../applications/application.schema';

const RESERVED_PREFIX = 'ZYDOCK_';

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const MAX_VERSION_PATTERN_LENGTH = 200;

const isNotReserved = (key: string) => !key.startsWith(RESERVED_PREFIX);

export const TEMPLATE_INPUT_TYPES = ['text', 'password', 'number', 'boolean', 'select'] as const;

export type TemplateInputType = (typeof TEMPLATE_INPUT_TYPES)[number];

export const TEMPLATE_SECRET_GENERATORS = ['password', 'hex32', 'uuid'] as const;

export type TemplateSecretGenerator = (typeof TEMPLATE_SECRET_GENERATORS)[number];

export const TEMPLATE_DATABASE_ENGINES = ['postgresql', 'mysql', 'mongodb', 'redis'] as const;

export type TemplateDatabaseEngine = (typeof TEMPLATE_DATABASE_ENGINES)[number];

export const TEMPLATE_ORIGINS = ['official', 'community'] as const;

export type TemplateOrigin = (typeof TEMPLATE_ORIGINS)[number];

const serviceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid service name');

const templateKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(KEY_PATTERN, 'Use UPPER_SNAKE_CASE')
  .refine(isNotReserved, `Cannot use the reserved "${RESERVED_PREFIX}" prefix`);

const templateInputSchema = z
  .object({
    key: templateKeySchema,
    label: z.string().trim().min(1).max(200),
    type: z.enum(TEMPLATE_INPUT_TYPES),
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(50).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    required: z.boolean().default(false),
    min: z.coerce.number().int().optional(),
    max: z.coerce.number().int().optional(),
    pattern: z.string().trim().min(1).max(MAX_VERSION_PATTERN_LENGTH).optional(),
    help: z.string().trim().min(1).max(300).optional(),
    must_be_true: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (input.type === 'select' && !input.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"select" inputs require "options"',
        path: ['options'],
      });
    }

    (['min', 'max'] as const).forEach(field => {
      if (input[field] !== undefined && input.type !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${field}" is only allowed when "type" is "number"`,
          path: [field],
        });
      }
    });

    if (input.min !== undefined && input.max !== undefined && input.min > input.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"min" cannot be greater than "max"',
        path: ['min'],
      });
    }

    if (input.pattern !== undefined) {
      if (input.type !== 'text') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '"pattern" is only allowed when "type" is "text"',
          path: ['pattern'],
        });
      } else {
        try {
          new RegExp(input.pattern);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: '"pattern" is not a valid regular expression',
            path: ['pattern'],
          });
        }
      }
    }

    if (input.must_be_true && input.type !== 'boolean') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"must_be_true" is only allowed when "type" is "boolean"',
        path: ['must_be_true'],
      });
    }
  });

const templateSecretSchema = z.object({
  key: templateKeySchema,
  generate: z.enum(TEMPLATE_SECRET_GENERATORS),
});

export const TEMPLATE_EXPOSE_KINDS = ['http', 'tcp', 'udp'] as const;

export type TemplateExposeKind = (typeof TEMPLATE_EXPOSE_KINDS)[number];

const templateExposeSchema = z
  .object({
    service: serviceNameSchema,
    port: z.coerce.number().int().min(1).max(65535),
    kind: z.enum(TEMPLATE_EXPOSE_KINDS).default('http'),
    host_port_key: templateKeySchema.optional(),
    domain: z.boolean().default(true),
    startup_timeout_seconds: z.coerce.number().int().min(30).max(3600).optional(),
  })
  .superRefine((expose, ctx) => {
    if (expose.kind === 'http' && expose.host_port_key !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"expose.host_port_key" is not allowed when "expose.kind" is "http"',
        path: ['host_port_key'],
      });
    }

    if (expose.kind !== 'http' && expose.host_port_key === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"expose.host_port_key" is required when "expose.kind" is "tcp" or "udp"',
        path: ['host_port_key'],
      });
    }

    if (expose.kind !== 'http' && expose.domain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"expose.domain" cannot be true when "expose.kind" is not "http"',
        path: ['domain'],
      });
    }
  });

const NO_TRAVERSAL_OR_CONTROL_CHARS_PATTERN = /^(?!.*\.\.)[^\x00-\x1f\x7f]+$/;

const templateConsoleSchema = z.object({
  log_file: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .regex(NO_TRAVERSAL_OR_CONTROL_CHARS_PATTERN, 'Invalid "log_file" path'),
  tail_lines: z.coerce.number().int().min(1).max(2000).default(200),
});

const templateCredentialRefSchema = z.union([
  z.object({ key: templateKeySchema }),
  z.object({ value: z.string().trim().min(1).max(200) }),
]);

const templateDatabaseCredentialsSchema = z.object({
  username: templateCredentialRefSchema.optional(),
  password: templateCredentialRefSchema,
  database: templateCredentialRefSchema.optional(),
});

const templateDatabaseSchema = z.object({
  service: serviceNameSchema,
  engine: z.enum(TEMPLATE_DATABASE_ENGINES),
  credentials: templateDatabaseCredentialsSchema,
});

const templateVersionEntrySchema = z.object({
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120).optional(),
});

export const MAX_VERSION_TAG_LENGTH = 128;

export const testVersionPattern = (pattern: string, value: string): boolean =>
  new RegExp(pattern).test(value.slice(0, MAX_VERSION_TAG_LENGTH));

export const DEFAULT_VERSION_INCLUDE_PATTERN = '^(?=.*\\d)[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$';

export const DEFAULT_VERSION_EXCLUDE_PATTERN = [
  '(^|[-_.])(latest|nightly|canary|edge|unstable|rolling|snapshot|dev|devel|develop|main|master|trunk|next|insider|insiders)([-_.]|$)',
  '^sha(256)?[-:_]',
  '^[0-9a-f]{7,}$',
  '^\\d{4}-?\\d{2}-?\\d{2}([-_.]|$)',
  '^pr-?\\d+([-_.]|$)',
].join('|');

export const DEFAULT_VERSION_KEY = 'VERSION';

export const DEFAULT_VERSION_REGISTRY_LIMIT = 50;

export const implicitTemplateVersions = (): TemplateVersions => ({
  key: DEFAULT_VERSION_KEY,
  available: [],
  registry: { limit: DEFAULT_VERSION_REGISTRY_LIMIT },
});

const versionPatternSchema = z.string().trim().min(1).max(MAX_VERSION_PATTERN_LENGTH);

const templateVersionsRegistrySchema = z
  .object({
    include: versionPatternSchema.optional(),
    exclude: versionPatternSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(DEFAULT_VERSION_REGISTRY_LIMIT),
  })
  .superRefine((registry, ctx) => {
    (['include', 'exclude'] as const).forEach(field => {
      const pattern = registry[field];

      if (pattern === undefined) {
        return;
      }

      try {
        new RegExp(pattern);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"versions.registry.${field}" is not a valid regular expression`,
          path: [field],
        });
      }
    });
  });

const templateVersionsSchema = z
  .object({
    key: templateKeySchema.default(DEFAULT_VERSION_KEY),
    default: z.string().trim().min(1).max(120).optional(),
    available: z.array(templateVersionEntrySchema).max(30).default([]),
    registry: templateVersionsRegistrySchema.optional(),
  })
  .superRefine((versions, ctx) => {
    const values = versions.available.map(entry => entry.value);

    values.forEach((value, index) => {
      if (value === 'latest') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '"latest" is not allowed as a version value',
          path: ['available', index, 'value'],
        });
      }
    });

    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"available[].value" entries must be unique',
        path: ['available'],
      });
    }

    if (versions.default === 'latest') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"latest" is not allowed as a version value',
        path: ['default'],
      });
    }

    if (values.length > 0 && versions.default !== undefined && !values.includes(versions.default)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"default" must be one of "available[].value"',
        path: ['default'],
      });
    }
  })
  // Without a curated list there is nothing to pick from, so the registry becomes the source of
  // both the selectable versions and the default one.
  .transform(versions =>
    versions.available.length === 0 && !versions.registry
      ? { ...versions, registry: { limit: DEFAULT_VERSION_REGISTRY_LIMIT } }
      : versions,
  );

const rawTemplateSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lower kebab-case'),
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(120),
    tagline: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(64),
    tags: z.array(z.string().trim().min(1).max(32)).max(10).default([]),
    icon: z.string().trim().min(1).max(200).optional(),
    website: z.string().trim().url().optional(),
    documentation: z.string().trim().url().optional(),
    license: z.string().trim().min(1).max(120).optional(),
    author: z.string().trim().min(1).max(120),
    origin: z.enum(TEMPLATE_ORIGINS),
    docker_compose: z.string().trim().min(1).max(200),
    expose: templateExposeSchema,
    console: templateConsoleSchema.optional(),
    databases: z.array(templateDatabaseSchema).max(10).default([]),
    inputs: z.array(templateInputSchema).max(50).default([]),
    secrets: z.array(templateSecretSchema).max(50).default([]),
    versions: templateVersionsSchema.optional(),
    deprecated: z.boolean().default(false),
  })
  .superRefine((template, ctx) => {
    if (template.versions) {
      const declaredKeys = new Set([
        ...template.inputs.map(input => input.key),
        ...template.secrets.map(secret => secret.key),
      ]);

      if (declaredKeys.has(template.versions.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"versions.key" ("${template.versions.key}") collides with an "inputs" or "secrets" key`,
          path: ['versions', 'key'],
        });
      }
    }

    if (template.expose.kind !== 'http' && template.expose.host_port_key !== undefined) {
      const matchingInput = template.inputs.find(
        input => input.key === template.expose.host_port_key,
      );

      if (!matchingInput) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"expose.host_port_key" ("${template.expose.host_port_key}") must match a declared "inputs[].key"`,
          path: ['expose', 'host_port_key'],
        });
      } else if (matchingInput.type !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"expose.host_port_key" ("${template.expose.host_port_key}") must reference an "inputs[].key" of type "number"`,
          path: ['expose', 'host_port_key'],
        });
      }
    }
  });

const describeIssues = (error: z.ZodError) =>
  error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');

export const parseTemplateManifest = (raw: unknown): TemplateManifest => {
  const result = rawTemplateSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(describeIssues(result.error));
  }

  const parsed = result.data;

  return {
    id: parsed.id,
    version: parsed.version,
    name: parsed.name,
    tagline: parsed.tagline,
    category: parsed.category,
    tags: parsed.tags,
    icon: parsed.icon,
    website: parsed.website,
    documentation: parsed.documentation,
    license: parsed.license,
    author: parsed.author,
    origin: parsed.origin,
    dockerCompose: parsed.docker_compose,
    expose: parsed.expose,
    console: parsed.console,
    databases: parsed.databases,
    inputs: parsed.inputs,
    secrets: parsed.secrets,
    versions: parsed.versions,
    deprecated: parsed.deprecated,
  };
};

export const listTemplatesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(64).optional(),
  origin: z.enum(TEMPLATE_ORIGINS).optional(),
});

export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

export const templateIdParamSchema = z.object({
  templateId: z.string().trim().min(1).max(64),
});

export type TemplateIdParam = z.infer<typeof templateIdParamSchema>;

export const listTemplateVersionsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

export type ListTemplateVersionsQuery = z.infer<typeof listTemplateVersionsQuerySchema>;

export const deployTemplateSchema = z.object({
  organizationId: z.string().length(24),
  name: z.string().trim().min(1).max(120),
  environmentId: z.string().length(24),
  serverId: z.string().length(24),
  inputs: z.record(z.string(), z.string().max(8192)).default({}),
  version: z.string().trim().min(1).max(120).optional(),
  deployNow: z.boolean().default(true),
  resources: resourcesSchema.optional(),
});

export type DeployTemplateDTO = z.infer<typeof deployTemplateSchema>;
