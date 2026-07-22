export const SSH_IMPLEMENTATIONS = ['ssh2'] as const;

export type SshImplementation = (typeof SSH_IMPLEMENTATIONS)[number];

export type SshCredentials = {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  passphrase?: string;
};

export type SshConnectOptions = {
  timeoutMs?: number;
  expectedFingerprint?: string;
};

export type SshExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type SshSession = {
  fingerprint: string;
  exec: (command: string) => Promise<SshExecResult>;
  uploadFile: (remotePath: string, content: string | Uint8Array, mode?: number) => Promise<void>;
  close: () => void;
};

export type SshProvider = {
  connect: (credentials: SshCredentials, options?: SshConnectOptions) => Promise<SshSession>;
};

export type SshProviderFactory = () => SshProvider;
