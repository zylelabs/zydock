interface SessionData {
  userId: string;
  refreshTokenHash: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  lastUsedAt?: Date;
}

type Session = BaseDocument<SessionData>;

interface ApiKeyData {
  userId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  lastUsedAt?: Date;
}

type ApiKey = BaseDocument<ApiKeyData>;

interface PasswordResetData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
}

type PasswordReset = BaseDocument<PasswordResetData>;
