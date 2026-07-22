export const STORAGE_IMPLEMENTATIONS = ['local', 'r2', 's3'] as const;

export type StorageImplementation = (typeof STORAGE_IMPLEMENTATIONS)[number];

export type StorageObject = {
  key: string;
  sizeBytes: number;
  updatedAt: string;
};

export type StoragePutOptions = {
  contentType?: string;
};

export type StorageProvider = {
  put: (
    key: string,
    data: Uint8Array | ReadableStream,
    options?: StoragePutOptions,
  ) => Promise<void>;
  get: (key: string) => Promise<ReadableStream>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => Promise<StorageObject[]>;
  exists: (key: string) => Promise<boolean>;
  getSignedUrl: (key: string, expiresInSeconds: number) => Promise<string>;
};

export type StorageProviderFactory = () => StorageProvider;
