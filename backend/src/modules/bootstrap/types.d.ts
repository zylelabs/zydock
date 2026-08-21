interface BootstrapData {
  codeHash?: string;
  attempts: number;
  lockedUntil?: Date | null;
  consumedAt?: Date | null;
  consumedBy?: string | null;
}

type Bootstrap = BaseDocument<BootstrapData>;
