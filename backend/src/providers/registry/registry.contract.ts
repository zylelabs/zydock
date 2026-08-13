export type RegistryTag = {
  name: string;
  updatedAt?: Date;
};

export type RegistryProvider = {
  listTags: (repository: string) => Promise<RegistryTag[]>;
  tagExists: (repository: string, tag: string) => Promise<boolean>;
};

export type RegistryProviderOptions = {
  timeoutMs: number;
};

export type RegistryProviderFactory = (options: RegistryProviderOptions) => RegistryProvider;
