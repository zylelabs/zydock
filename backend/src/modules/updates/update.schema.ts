import { z } from 'zod';

export const UPDATE_CHANNELS = ['stable', 'nightly', 'dev', 'branch'] as const;

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export const UPDATE_FREQUENCIES = ['hourly', 'daily', 'weekly'] as const;

export type UpdateFrequency = (typeof UPDATE_FREQUENCIES)[number];

export const UPDATE_CHECK_SOURCES = ['manual', 'automatic'] as const;

export type UpdateCheckSource = (typeof UPDATE_CHECK_SOURCES)[number];

export const CHECK_WINDOW_START_HOUR = 3;

export const CHECK_WINDOW_MINUTES = 120;

export const randomCheckMinute = () => Math.floor(Math.random() * CHECK_WINDOW_MINUTES);

const branchSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'The branch has characters that git does not accept');

export const updateSettingsSchema = z
  .object({
    channel: z.enum(UPDATE_CHANNELS),
    branch: branchSchema,
    auto: z.boolean(),
    frequency: z.enum(UPDATE_FREQUENCIES),
  })
  .partial();

export type UpdateSettingsDTO = z.infer<typeof updateSettingsSchema>;

export const updateRunSchema = z
  .object({
    force: z.boolean(),
  })
  .partial();

export type UpdateRunDTO = z.infer<typeof updateRunSchema>;

export const runIdParamSchema = z.object({
  runId: z.string().trim().min(1).max(128),
});

export type RunIdParam = z.infer<typeof runIdParamSchema>;

export const branchIssue = (channel: UpdateChannel, branch: string) => {
  if (channel === 'branch' && !branch) {
    return 'A branch is required when the channel is "branch"';
  }

  return undefined;
};
