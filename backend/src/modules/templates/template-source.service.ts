import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import config from '../../config';
import { errorMessage } from '../../utils';
import { logInfo, logWarn } from '../../utils/logger';
import {
  catalogCollisions,
  refreshComposedCatalog,
  sourceCacheDirOf,
  validateCatalogDirectory,
} from './catalog.service';
import templateSourceModel from './template-source.model';
import type { CreateTemplateSourceDTO } from './template-source.schema';

const withoutCredentials = (message: string) => message.replace(/\/\/[^@\s/]+@/g, '//');

const runGit = async (
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stderr: string }> => {
  const process = Bun.spawn(['git', ...args], {
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' },
  });

  const timer = setTimeout(() => process.kill(), timeoutMs);

  try {
    const [stderr, code] = await Promise.all([
      new Response(process.stderr).text(),
      process.exited,
    ]);

    return { code, stderr: stderr.trim() };
  } finally {
    clearTimeout(timer);
  }
};

const cloneShallow = async (url: string, ref: string, targetDir: string): Promise<void> => {
  const { code, stderr } = await runGit(
    ['clone', '--depth', '1', '--branch', ref, '--single-branch', url, targetDir],
    config.templates.sourceCloneTimeoutMs,
  );

  if (code !== 0) {
    throw new Error(withoutCredentials(stderr) || 'git clone failed');
  }
};

const removeIfExists = (path: string) => rmSync(path, { recursive: true, force: true });

export const refreshCatalogFromSources = async (): Promise<void> => {
  const sources = await templateSourceModel
    .find({}, { enabled: 1 })
    .sort({ createdAt: 1 })
    .lean();

  refreshComposedCatalog(sources.map(source => ({ id: String(source._id), enabled: source.enabled })));
};

export const bootstrapTemplateSources = async (): Promise<void> => {
  try {
    await refreshCatalogFromSources();
  } catch (error) {
    logWarn('Could not load the external template sources cached on disk', {
      error: errorMessage(error),
    });
  }
};

export const listTemplateSources = (options: PaginateOptions) =>
  templateSourceModel.paginate({}, options);

export const findTemplateSourceById = (templateSourceId: string) =>
  templateSourceModel.findById(templateSourceId);

export const createTemplateSource = async (body: CreateTemplateSourceDTO) => {
  const source = await templateSourceModel.create({
    url: body.url,
    ref: body.ref,
    enabled: true,
    templateCount: 0,
  });

  await refreshCatalogFromSources();

  return source;
};

export const removeTemplateSource = async (templateSourceId: string): Promise<void> => {
  await templateSourceModel.deleteOne({ _id: templateSourceId });

  const dir = sourceCacheDirOf(templateSourceId);

  removeIfExists(dir);
  removeIfExists(`${dir}.tmp`);
  removeIfExists(`${dir}.old`);

  await refreshCatalogFromSources();
};

export const syncTemplateSource = async (templateSourceId: string): Promise<TemplateSource> => {
  const source = await templateSourceModel.findById(templateSourceId);

  if (!source) {
    throw new Error('Template source not found');
  }

  const finalDir = sourceCacheDirOf(templateSourceId);
  const tmpDir = `${finalDir}.tmp`;
  const backupDir = `${finalDir}.old`;

  mkdirSync(dirname(finalDir), { recursive: true });
  removeIfExists(tmpDir);
  removeIfExists(backupDir);

  try {
    await cloneShallow(source.url, source.ref, tmpDir);

    const templates = validateCatalogDirectory(tmpDir);

    if (existsSync(finalDir)) {
      renameSync(finalDir, backupDir);
    }

    renameSync(tmpDir, finalDir);
    removeIfExists(backupDir);

    await templateSourceModel.updateOne(
      { _id: templateSourceId },
      { $set: { templateCount: templates.length, lastSyncedAt: new Date() }, $unset: { lastError: '' } },
    );

    logInfo('Template source synced', {
      templateSourceId,
      url: source.url,
      templateCount: templates.length,
    });
  } catch (error) {
    removeIfExists(tmpDir);

    if (!existsSync(finalDir) && existsSync(backupDir)) {
      renameSync(backupDir, finalDir);
    } else {
      removeIfExists(backupDir);
    }

    const message = errorMessage(error);

    logWarn('Template source sync failed', { templateSourceId, url: source.url, error: message });

    await templateSourceModel.updateOne({ _id: templateSourceId }, { $set: { lastError: message } });
  }

  await refreshCatalogFromSources();

  return (await templateSourceModel.findById(templateSourceId))!;
};

export const serializeTemplateSource = (source: TemplateSource) => ({
  id: String(source._id),
  url: source.url,
  ref: source.ref,
  enabled: source.enabled,
  lastSyncedAt: source.lastSyncedAt,
  lastError: source.lastError,
  templateCount: source.templateCount,
  collisions: catalogCollisions().filter(
    collision => collision.sourceId === String(source._id),
  ),
  createdAt: source.createdAt,
});
