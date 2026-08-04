import type { Paginated } from '../useApi';

export const USER_STATUSES = ['active', 'disabled'] as const;

export type UserAccountStatus = (typeof USER_STATUSES)[number];

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  status: UserAccountStatus;
  superuser: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface UpdateProfileBody {
  name?: string;
  avatar?: string;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateUserBody {
  name?: string;
  avatar?: string;
  status?: UserAccountStatus;
}

export interface UserFilter {
  search?: string;
  status?: UserAccountStatus;
}

export const useUsers = () => {
  const api = useApi();

  const me = () => api.get<{ user: UserAccount }>('/users/me');

  const updateMe = (body: UpdateProfileBody) =>
    api.patch<{ user: UserAccount }>('/users/me', { body });

  const changePassword = (body: ChangePasswordBody) =>
    api.post<{ message: string }>('/users/me/password', { body });

  const list = (filter: UserFilter = {}) =>
    api.get<Paginated<UserAccount>>('/users', { query: { size: 100, ...filter } });

  const update = (id: string, body: UpdateUserBody) =>
    api.patch<{ user: UserAccount }>(`/users/${id}`, { body });

  const disable = (id: string) => api.del<{ message: string }>(`/users/${id}`);

  return { me, updateMe, changePassword, list, update, disable };
};
