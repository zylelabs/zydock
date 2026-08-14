import config from '../../config';
import { dispatchNotification } from '../../providers/notification';
import { resolvePublicUrl } from '../dashboard/dashboard.service';
import passwordResetModel from './password-reset.model';
import { generateToken, hashToken } from './session.service';

const RESET_TOKEN_BYTES = 32;

export const createPasswordReset = async (userId: string) => {
  const token = generateToken(RESET_TOKEN_BYTES);

  await passwordResetModel.updateMany({ userId, usedAt: null }, { $set: { usedAt: new Date() } });

  await passwordResetModel.create({
    userId,
    tokenHash: await hashToken(token),
    expiresAt: new Date(Date.now() + config.auth.passwordResetTtlMinutes * 60 * 1000),
  });

  return token;
};

export const findActivePasswordReset = async (token: string) =>
  passwordResetModel
    .findOne({
      tokenHash: await hashToken(token),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    })
    .select('+tokenHash');

export const consumePasswordReset = (id: string) =>
  passwordResetModel.updateOne({ _id: id, usedAt: null }, { $set: { usedAt: new Date() } });

export const sendPasswordResetEmail = async (email: string, token: string) => {
  const link = `${await resolvePublicUrl()}/reset-password?token=${token}`;

  return dispatchNotification(
    {
      subject: 'Reset your password',
      body: `Use the link below to choose a new password. It expires in ${config.auth.passwordResetTtlMinutes} minutes.\n\n${link}`,
      severity: 'info',
    },
    [{ channel: 'email', address: email }],
  );
};
