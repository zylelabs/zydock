import { z } from 'zod';

export const containerIdParamSchema = z.object({
  id: z.string().min(1).max(128),
});

export type ContainerIdParam = z.infer<typeof containerIdParamSchema>;

export const portBindingSchema = z.object({
  containerPort: z.number().int().min(1).max(65535),
  hostPort: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
});

export const volumeBindingSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  readOnly: z.boolean().optional(),
});

export const healthcheckSchema = z.object({
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

export const execSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  workingDir: z.string().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  user: z.string().optional(),
});

export type ExecDTO = z.infer<typeof execSchema>;

export const reachabilityBodySchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
});

export type ReachabilityBody = z.infer<typeof reachabilityBodySchema>;

export const logQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(10000).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  follow: z.coerce.boolean().optional(),
});

export type LogQueryDTO = z.infer<typeof logQuerySchema>;
