export const agentAuth: Record<string, string[]>[] = [{ AgentToken: [] }];

export const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const messageSchema = {
  type: 'object',
  properties: { message: { type: 'string' } },
};

export const jsonRes = (description: string, schema: Record<string, unknown>) => ({
  description,
  content: { 'application/json': { schema } },
});

export const errorRes = (description: string) => jsonRes(description, errorSchema);

export const messageRes = (description: string) => jsonRes(description, messageSchema);
