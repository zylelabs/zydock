import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { logInfo } from '../../utils/logger';
import userModel from '../users/user.model';
import {
  findUserByEmail,
  findUserWithPassword,
  hashPassword,
  serializeUser,
  verifyPassword,
} from '../users/user.service';
import { revokeAllUserApiKeys } from './api-key.service';
import { authDocs } from './auth.docs';
import { authMiddleware, requireUserSession } from './auth.middleware';
import {
  ForgotPasswordDTO,
  forgotPasswordSchema,
  RefreshDTO,
  refreshSchema,
  ResetPasswordDTO,
  resetPasswordSchema,
  SigninDTO,
  signinSchema,
  SignupDTO,
  signupSchema,
} from './auth.schema';
import {
  consumePasswordReset,
  createPasswordReset,
  findActivePasswordReset,
  sendPasswordResetEmail,
} from './password-reset.service';
import {
  findActiveSessionByToken,
  getClientMeta,
  issueSession,
  revokeAllUserSessions,
  revokeSession,
  rotateSession,
} from './session.service';

const { router, post } = createRouter();

const GENERIC_RESET_MESSAGE = 'If the email exists, a reset link was sent';

post('/signup', authDocs.signup, validator('json', signupSchema), async (c: Context) => {
  const body = c.req.valid('json' as never) as SignupDTO;

  const existingUser = await findUserByEmail(body.email);

  if (existingUser) {
    return c.json({ error: 'A user with this email already exists' }, 409);
  }

  const user = await userModel.create({
    email: body.email,
    name: body.name,
    status: 'active',
    password: await hashPassword(body.password),
  });

  const { userAgent, ip } = getClientMeta(c);

  const { accessToken, refreshToken } = await issueSession({
    userId: String(user._id),
    email: user.email,
    userAgent,
    ip,
  });

  return c.json({ accessToken, refreshToken, user: serializeUser(user) }, 201);
});

post('/signin', authDocs.signin, validator('json', signinSchema), async (c: Context) => {
  const body = c.req.valid('json' as never) as SigninDTO;

  const user = await findUserWithPassword(body.email);

  if (!user?.password) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const isValid = await verifyPassword(body.password, user.password);

  if (!isValid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  if (user.status !== 'active') {
    return c.json({ error: 'Account disabled' }, 403);
  }

  const { userAgent, ip } = getClientMeta(c);

  const { accessToken, refreshToken } = await issueSession({
    userId: String(user._id),
    email: user.email,
    userAgent,
    ip,
  });

  await userModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  return c.json({ accessToken, refreshToken, user: serializeUser(user) });
});

post('/refresh', authDocs.refresh, validator('json', refreshSchema), async (c: Context) => {
  const body = c.req.valid('json' as never) as RefreshDTO;

  const session = await findActiveSessionByToken(body.refreshToken);

  if (!session) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }

  const user = await userModel.findById(session.userId);

  if (!user) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }

  if (user.status !== 'active') {
    await revokeAllUserSessions(String(user._id));

    return c.json({ error: 'Account disabled' }, 403);
  }

  const { userAgent, ip } = getClientMeta(c);

  const rotated = await rotateSession({ session, email: user.email, userAgent, ip });

  return c.json({ accessToken: rotated.accessToken, refreshToken: rotated.refreshToken });
});

post('/logout', authDocs.logout, authMiddleware, requireUserSession, async (c: Context) => {
  const auth = c.get('auth');

  await revokeSession(auth.sid as string, auth.sub);

  return c.json({ message: 'Signed out successfully' });
});

post(
  '/forgot-password',
  authDocs.forgotPassword,
  validator('json', forgotPasswordSchema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as ForgotPasswordDTO;

    const user = await findUserByEmail(body.email);

    if (!user || user.status !== 'active') {
      return c.json({ message: GENERIC_RESET_MESSAGE });
    }

    const token = await createPasswordReset(String(user._id));

    await sendPasswordResetEmail(user.email, token);

    logInfo('Password reset requested', { userId: String(user._id) });

    return c.json({ message: GENERIC_RESET_MESSAGE });
  },
);

post(
  '/reset-password',
  authDocs.resetPassword,
  validator('json', resetPasswordSchema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as ResetPasswordDTO;

    const reset = await findActivePasswordReset(body.token);

    if (!reset) {
      return c.json({ error: 'Invalid or expired token' }, 400);
    }

    const userId = String(reset.userId);

    await userModel.updateOne(
      { _id: userId },
      { $set: { password: await hashPassword(body.password) } },
    );

    await consumePasswordReset(String(reset._id));
    await revokeAllUserSessions(userId);
    await revokeAllUserApiKeys(userId);

    logInfo('Password reset completed', { userId });

    return c.json({ message: 'Password updated successfully' });
  },
);

export default router;
