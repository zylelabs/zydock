import { z } from 'zod';

const topicSchema = z.string().trim().min(1).max(200);

export const clientMessageSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('subscribe'), topic: topicSchema }),
  z.object({ action: z.literal('unsubscribe'), topic: topicSchema }),
  z.object({ action: z.literal('ping') }),
]);

export type ClientMessageDTO = z.infer<typeof clientMessageSchema>;
