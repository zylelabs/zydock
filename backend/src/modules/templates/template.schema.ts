import { z } from 'zod';

const RESERVED_PREFIX = 'ZYDOCK_';

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

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
  })
  .refine(input => input.type !== 'select' || Boolean(input.options?.length), {
    message: '"select" inputs require "options"',
    path: ['options'],
  });

const templateSecretSchema = z.object({
  key: templateKeySchema,
  generate: z.enum(TEMPLATE_SECRET_GENERATORS),
});

const templateExposeSchema = z.object({
  service: serviceNameSchema,
  port: z.coerce.number().int().min(1).max(65535),
  domain: z.boolean().default(true),
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

export const MAX_VERSION_PATTERN_LENGTH = 200;

export const MAX_VERSION_TAG_LENGTH = 128;

export const testVersionPattern = (pattern: string, value: string): boolean =>
  new RegExp(pattern).test(value.slice(0, MAX_VERSION_TAG_LENGTH));

export const DEFAULT_VERSION_INCLUDE_PATTERN = '^v?\\d+(\\.\\d+){0,2}$';

const versionPatternSchema = z.string().trim().min(1).max(MAX_VERSION_PATTERN_LENGTH);

const templateVersionsRegistrySchema = z
  .object({
    include: versionPatternSchema.optional(),
    exclude: versionPatternSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
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
    key: templateKeySchema,
    default: z.string().trim().min(1).max(120),
    available: z.array(templateVersionEntrySchema).min(1).max(30),
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

    if (!values.includes(versions.default)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"default" must be one of "available[].value"',
        path: ['default'],
      });
    }
  });

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
    databases: z.array(templateDatabaseSchema).max(10).default([]),
    inputs: z.array(templateInputSchema).max(50).default([]),
    secrets: z.array(templateSecretSchema).max(50).default([]),
    versions: templateVersionsSchema.optional(),
    deprecated: z.boolean().default(false),
  })
  .superRefine((template, ctx) => {
    if (!template.versions) {
      return;
    }

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
});

export type DeployTemplateDTO = z.infer<typeof deployTemplateSchema>;
