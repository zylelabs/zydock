import { z } from 'zod';
import { bootstrapCodePattern } from '../bootstrap/bootstrap.schema';
import { normalizeBootstrapCode } from '../bootstrap/bootstrap.service';
import { passwordSchema } from '../users/user.schema';

export const signupSchema = z.object({
  email: z.email().toLowerCase(),
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
  bootstrapCode: z
    .string()
    .trim()
    .min(1)
    .transform(normalizeBootstrapCode)
    .pipe(z.string().regex(bootstrapCodePattern))
    .optional(),
});

export type SignupDTO = z.infer<typeof signupSchema>;

export const signinSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1),
});

export type SigninDTO = z.infer<typeof signinSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshDTO = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email().toLowerCase(),
});

export type ForgotPasswordDTO = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export type ResetPasswordDTO = z.infer<typeof resetPasswordSchema>;
