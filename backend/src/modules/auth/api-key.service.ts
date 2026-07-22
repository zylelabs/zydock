import apiKeyModel from './api-key.model';
import { generateToken, hashToken } from './session.service';

const API_KEY_LABEL = 'zyd';
const API_KEY_BYTES = 32;
const PREFIX_LENGTH = 12;

export const createApiKeyToken = async () => {
  const token = `${API_KEY_LABEL}_${generateToken(API_KEY_BYTES)}`;

  return {
    token,
    prefix: token.slice(0, PREFIX_LENGTH),
    tokenHash: await hashToken(token),
  };
};

export const findActiveApiKey = async (token: string) => {
  if (!token.startsWith(`${API_KEY_LABEL}_`)) {
    return null;
  }

  const candidates = await apiKeyModel
    .find({
      prefix: token.slice(0, PREFIX_LENGTH),
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
    .select('+tokenHash');

  const tokenHash = await hashToken(token);

  return candidates.find(candidate => candidate.tokenHash === tokenHash) ?? null;
};

export const touchApiKey = (id: string) =>
  apiKeyModel.updateOne({ _id: id }, { $set: { lastUsedAt: new Date() } });

export const revokeApiKey = async (id: string, userId: string) => {
  const result = await apiKeyModel.updateOne(
    { _id: id, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  return result.matchedCount > 0;
};

export const revokeAllUserApiKeys = async (userId: string) => {
  const result = await apiKeyModel.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  return result.modifiedCount;
};

export const serializeApiKey = (apiKey: ApiKey) => ({
  id: String(apiKey._id),
  name: apiKey.name,
  prefix: apiKey.prefix,
  expiresAt: apiKey.expiresAt,
  lastUsedAt: apiKey.lastUsedAt,
  createdAt: apiKey.createdAt,
});
