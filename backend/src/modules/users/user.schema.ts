import { z } from 'zod';

export const USER_STATUSES = ['active', 'disabled'] as const;

export const passwordSchema = z.string().min(8).max(128);

export const idParamSchema = z.object({ id: z.string().length(24) });

export type IdParam = z.infer<typeof idParamSchema>;

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatar: z.string().max(2048).optional(),
});

export type UpdateMeDTO = z.infer<typeof updateMeSchema>;

export const updateUserSchema = updateMeSchema.extend({
  status: z.enum(USER_STATUSES).optional(),
});

export type UpdateUserDTO = z.infer<typeof updateUserSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export type ChangePasswordDTO = z.infer<typeof changePasswordSchema>;
