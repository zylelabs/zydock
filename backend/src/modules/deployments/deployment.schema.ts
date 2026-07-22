import { z } from 'zod';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export const DEPLOYMENT_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const DEPLOYMENT_TRIGGERS = ['manual', 'webhook'] as const;

export type DeploymentTrigger = (typeof DEPLOYMENT_TRIGGERS)[number];

export const DEPLOYMENT_STEPS = ['clone', 'build', 'container', 'proxy', 'healthcheck'] as const;

export type DeploymentStep = (typeof DEPLOYMENT_STEPS)[number];

export const DEPLOYMENT_STEP_STATUSES = ['ok', 'failed', 'skipped'] as const;

export type DeploymentStepStatus = (typeof DEPLOYMENT_STEP_STATUSES)[number];

export const deploymentIdParamSchema = organizationIdParamSchema.extend({
  deploymentId: z.string().length(24),
});

export type DeploymentIdParam = z.infer<typeof deploymentIdParamSchema>;

export const listDeploymentsQuerySchema = z.object({
  applicationId: z.string().length(24).optional(),
  status: z.enum(DEPLOYMENT_STATUSES).optional(),
});

export type ListDeploymentsQuery = z.infer<typeof listDeploymentsQuerySchema>;

export const triggerDeploymentSchema = z.object({
  /** Deploys the branch of the application by default. */
  branch: z.string().trim().min(1).max(200).optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/, 'Invalid commit sha')
    .optional(),
});

export type TriggerDeploymentDTO = z.infer<typeof triggerDeploymentSchema>;
