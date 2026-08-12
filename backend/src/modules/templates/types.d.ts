interface TemplateInput {
  key: string;
  label: string;
  type: import('./template.schema').TemplateInputType;
  options?: string[];
  default?: string | number | boolean;
  required: boolean;
}

interface TemplateSecret {
  key: string;
  generate: import('./template.schema').TemplateSecretGenerator;
}

interface TemplateExpose {
  service: string;
  port: number;
  domain: boolean;
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

interface TemplateVersions {
  key: string;
  default: string;
  available: TemplateVersionEntry[];
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
  databases: TemplateDatabase[];
  inputs: TemplateInput[];
  secrets: TemplateSecret[];
  versions?: TemplateVersions;
  deprecated: boolean;
}

interface Template extends TemplateManifest {
  dockerComposeContent: string;
}
