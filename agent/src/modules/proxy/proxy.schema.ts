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

export const routeSpecSchema = z
  .object({
    domain: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9*][a-zA-Z0-9.-]*$/, 'Invalid domain')
      .optional(),
    isDefault: z.boolean().optional(),
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
  })
  .refine(spec => Boolean(spec.domain) !== Boolean(spec.isDefault), {
    message: 'Set either domain or isDefault, never both or neither',
  })
  .refine(spec => !spec.isDefault || !spec.tls, {
    message: 'The default route cannot enable TLS: it has no domain to issue a certificate for',
  });

export type RouteSpecDTO = z.infer<typeof routeSpecSchema>;

export const caddyAccessLogSchema = z.object({
  logger: z.literal('http.log.access'),
  ts: z.number(),
  status: z.number().int(),
  size: z.number().int(),
  duration: z.number(),
  request: z.object({
    host: z.string(),
    uri: z.string(),
    method: z.string(),
    remote_ip: z.string(),
    headers: z
      .object({ 'User-Agent': z.array(z.string()).optional() })
      .partial()
      .optional(),
  }),
});

export type CaddyAccessLogEntry = z.infer<typeof caddyAccessLogSchema>;
