interface UserData {
  email: string;
  name: string;
  avatar?: string;
  status: 'active' | 'disabled';
  password?: string;
  lastLoginAt?: Date;
  superuser?: boolean;
}

type User = BaseDocument<UserData>;
