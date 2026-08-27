export type SnapshotConnection = {
  serverId: string;
  endpoint: string;
  token: string;
};

export type SnapshotBundleRequest = {
  publicIp: string;
  domain?: string;
  includeApplicationData?: boolean;
  volumes?: string[];
};

export type SnapshotProvider = {
  streamBundle: (request: SnapshotBundleRequest) => Promise<ReadableStream<Uint8Array>>;
};

export type SnapshotProviderFactory = (connection: SnapshotConnection) => SnapshotProvider;
