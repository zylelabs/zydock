import type { Paginated } from '../useApi';
import type { Application } from './useApplications';

export type TemplateInputType = 'text' | 'password' | 'number' | 'boolean' | 'select';
export type TemplateOrigin = 'official' | 'community';
export type TemplateDatabaseEngine = 'postgresql' | 'mysql' | 'mongodb' | 'redis';

export interface TemplateInput {
  key: string;
  label: string;
  type: TemplateInputType;
  options?: string[];
  default?: string | number | boolean;
  required: boolean;
}

export interface TemplateSecret {
  key: string;
  generate: 'password' | 'hex32' | 'uuid';
}

export interface TemplateExpose {
  service: string;
  port: number;
  domain: boolean;
}

export interface TemplateDatabase {
  service: string;
  engine: TemplateDatabaseEngine;
}

export interface Template {
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
  origin: TemplateOrigin;
  deprecated: boolean;
  expose: TemplateExpose;
  databases: TemplateDatabase[];
  inputs: TemplateInput[];
  secrets: TemplateSecret[];
}

export type TemplateFilter = {
  search?: string;
  category?: string;
  page?: number;
  size?: number;
};

export interface DeployTemplateBody {
  organizationId: string;
  name: string;
  environmentId: string;
  serverId: string;
  inputs: Record<string, string>;
  deployNow?: boolean;
}

export const useTemplates = () => {
  const api = useApi();

  const base = () => '/templates';

  const list = (filter: TemplateFilter = {}) =>
    api.get<Paginated<Template>>(base(), { query: { size: 100, ...filter } });
  const get = (templateId: string) => api.get<{ template: Template }>(`${base()}/${templateId}`);
  const deploy = (templateId: string, body: DeployTemplateBody) =>
    api.post<{ application: Application; deployment?: { id: string } }>(
      `${base()}/${templateId}/deploy`,
      { body },
    );

  return { list, get, deploy };
};
