import type { DocOptions } from 'hono-route-docs';
import { bearerAuth, bearerOrApiKeyAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';
import { userSchema } from '../users/users.docs';

const tokenPairSchema = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
  },
};

const authResponseSchema = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    user: userSchema,
  },
};

export const authDocs = {
  signup: {
    tags: ['Auth'],
    summary: 'Sign up',
    description: 'Creates a user with email and password and issues the access and refresh tokens.',
    responses: {
      201: jsonRes('User created.', authResponseSchema),
      400: errorRes('Invalid data.'),
      409: errorRes('Email already registered.'),
    },
  },
  signin: {
    tags: ['Auth'],
    summary: 'Sign in',
    description: 'Authenticates with email and password and issues the access and refresh tokens.',
    responses: {
      200: jsonRes('Authenticated successfully.', authResponseSchema),
      401: errorRes('Invalid credentials.'),
      403: errorRes('Account disabled.'),
    },
  },
  refresh: {
    tags: ['Auth'],
    summary: 'Refresh tokens',
    description:
      'Rotates the refresh token and issues a new pair. The previous refresh token stops working.',
    responses: {
      200: jsonRes('New token pair.', tokenPairSchema),
      401: errorRes('Invalid or expired refresh token.'),
      403: errorRes('Account disabled.'),
    },
  },
  logout: {
    tags: ['Auth'],
    summary: 'Sign out',
    description: 'Revokes the session behind the current access token.',
    security: bearerAuth,
    responses: {
      200: messageRes('Signed out.'),
      401: errorRes('Credentials not provided or invalid.'),
      403: errorRes('Requires a user session.'),
    },
  },
  forgotPassword: {
    tags: ['Auth'],
    summary: 'Request a password reset',
    description:
      'Sends a single-use reset link when the email exists. The response is always the same, ' +
      'so the endpoint never reveals whether an account exists.',
    responses: {
      200: messageRes('If the email exists, a reset link was sent.'),
    },
  },
  resetPassword: {
    tags: ['Auth'],
    summary: 'Reset the password',
    description:
      'Consumes a single-use reset token, sets the new password and revokes every session and ' +
      'API key of the account.',
    responses: {
      200: messageRes('Password updated.'),
      400: errorRes('Invalid or expired token.'),
    },
  },
} satisfies Record<string, DocOptions>;
