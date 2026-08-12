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

interface TemplateDatabase {
  service: string;
  engine: import('./template.schema').TemplateDatabaseEngine;
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
  deprecated: boolean;
}

interface Template extends TemplateManifest {
  dockerComposeContent: string;
}
