interface TemplateInput {
  key: string;
  label: string;
  type: import('./template.schema').TemplateInputType;
  options?: string[];
  default?: string | number | boolean;
  required: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  help?: string;
  must_be_true?: boolean;
}

interface TemplateSecret {
  key: string;
  generate: import('./template.schema').TemplateSecretGenerator;
}

interface TemplateExpose {
  service: string;
  port: number;
  kind: import('./template.schema').TemplateExposeKind;
  host_port_key?: string;
  domain: boolean;
  startup_timeout_seconds?: number;
}

interface TemplateConsole {
  log_file: string;
  tail_lines: number;
}

interface TemplateCredentialRef {
  key?: string;
  value?: string;
}

interface TemplateDatabaseCredentials {
  username?: TemplateCredentialRef;
  password: TemplateCredentialRef;
  database?: TemplateCredentialRef;
}

interface TemplateDatabase {
  service: string;
  engine: import('./template.schema').TemplateDatabaseEngine;
  credentials: TemplateDatabaseCredentials;
}

interface TemplateVersionEntry {
  value: string;
  label?: string;
}

interface TemplateVersionsRegistry {
  include?: string;
  exclude?: string;
  limit: number;
}

interface TemplateVersions {
  key: string;
  default?: string;
  available: TemplateVersionEntry[];
  registry?: TemplateVersionsRegistry;
}

interface TemplateManifest {
  id: string;
  version: number;
  name: string;
  tagline: string;
  category: string;
  tags: string[];
  icon?: string;
  website?: string;
  documentation?: string;
  license?: string;
  author: string;
  origin: import('./template.schema').TemplateOrigin;
  dockerCompose: string;
  expose: TemplateExpose;
  console?: TemplateConsole;
  databases: TemplateDatabase[];
  inputs: TemplateInput[];
  secrets: TemplateSecret[];
  versions?: TemplateVersions;
  deprecated: boolean;
}

interface Template extends TemplateManifest {
  dockerComposeContent: string;
}

interface TemplateSourceData {
  url: string;
  ref: string;
  enabled: boolean;
  lastSyncedAt?: Date;
  lastError?: string;
  templateCount: number;
  commit?: string;
  pendingCommit?: string;
  pendingTemplateCount?: number;
  pendingSyncedAt?: Date;
}

type TemplateSource = BaseDocument<TemplateSourceData>;
