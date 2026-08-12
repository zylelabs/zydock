import { z } from 'zod';

export const ALLOWED_COMMANDS = [
  'docker.version',
  'docker.info',
  'docker.prune',
  'docker.compose-version',
  'system.uptime',
  'system.disk',
  'system.memory',
  'agent.autoheal-sweep',
] as const;

export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

export const runCommandSchema = z.object({
  name: z.enum(ALLOWED_COMMANDS),
});

export type RunCommandDTO = z.infer<typeof runCommandSchema>;
