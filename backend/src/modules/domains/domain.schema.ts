import { z } from 'zod';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export const DOMAIN_STATUSES = ['pending', 'active', 'error'] as const;

export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, 'Invalid hostname');

const pathPrefixSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/\S*$/, 'The path prefix must start with "/"');

export const domainIdParamSchema = organizationIdParamSchema.extend({
  domainId: z.string().length(24),
});

export type DomainIdParam = z.infer<typeof domainIdParamSchema>;

export const listDomainsQuerySchema = z.object({
  applicationId: z.string().length(24).optional(),
});

export type ListDomainsQuery = z.infer<typeof listDomainsQuerySchema>;

export const createDomainSchema = z.object({
  applicationId: z.string().length(24),
  hostname: hostnameSchema,
  pathPrefix: pathPrefixSchema.optional(),
  tls: z.boolean().default(true),
});

export type CreateDomainDTO = z.infer<typeof createDomainSchema>;

export const updateDomainSchema = z
  .object({
    pathPrefix: pathPrefixSchema.nullable(),
    tls: z.boolean(),
  })
  .partial();

export type UpdateDomainDTO = z.infer<typeof updateDomainSchema>;
