import { z } from 'zod';
import { GIT_HOSTS } from '../../providers/git/git.contract';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export const APPLICATION_STATUSES = [
  'created',
  'deploying',
  'running',
  'stopped',
  'failed',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_RESTART_POLICIES = [
  'no',
  'always',
  'unless-stopped',
  'on-failure',
] as const;

export type ApplicationRestartPolicy = (typeof APPLICATION_RESTART_POLICIES)[number];

export const applicationIdParamSchema = organizationIdParamSchema.extend({
  applicationId: z.string().length(24),
});

export type ApplicationIdParam = z.infer<typeof applicationIdParamSchema>;

const gitBaseSchema = z.object({
  host: z.enum(GIT_HOSTS),
  /** `owner/repository`, as every supported host names it. */
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
});

const gitSchema = gitBaseSchema.extend({
  host: gitBaseSchema.shape.host.default('github'),
  branch: gitBaseSchema.shape.branch.default('main'),
  dockerfilePath: gitBaseSchema.shape.dockerfilePath.default('Dockerfile'),
  buildContext: gitBaseSchema.shape.buildContext.default('.'),
  autoDeploy: gitBaseSchema.shape.autoDeploy.default(true),
});

/**
 * Updates must not carry defaults: `.partial()` keeps them, so a patch touching a single field
 * would silently reset every other one — the branch included.
 */
const gitUpdateSchema = gitBaseSchema.partial();

const volumeSchema = z.object({
  source: z.string().trim().min(1).max(512),
  target: z.string().trim().min(1).max(512).startsWith('/'),
  readOnly: z.boolean().optional(),
});

const healthcheckSchema = z.object({
  path: z.string().trim().min(1).max(512).startsWith('/'),
  intervalSeconds: z.coerce.number().int().min(1).max(3600).default(30),
  timeoutSeconds: z.coerce.number().int().min(1).max(600).default(5),
  retries: z.coerce.number().int().min(1).max(20).default(3),
  startPeriodSeconds: z.coerce.number().int().min(0).max(3600).optional(),
});

const resourcesSchema = z.object({
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
});

export const createApplicationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  environmentId: z.string().length(24),
  serverId: z.string().length(24),
  git: gitSchema,
  port: z.coerce.number().int().min(1).max(65535),
  variables: z.array(variableSchema).max(200).default([]),
  volumes: z.array(volumeSchema).max(50).default([]),
  networks: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
  healthcheck: healthcheckSchema.optional(),
  resources: resourcesSchema.optional(),
  restartPolicy: z.enum(APPLICATION_RESTART_POLICIES).default('unless-stopped'),
});

export type CreateApplicationDTO = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  serverId: z.string().length(24).optional(),
  git: gitUpdateSchema.optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
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

export const listApplicationsQuerySchema = z.object({
  projectId: z.string().length(24).optional(),
  environmentId: z.string().length(24).optional(),
  serverId: z.string().length(24).optional(),
});

export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;
