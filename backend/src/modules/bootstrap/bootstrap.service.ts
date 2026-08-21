import config from '../../config';
import { logWarn } from '../../utils/logger';
import { superuserExists } from '../users/user.service';
import bootstrapModel from './bootstrap.model';
import { BOOTSTRAP_CODE_ALPHABET, BOOTSTRAP_CODE_LENGTH } from './bootstrap.schema';

export const normalizeBootstrapCode = (input: string) =>
  input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');

const randomCode = () => {
  const maxValidByte = 256 - (256 % BOOTSTRAP_CODE_ALPHABET.length);
  const characters: string[] = [];

  while (characters.length < BOOTSTRAP_CODE_LENGTH) {
    const buffer = new Uint8Array(BOOTSTRAP_CODE_LENGTH - characters.length);

    crypto.getRandomValues(buffer);

    for (const byte of buffer) {
      if (byte >= maxValidByte) {
        continue;
      }

      characters.push(BOOTSTRAP_CODE_ALPHABET[byte % BOOTSTRAP_CODE_ALPHABET.length]);
    }
  }

  return characters.join('');
};

export const generateBootstrapCode = async () => {
  const code = randomCode();

  return { code, codeHash: await Bun.password.hash(code, { algorithm: 'argon2id' }) };
};

const persistNewCode = async () => {
  const { code, codeHash } = await generateBootstrapCode();

  await bootstrapModel.findOneAndUpdate(
    {},
    { $set: { codeHash, attempts: 0, lockedUntil: null, consumedAt: null, consumedBy: null } },
    { upsert: true },
  );

  return code;
};

export const ensureBootstrapCode = async () => {
  if (await superuserExists()) {
    return null;
  }

  const existing = await bootstrapModel.findOne({});

  if (existing?.codeHash && !existing.consumedAt) {
    return null;
  }

  return persistNewCode();
};

export const regenerateBootstrapCode = async () => {
  if (await superuserExists()) {
    return null;
  }

  return persistNewCode();
};

export const bootstrapRequired = async () => !(await superuserExists());

export const verifyBootstrapCode = async (rawCode: string) => {
  if (await superuserExists()) {
    return false;
  }

  const document = await bootstrapModel.findOne({}).select('+codeHash');

  if (!document?.codeHash || document.consumedAt) {
    return false;
  }

  const now = new Date();

  if (document.lockedUntil && document.lockedUntil > now) {
    return false;
  }

  const matches = await Bun.password.verify(normalizeBootstrapCode(rawCode), document.codeHash);

  if (matches) {
    return true;
  }

  const attempts = document.attempts + 1;
  const { maxAttempts, lockoutMs } = config.bootstrap;
  const overLimit = attempts % maxAttempts === 0;
  const lockedUntil = overLimit
    ? new Date(now.getTime() + lockoutMs * Math.ceil(attempts / maxAttempts))
    : (document.lockedUntil ?? null);

  await bootstrapModel.updateOne({ _id: document._id }, { $set: { attempts, lockedUntil } });

  logWarn('Bootstrap code verification failed', { attempts, lockedUntil, locked: overLimit });

  return false;
};

export const consumeBootstrapCode = async (userId: string) => {
  const result = await bootstrapModel.findOneAndUpdate(
    { consumedAt: null, codeHash: { $exists: true } },
    { $set: { consumedAt: new Date(), consumedBy: userId } },
    { new: true },
  );

  return Boolean(result);
};
