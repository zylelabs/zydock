import { z } from 'zod';
import { hostnameSchema } from '../domains/domain.schema';

export const DASHBOARD_STATUSES = ['disabled', 'pending', 'active', 'error'] as const;

export type DashboardStatus = (typeof DASHBOARD_STATUSES)[number];

export const updateDashboardSettingsSchema = z.object({
  domain: z.union([hostnameSchema, z.literal('')]).optional(),
  name: z.string().trim().min(1).max(60).optional(),
});

export type UpdateDashboardSettingsDTO = z.infer<typeof updateDashboardSettingsSchema>;
