export const bearerAuth: Record<string, string[]>[] = [{ BearerAuth: [] }];

export const bearerOrApiKeyAuth: Record<string, string[]>[] = [
  { BearerAuth: [] },
  { ApiKeyAuth: [] },
];

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

export const paginatedSchema = (itemSchema: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: itemSchema },
    total: { type: 'integer' },
    page: { type: 'integer' },
    size: { type: 'integer' },
    pages: { type: 'integer' },
  },
});
