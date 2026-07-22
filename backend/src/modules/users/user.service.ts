import config from '../../config';
import userModel from './user.model';

export const hashPassword = (password: string) =>
  Bun.password.hash(password, { algorithm: 'argon2id' });

export const verifyPassword = (password: string, hash: string) =>
  Bun.password.verify(password, hash);

export const isSuperuser = (email: string) => config.auth.superusers.includes(email.toLowerCase());

export const findActiveUserById = (id: string) => userModel.findOne({ _id: id, status: 'active' });

export const findUserByEmail = (email: string) => userModel.findOne({ email: email.toLowerCase() });

export const findUserWithPassword = (email: string) =>
  userModel.findOne({ email: email.toLowerCase() }).select('+password');

export const serializeUser = (user: User) => ({
  id: String(user._id),
  email: user.email,
  name: user.name,
  avatar: user.avatar,
  status: user.status,
  superuser: isSuperuser(user.email),
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
});
