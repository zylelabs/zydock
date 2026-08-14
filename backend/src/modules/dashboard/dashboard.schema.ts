import { z } from 'zod';
import { hostnameSchema } from '../domains/domain.schema';

export const DASHBOARD_STATUSES = ['disabled', 'pending', 'active', 'error'] as const;

export type DashboardStatus = (typeof DASHBOARD_STATUSES)[number];

export const updateDashboardDomainSchema = z.object({
  domain: z.union([hostnameSchema, z.literal('')]),
});

export type UpdateDashboardDomainDTO = z.infer<typeof updateDashboardDomainSchema>;
