import { z } from 'zod';
import { GIT_HOSTS } from '../../providers/git/git.contract';
import { applicationComposeSchema } from '../compose/compose.schema';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export const APPLICATION_STATUSES = [
  'created',
  'deploying',
  'running',
  'stopped',
  'failed',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_SOURCES = ['git', 'compose'] as const;

export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export const APPLICATION_RESTART_POLICIES = [
  'no',
  'always',
  'unless-stopped',
  'on-failure',
] as const;

export type ApplicationRestartPolicy = (typeof APPLICATION_RESTART_POLICIES)[number];

export const APPLICATION_GIT_SOURCES = ['pat', 'github-app'] as const;

export type ApplicationGitSource = (typeof APPLICATION_GIT_SOURCES)[number];

export const applicationIdParamSchema = organizationIdParamSchema.extend({
  applicationId: z.string().length(24),
});

export type ApplicationIdParam = z.infer<typeof applicationIdParamSchema>;

export const applicationVariableKeyParamSchema = applicationIdParamSchema.extend({
  key: z.string().trim().min(1).max(128),
});

export type ApplicationVariableKeyParam = z.infer<typeof applicationVariableKeyParamSchema>;

export const applicationServiceParamSchema = applicationIdParamSchema.extend({
  service: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid service name'),
});

export type ApplicationServiceParam = z.infer<typeof applicationServiceParamSchema>;

const gitBaseSchema = z.object({
  host: z.enum(GIT_HOSTS),
  repository: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .regex(/^[^/\s]+\/[^/\s]+$/, 'Repository must be in the "owner/name" format'),
  branch: z.string().trim().min(1).max(200),
  dockerfilePath: z.string().trim().min(1).max(512),
  buildContext: z.string().trim().min(1).max(512),
  autoDeploy: z.boolean(),
  token: z.string().min(1).max(512).optional(),
  source: z.enum(APPLICATION_GIT_SOURCES),
  gitSourceId: z.string().length(24).optional(),
  installationId: z.string().trim().min(1).optional(),
});

const refineGithubApp = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine(
      value => {
        const git = value as {
          source?: ApplicationGitSource;
          gitSourceId?: string;
          installationId?: string;
        };

        return git.source !== 'github-app' || Boolean(git.gitSourceId && git.installationId);
      },
      {
        message: 'gitSourceId and installationId are required when source is "github-app"',
        path: ['gitSourceId'],
      },
    )
    .refine(
      value => {
        const git = value as { source?: ApplicationGitSource; token?: string | null };

        return git.source !== 'github-app' || !git.token;
      },
      { message: 'token cannot be set when source is "github-app"', path: ['token'] },
    );

const gitSchema = refineGithubApp(
  gitBaseSchema.extend({
    host: gitBaseSchema.shape.host.default('github'),
    branch: gitBaseSchema.shape.branch.default('main'),
    dockerfilePath: gitBaseSchema.shape.dockerfilePath.default('Dockerfile'),
    buildContext: gitBaseSchema.shape.buildContext.default('.'),
    autoDeploy: gitBaseSchema.shape.autoDeploy.default(true),
    source: gitBaseSchema.shape.source.default('pat'),
  }),
);

const gitUpdateSchema = refineGithubApp(
  gitBaseSchema.partial().extend({
    token: z.string().min(1).max(512).nullable().optional(),
  }),
);

const volumeSchema = z.object({
  source: z.string().trim().min(1).max(512),
  target: z.string().trim().min(1).max(512).startsWith('/'),
  readOnly: z.boolean().optional(),
});

const portMappingSchema = z.object({
  hostPort: z.coerce.number().int().min(1).max(65535),
  containerPort: z.coerce.number().int().min(1).max(65535),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
});

const healthcheckSchema = z.object({
  path: z.string().trim().min(1).max(512).startsWith('/'),
  intervalSeconds: z.coerce.number().int().min(1).max(3600).default(30),
  timeoutSeconds: z.coerce.number().int().min(1).max(600).default(5),
  retries: z.coerce.number().int().min(1).max(20).default(3),
  startPeriodSeconds: z.coerce.number().int().min(0).max(3600).optional(),
});

export const resourcesSchema = z.object({
  cpus: z.coerce.number().positive().max(256).optional(),
  memoryMb: z.coerce
    .number()
    .int()
    .positive()
    .max(1024 * 1024)
    .optional(),
});

const variableSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid environment variable name'),
  value: z.string().max(8192),
  secret: z.boolean().default(false),
  build: z.boolean().default(false),
});

const gitApplicationSchema = z.object({
  source: z.literal('git'),
  name: z.string().trim().min(1).max(120),
  environmentId: z.string().length(24),
  serverId: z.string().length(24),
  git: gitSchema,
  port: z.coerce.number().int().min(1).max(65535),
  portMappings: z.array(portMappingSchema).max(50).default([]),
  variables: z.array(variableSchema).max(200).default([]),
  volumes: z.array(volumeSchema).max(50).default([]),
  networks: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
  healthcheck: healthcheckSchema.optional(),
  resources: resourcesSchema.optional(),
  restartPolicy: z.enum(APPLICATION_RESTART_POLICIES).default('unless-stopped'),
});

const composeApplicationSchema = z.object({
  source: z.literal('compose'),
  name: z.string().trim().min(1).max(120),
  environmentId: z.string().length(24),
  serverId: z.string().length(24),
  compose: applicationComposeSchema,
  variables: z.array(variableSchema).max(200).default([]),
  resources: resourcesSchema.optional(),
  restartPolicy: z.enum(APPLICATION_RESTART_POLICIES).default('unless-stopped'),
});

export const createApplicationSchema = z.preprocess(
  value =>
    value && typeof value === 'object' && !('source' in value)
      ? { ...value, source: 'git' }
      : value,
  z.discriminatedUnion('source', [gitApplicationSchema, composeApplicationSchema]),
);

export type CreateApplicationDTO = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  serverId: z.string().length(24).optional(),
  git: gitUpdateSchema.optional(),
  compose: applicationComposeSchema.partial().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  portMappings: z.array(portMappingSchema).max(50).optional(),
  volumes: z.array(volumeSchema).max(50).optional(),
  networks: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
  healthcheck: healthcheckSchema.nullable().optional(),
  resources: resourcesSchema.optional(),
  restartPolicy: z.enum(APPLICATION_RESTART_POLICIES).optional(),
});

export type UpdateApplicationDTO = z.infer<typeof updateApplicationSchema>;

export const replaceVariablesSchema = z.object({
  variables: z.array(variableSchema).max(200),
});

export type ReplaceVariablesDTO = z.infer<typeof replaceVariablesSchema>;

export const changeApplicationVersionSchema = z.object({
  version: z.string().trim().min(1).max(200),
  deployNow: z.boolean().default(true),
});

export type ChangeApplicationVersionDTO = z.infer<typeof changeApplicationVersionSchema>;

export const applyTemplateUpdateSchema = z.object({
  confirmOverwrite: z.boolean().default(false),
  deployNow: z.boolean().default(true),
  inputs: z.record(z.string(), z.string().max(8192)).default({}),
});

export type ApplyTemplateUpdateDTO = z.infer<typeof applyTemplateUpdateSchema>;

export const removeApplicationQuerySchema = z.object({
  removeData: z.coerce.boolean().optional(),
});

export type RemoveApplicationQuery = z.infer<typeof removeApplicationQuerySchema>;

export const listApplicationsQuerySchema = z.object({
  projectId: z.string().length(24).optional(),
  environmentId: z.string().length(24).optional(),
  serverId: z.string().length(24).optional(),
});

export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;
