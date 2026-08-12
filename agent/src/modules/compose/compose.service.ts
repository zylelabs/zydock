import { chmod, mkdir, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import config from '../../config';
import { resolveComposeProvider, type ComposeProjectFiles } from '../../providers/compose';
import { logInfo } from '../../utils/logger';
import { COMPOSE_FILE_NAMES, type WriteComposeDTO } from './compose.schema';

const root = resolve(config.workspacePath, 'compose');

const compose = resolveComposeProvider();

const pathOf = (project: string) => {
  const target = resolve(root, project);

  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error(`Invalid project "${project}"`);
  }

  return target;
};

export const writeComposeProject = async (project: string, request: WriteComposeDTO) => {
  const path = pathOf(project);

  await mkdir(path, { recursive: true });

  for (const file of request.files) {
    const filePath = join(path, file.name);

    await Bun.write(filePath, file.content);

    if (file.name === '.env') {
      await chmod(filePath, 0o600);
    }
  }

  logInfo('Compose project written', { project, files: request.files.map(file => file.name) });

  return { project, path, files: request.files.map(file => file.name) };
};

const filesOf = async (project: string): Promise<{ path: string; files: ComposeProjectFiles }> => {
  const path = pathOf(project);
  const entries = await readdir(path).catch(() => []);

  if (!entries.length) {
    throw new Error(`Compose project "${project}" was not found`);
  }

  const present = new Set(entries);

  const composeFiles = COMPOSE_FILE_NAMES.filter(name => name !== '.env' && present.has(name)).map(
    name => join(path, name),
  );

  if (!composeFiles.length) {
    throw new Error(`Compose project "${project}" was not found`);
  }

  return {
    path,
    files: {
      composeFiles,
      envFile: present.has('.env') ? join(path, '.env') : undefined,
    },
  };
};

export const configComposeProject = async (project: string) => {
  const { path, files } = await filesOf(project);

  return compose.config(project, path, files);
};

export const pullComposeProject = async (
  project: string,
  onLog?: (entry: { stream: 'stdout' | 'stderr'; message: string }) => void,
) => {
  const { path, files } = await filesOf(project);

  await compose.pull(project, path, files, onLog);

  return { project };
};

export const upComposeProject = async (
  project: string,
  onLog?: (entry: { stream: 'stdout' | 'stderr'; message: string }) => void,
) => {
  const { path, files } = await filesOf(project);

  await compose.up(project, path, files, onLog);

  return { project };
};

export const downComposeProject = async (project: string, removeVolumes: boolean) => {
  const { path, files } = await filesOf(project);

  await compose.down(project, path, files, removeVolumes);
};

export const psComposeProject = async (project: string) => {
  const { path, files } = await filesOf(project);

  return compose.ps(project, path, files);
};

export const restartComposeProject = async (project: string, service?: string) => {
  const { path, files } = await filesOf(project);

  await compose.restart(project, path, files, service);
};

export const composeVersion = async () => compose.version();
