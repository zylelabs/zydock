import { z } from 'zod';
import { serverIdParamSchema } from '../servers/server.schema';

export const CONTAINER_STATES = [
  'created',
  'running',
  'paused',
  'restarting',
  'exited',
  'dead',
  'unknown',
] as const;

export const containerIdParamSchema = serverIdParamSchema.extend({
  containerId: z.string().min(1).max(128),
});

export type ContainerIdParam = z.infer<typeof containerIdParamSchema>;

export const listContainersQuerySchema = z.object({
  state: z.enum(CONTAINER_STATES).optional(),
  namePrefix: z.string().min(1).max(128).optional(),
  applicationId: z.string().length(24).optional(),
});

export type ListContainersQuery = z.infer<typeof listContainersQuerySchema>;

const portBindingSchema = z.object({
  containerPort: z.number().int().min(1).max(65535),
  hostPort: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
});

const volumeBindingSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  readOnly: z.boolean().optional(),
});

const healthcheckSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  intervalSeconds: z.number().int().min(1),
  timeoutSeconds: z.number().int().min(1),
  retries: z.number().int().min(1),
  startPeriodSeconds: z.number().int().min(0).optional(),
});

export const createContainerSchema = z.object({
  name: z.string().min(1).max(128),
  image: z.string().min(1).max(256),
  command: z.array(z.string()).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  ports: z.array(portBindingSchema).optional(),
  volumes: z.array(volumeBindingSchema).optional(),
  networks: z.array(z.string().min(1)).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  restartPolicy: z.enum(['no', 'always', 'unless-stopped', 'on-failure']).optional(),
  healthcheck: healthcheckSchema.optional(),
  resources: z
    .object({
      cpus: z.number().positive().optional(),
      memoryMb: z.number().int().positive().optional(),
    })
    .optional(),
});

export type CreateContainerDTO = z.infer<typeof createContainerSchema>;

export const stopContainerQuerySchema = z.object({
  timeout: z.coerce.number().int().min(0).max(3600).optional(),
});

export type StopContainerQuery = z.infer<typeof stopContainerQuerySchema>;

export const removeContainerQuerySchema = z.object({
  volumes: z.coerce.boolean().optional(),
});

export type RemoveContainerQuery = z.infer<typeof removeContainerQuerySchema>;

export const logQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(10000).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  follow: z.coerce.boolean().optional(),
});

export type LogQueryDTO = z.infer<typeof logQuerySchema>;
