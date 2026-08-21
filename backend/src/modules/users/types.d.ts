interface UserData {
  email: string;
  name: string;
  avatar?: string;
  status: 'active' | 'disabled';
  password?: string;
  lastLoginAt?: Date;
  provisionedBySeed?: boolean;
}

type User = BaseDocument<UserData>;
