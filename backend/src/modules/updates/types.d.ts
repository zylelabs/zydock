interface UpdateData {
  channel: import('./update.schema').UpdateChannel;
  branch: string;
  auto: boolean;
  frequency: import('./update.schema').UpdateFrequency;
  checkMinute: number;
  remoteVersion?: string;
  remoteCommit?: string;
  nextCheckAt?: Date;
  lastCheckedAt?: Date;
  lastCheckSource?: import('./update.schema').UpdateCheckSource;
  lastCheckError?: string;
  lastRunId?: string;
  lastNotifiedCommit?: string;
  lastNotifiedRunId?: string;
}

type Update = BaseDocument<UpdateData>;
