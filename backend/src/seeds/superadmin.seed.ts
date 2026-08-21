import config from '../config';
import userModel from '../modules/users/user.model';
import { hashPassword } from '../modules/users/user.service';
import { logInfo, logWarn } from '../utils/logger';

const GENERATED_PASSWORD_BYTES = 18;

const generatePassword = () => {
  const buffer = new Uint8Array(GENERATED_PASSWORD_BYTES);

  crypto.getRandomValues(buffer);

  return Buffer.from(buffer).toString('base64url');
};

export const seedSuperadmins = async () => {
  if (!config.auth.superusers.length) {
    logWarn('No SUPERUSER_EMAILS configured, nothing to seed');
    return;
  }

  for (const email of config.auth.superusers) {
    const existing = await userModel.findOne({ email });

    if (existing) {
      logInfo('Superuser already exists', { email });
      continue;
    }

    const password = generatePassword();

    await userModel.create({
      email,
      name: email.split('@')[0],
      status: 'active',
      password: await hashPassword(password),
      provisionedBySeed: true,
    });

    logInfo(`Superuser created: ${email} — temporary password: ${password}`);
  }
};
