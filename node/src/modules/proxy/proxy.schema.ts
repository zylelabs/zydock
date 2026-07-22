import { z } from 'zod';

export const routeIdParamSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid route id'),
});

export type RouteIdParam = z.infer<typeof routeIdParamSchema>;

export const domainParamSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9*][a-zA-Z0-9.-]*$/, 'Invalid domain'),
});

export type DomainParam = z.infer<typeof domainParamSchema>;

export const routeSpecSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9*][a-zA-Z0-9.-]*$/, 'Invalid domain'),
  upstreams: z
    .array(
      z.object({
        host: z.string().min(1).max(253),
        port: z.number().int().min(1).max(65535),
      }),
    )
    .min(1),
  pathPrefix: z.string().min(1).max(512).startsWith('/').optional(),
  tls: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type RouteSpecDTO = z.infer<typeof routeSpecSchema>;
