import type { DocOptions } from 'hono-route-docs';
import { jsonRes } from '../../utils/openapi';

const statusSchema = {
  type: 'object',
  properties: {
    required: { type: 'boolean' },
  },
};

export const bootstrapDocs = {
  status: {
    tags: ['Bootstrap'],
    summary: 'Check whether this instance still needs its first superadmin',
    description:
      'Public. Reveals only whether the instance already has a superuser — information any ' +
      'signup attempt would already leak.',
    responses: {
      200: jsonRes('Bootstrap status.', statusSchema),
    },
  },
} satisfies Record<string, DocOptions>;
