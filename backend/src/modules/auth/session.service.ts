import type { Context } from 'hono';
import { sign } from 'hono/jwt';
import type { Document } from 'mongoose';
import config from '../../config';
import sessionModel from './session.model';

const REFRESH_TOKEN_BYTES = 48;

export type AccessTokenClaims = {
  sub: string;
  email: string;
  sid: string;
};

const refreshTokenTtlMs = config.jwt.refreshTokenTtlDays * 24 * 60 * 60 * 1000;

export const generateToken = (bytes: number) => {
  const buffer = new Uint8Array(bytes);

  crypto.getRandomValues(buffer);

  return Buffer.from(buffer).toString('base64url');
};

export const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));

  return Buffer.from(digest).toString('hex');
};

export const getClientMeta = (c: Context) => {
  const forwardedFor = c.req.header('x-forwarded-for');

  return {
    userAgent: c.req.header('user-agent'),
    ip: forwardedFor?.split(',')[0]?.trim() ?? c.req.header('x-real-ip'),
  };
};

export const signAccessToken = (claims: AccessTokenClaims) => {
  const now = Math.floor(Date.now() / 1000);

  return sign(
    {
      sub: claims.sub,
      email: claims.email,
      sid: claims.sid,
      iat: now,
      exp: now + config.jwt.accessTokenTtlSeconds,
    },
    config.jwt.secret,
  );
};

type IssueSessionParams = {
  userId: string;
  email: string;
  userAgent?: string;
  ip?: string;
};

export const issueSession = async (params: IssueSessionParams) => {
  const refreshToken = generateToken(REFRESH_TOKEN_BYTES);

  const session = await sessionModel.create({
    userId: params.userId,
    refreshTokenHash: await hashToken(refreshToken),
    userAgent: params.userAgent,
    ip: params.ip,
    expiresAt: new Date(Date.now() + refreshTokenTtlMs),
    lastUsedAt: new Date(),
  });

  const accessToken = await signAccessToken({
    sub: params.userId,
    email: params.email,
    sid: String(session._id),
  });

  return { session, accessToken, refreshToken };
};

export const findActiveSessionByToken = async (refreshToken: string) =>
  sessionModel
    .findOne({
      refreshTokenHash: await hashToken(refreshToken),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
    .select('+refreshTokenHash');

type RotateSessionParams = {
  session: Session & Document;
  email: string;
  userAgent?: string;
  ip?: string;
};

export const rotateSession = async (params: RotateSessionParams) => {
  const { session } = params;

  const refreshToken = generateToken(REFRESH_TOKEN_BYTES);

  session.refreshTokenHash = await hashToken(refreshToken);
  session.expiresAt = new Date(Date.now() + refreshTokenTtlMs);
  session.lastUsedAt = new Date();

  if (params.userAgent) {
    session.userAgent = params.userAgent;
  }

  if (params.ip) {
    session.ip = params.ip;
  }

  await session.save();

  const accessToken = await signAccessToken({
    sub: String(session.userId),
    email: params.email,
    sid: String(session._id),
  });

  return { session, accessToken, refreshToken };
};

export const revokeSession = async (sessionId: string, userId: string) => {
  const result = await sessionModel.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  return result.matchedCount > 0;
};

export const revokeAllUserSessions = async (userId: string, exceptSessionId?: string) => {
  const filter: Record<string, unknown> = { userId, revokedAt: null };

  if (exceptSessionId) {
    filter._id = { $ne: exceptSessionId };
  }

  const result = await sessionModel.updateMany(filter, { $set: { revokedAt: new Date() } });

  return result.modifiedCount;
};

export const serializeSession = (session: Session, currentSessionId?: string) => ({
  id: String(session._id),
  userAgent: session.userAgent,
  ip: session.ip,
  current: String(session._id) === currentSessionId,
  expiresAt: session.expiresAt,
  lastUsedAt: session.lastUsedAt,
  createdAt: session.createdAt,
});
