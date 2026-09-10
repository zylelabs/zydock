import type { Paginated } from '../useApi';
import type { Status } from '~/components/elements/StatusDot.vue';
import type { Template } from './useTemplates';

export type ApplicationStatus = 'created' | 'deploying' | 'running' | 'stopped' | 'failed';

export const applicationStatusDot = (status: ApplicationStatus): Status => {
  if (status === 'running') {
    return 'live';
  }

  if (status === 'stopped') {
    return 'stopped';
  }

  if (status === 'failed') {
    return 'failed';
  }

  return 'attn';
};

export type GitHost = 'github';
export type ApplicationGitSource = 'pat' | 'github-app';

export interface ApplicationGit {
  host: GitHost;
  repository: string;
  branch: string;
  dockerfilePath: string;
  buildContext: string;
  watchPaths?: string[];
  autoDeploy: boolean;
  injectBuildArgs: boolean;
  hasToken?: boolean;
  token?: string;
  hasWebhook?: boolean;
  webhookUrl?: string;
  source: ApplicationGitSource;
  gitSourceId?: string;
  installationId?: string;
}

export interface GitWebhook {
  id: string;
  url: string;
  events: string[];
}

export interface ApplicationVariable {
  key: string;
  value?: string;
  secret: boolean;
  build: boolean;
  buildSecret: boolean;
}

export interface ApplicationPortMapping {
  hostPort: number;
  containerPort: number;
  protocol: 'tcp' | 'udp';
}

export interface ApplicationVolume {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface ApplicationHealthcheck {
  path: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  startPeriodSeconds?: number;
}

export interface ApplicationResources {
  cpus?: number;
  memoryMb?: number;
}

export type ApplicationSource = 'git' | 'compose';

export type ApplicationExposeKind = 'http' | 'tcp' | 'udp';

export interface ApplicationComposeExpose {
  service: string;
  port: number;
  kind?: ApplicationExposeKind;
}

export interface ApplicationCompose {
  content: string;
  expose: ApplicationComposeExpose;
}

export interface ApplicationOrigin {
  templateId: string;
  templateVersion: number;
  inputs: Record<string, string>;
  composeHash?: string;
}

export type TemplateStatus = 'up-to-date' | 'update-available' | 'deprecated' | 'unknown';

export interface ApplicationVersion {
  key: string;
  current: string;
}

export interface ApplicationService {
  service: string;
  containerName: string;
  exposed: boolean;
  role: 'primary' | 'linked';
  image?: string;
  internalPort?: number;
  kind?: string;
  domain?: string;
}

export interface ApplicationServiceStatus {
  service: string;
  state: string;
  health: string;
  memoryUsedMb?: number;
  cpuPercent?: number;
}

export interface ApplicationReachability {
  hostPort: number;
  protocol: 'tcp' | 'udp';
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}

export type ComposeDiffLineType = 'context' | 'added' | 'removed';

export interface ComposeDiffLine {
  type: ComposeDiffLineType;
  content: string;
}

export interface TemplateUpdatePreview {
  status: TemplateStatus;
  installedVersion: number;
  availableVersion?: number;
  manuallyEdited: boolean;
  composeDiff?: ComposeDiffLine[];
  variables?: { added: string[]; removed: string[] };
  expose?: {
    changed: boolean;
    current: ApplicationComposeExpose;
    next: ApplicationComposeExpose & { domain: boolean };
  };
  databases?: {
    added: { service: string; engine: string }[];
    removed: { service: string; engine: string }[];
  };
}

export interface Application {
  id: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  serverId: string;
  name: string;
  slug: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  git?: ApplicationGit;
  compose?: ApplicationCompose;
  port?: number;
  portMappings?: ApplicationPortMapping[];
  variables: ApplicationVariable[];
  volumes?: ApplicationVolume[];
  networks?: string[];
  healthcheck?: ApplicationHealthcheck;
  resources?: ApplicationResources;
  restartPolicy: string;
  origin?: ApplicationOrigin;
  version?: ApplicationVersion;
  templateStatus?: TemplateStatus;
  lastError?: string;
  autoDomainDisabled: boolean;
  unconsumedBuildArgs?: string[];
  unconsumedBuildSecrets?: string[];
  createdAt: string;
  updatedAt: string;
}

export const applicationExposeKind = (application: Application): ApplicationExposeKind =>
  application.compose?.expose.kind ?? 'http';

export type CreateApplicationBody =
  | {
      source?: 'git';
      name: string;
      environmentId: string;
      serverId: string;
      git: Partial<ApplicationGit> & { repository: string };
      port: number;
    }
  | {
      source: 'compose';
      name: string;
      environmentId: string;
      serverId: string;
      compose: ApplicationCompose;
    };

export type ApplicationFilter = {
  projectId?: string;
  environmentId?: string;
  serverId?: string;
  size?: number;
};

export interface ApplicationVersionOption {
  value: string;
  label?: string;
  updatedAt?: string;
  origin?: 'catalog' | 'registry';
}

export const isVersionDowngrade = (
  available: ApplicationVersionOption[],
  current: string,
  next: string,
): boolean => {
  const currentIndex = available.findIndex(option => option.value === current);
  const nextIndex = available.findIndex(option => option.value === next);

  if (currentIndex === -1 || nextIndex === -1) {
    return false;
  }

  return nextIndex > currentIndex;
};

export type ApplicationVersionStatus =
  | { editable: false; reason: string }
  | { editable: true; key: string; current: string; options: ApplicationVersionOption[] };

export const applicationVersionStatus = (
  application: Application,
  template: Template | null,
  options?: ApplicationVersionOption[],
): ApplicationVersionStatus => {
  if (!application.origin?.templateId) {
    return {
      editable: false,
      reason: 'This application was not created from a marketplace template.',
    };
  }

  if (!template) {
    return {
      editable: false,
      reason: 'The template used to create this application is no longer in the catalog.',
    };
  }

  if (!template.versions) {
    return { editable: false, reason: 'This template does not declare selectable versions.' };
  }

  if (!application.version) {
    return { editable: false, reason: 'The running version could not be determined.' };
  }

  return {
    editable: true,
    key: template.versions.key,
    current: application.version.current,
    options: options ?? template.versions.available,
  };
};

export const useApplications = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/applications`;

  const list = (filter: ApplicationFilter = {}) =>
    api.get<Paginated<Application>>(base(), { query: { size: 100, ...filter } });
  const get = (applicationId: string) =>
    api.get<{ application: Application }>(`${base()}/${applicationId}`);
  const create = (body: CreateApplicationBody) =>
    api.post<{ application: Application }>(base(), { body });
  const update = (applicationId: string, body: Record<string, unknown>) =>
    api.patch<{ application: Application }>(`${base()}/${applicationId}`, { body });
  const remove = (applicationId: string) =>
    api.del<{ message: string }>(`${base()}/${applicationId}`);

  const listVariables = (applicationId: string) =>
    api.get<{ variables: ApplicationVariable[] }>(`${base()}/${applicationId}/variables`);
  const replaceVariables = (applicationId: string, variables: ApplicationVariable[]) =>
    api.put<{ variables: ApplicationVariable[] }>(`${base()}/${applicationId}/variables`, {
      body: { variables },
    });

  const deploy = (applicationId: string, body: { branch?: string; commit?: string } = {}) =>
    api.post<{ deployment: { id: string } }>(`${base()}/${applicationId}/deploy`, { body });
  const rollback = (applicationId: string, deploymentId: string) =>
    api.post<{ deployment: { id: string } }>(`${base()}/${applicationId}/rollback`, {
      body: { deploymentId },
    });

  const changeVersion = (applicationId: string, body: { version: string; deployNow?: boolean }) =>
    api.post<{ application: Application; deployment?: { id: string } }>(
      `${base()}/${applicationId}/version`,
      { body },
    );

  const templateUpdatePreview = (applicationId: string) =>
    api.get<TemplateUpdatePreview>(`${base()}/${applicationId}/template-update`);

  const applyTemplateUpdate = (
    applicationId: string,
    body: { confirmOverwrite?: boolean; deployNow?: boolean; inputs?: Record<string, string> },
  ) =>
    api.post<{
      application: Application;
      deployment?: { id: string };
      versionFellBackToDefault: boolean;
    }>(`${base()}/${applicationId}/template-update`, { body });

  const restart = (applicationId: string) =>
    api.post<{ application: Application }>(`${base()}/${applicationId}/restart`);
  const stop = (applicationId: string) =>
    api.post<{ application: Application }>(`${base()}/${applicationId}/stop`);
  const start = (applicationId: string) =>
    api.post<{ application: Application }>(`${base()}/${applicationId}/start`);

  const configureWebhook = (applicationId: string) =>
    api.post<{ webhook: GitWebhook }>(`${base()}/${applicationId}/webhook`);
  const removeWebhook = (applicationId: string) =>
    api.del<{ message: string }>(`${base()}/${applicationId}/webhook`);

  const services = (applicationId: string) =>
    api.get<{ services: ApplicationService[]; networkName?: string }>(
      `${base()}/${applicationId}/services`,
    );
  const serviceStatus = (applicationId: string) =>
    api.get<{ services: ApplicationServiceStatus[]; degraded?: { reason: string } }>(
      `${base()}/${applicationId}/services/status`,
    );
  const restartService = (applicationId: string, service: string) =>
    api.post<{ message: string }>(`${base()}/${applicationId}/services/${service}/restart`);

  const reachability = (applicationId: string) =>
    api.get<{ mappings: ApplicationReachability[]; degraded?: { reason: string } }>(
      `${base()}/${applicationId}/reachability`,
    );

  return {
    list,
    get,
    create,
    update,
    remove,
    listVariables,
    replaceVariables,
    deploy,
    rollback,
    changeVersion,
    templateUpdatePreview,
    applyTemplateUpdate,
    restart,
    stop,
    start,
    configureWebhook,
    removeWebhook,
    services,
    serviceStatus,
    restartService,
    reachability,
  };
};
