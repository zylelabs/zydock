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
    const [stderr, code] = await Promise.all([new Response(process.stderr).text(), process.exited]);

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

const revParseHead = async (targetDir: string): Promise<string> => {
  const process = Bun.spawn(['git', '-C', targetDir, 'rev-parse', 'HEAD'], {
    stdout: 'pipe',
    stderr: 'ignore',
  });

  const [stdout, code] = await Promise.all([new Response(process.stdout).text(), process.exited]);

  if (code !== 0) {
    throw new Error('Could not read the cloned commit');
  }

  return stdout.trim();
};

const removeIfExists = (path: string) => rmSync(path, { recursive: true, force: true });

const swapIntoPlace = (finalDir: string, sourceDir: string) => {
  const backupDir = `${finalDir}.old`;

  removeIfExists(backupDir);

  if (existsSync(finalDir)) {
    renameSync(finalDir, backupDir);
  }

  renameSync(sourceDir, finalDir);
  removeIfExists(backupDir);
};

export const refreshCatalogFromSources = async (): Promise<void> => {
  const sources = await templateSourceModel.find({}, { enabled: 1 }).sort({ createdAt: 1 }).lean();

  refreshComposedCatalog(
    sources.map(source => ({ id: String(source._id), enabled: source.enabled })),
  );
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
  removeIfExists(`${dir}.pending`);

  await refreshCatalogFromSources();
};

export const syncTemplateSource = async (templateSourceId: string): Promise<TemplateSource> => {
  const source = await templateSourceModel.findById(templateSourceId);

  if (!source) {
    throw new Error('Template source not found');
  }

  const finalDir = sourceCacheDirOf(templateSourceId);
  const tmpDir = `${finalDir}.tmp`;
  const pendingDir = `${finalDir}.pending`;

  mkdirSync(dirname(finalDir), { recursive: true });
  removeIfExists(tmpDir);

  try {
    await cloneShallow(source.url, source.ref, tmpDir);

    const commit = await revParseHead(tmpDir);
    const templates = validateCatalogDirectory(tmpDir);

    if (!source.commit || commit === source.commit) {
      swapIntoPlace(finalDir, tmpDir);
      removeIfExists(pendingDir);

      await templateSourceModel.updateOne(
        { _id: templateSourceId },
        {
          $set: { templateCount: templates.length, commit, lastSyncedAt: new Date() },
          $unset: { lastError: '', pendingCommit: '', pendingTemplateCount: '', pendingSyncedAt: '' },
        },
      );

      logInfo('Template source synced', {
        templateSourceId,
        url: source.url,
        commit,
        templateCount: templates.length,
      });
    } else {
      removeIfExists(pendingDir);
      renameSync(tmpDir, pendingDir);

      await templateSourceModel.updateOne(
        { _id: templateSourceId },
        {
          $set: {
            pendingCommit: commit,
            pendingTemplateCount: templates.length,
            pendingSyncedAt: new Date(),
          },
          $unset: { lastError: '' },
        },
      );

      logInfo('Template source content changed: awaiting acceptance', {
        templateSourceId,
        url: source.url,
        previousCommit: source.commit,
        pendingCommit: commit,
      });
    }
  } catch (error) {
    removeIfExists(tmpDir);

    const message = errorMessage(error);

    logWarn('Template source sync failed', { templateSourceId, url: source.url, error: message });

    await templateSourceModel.updateOne(
      { _id: templateSourceId },
      { $set: { lastError: message } },
    );
  }

  await refreshCatalogFromSources();

  return (await templateSourceModel.findById(templateSourceId))!;
};

export const acceptTemplateSourceUpdate = async (
  templateSourceId: string,
): Promise<TemplateSource> => {
  const source = await templateSourceModel.findById(templateSourceId);

  if (!source) {
    throw new Error('Template source not found');
  }

  if (!source.pendingCommit) {
    throw new Error('This template source has no pending update to accept');
  }

  const finalDir = sourceCacheDirOf(templateSourceId);
  const pendingDir = `${finalDir}.pending`;

  if (!existsSync(pendingDir)) {
    throw new Error('The pending update is no longer cached on disk: sync the source again');
  }

  swapIntoPlace(finalDir, pendingDir);

  await templateSourceModel.updateOne(
    { _id: templateSourceId },
    {
      $set: { commit: source.pendingCommit, templateCount: source.pendingTemplateCount ?? 0 },
      $unset: { pendingCommit: '', pendingTemplateCount: '', pendingSyncedAt: '' },
    },
  );

  await refreshCatalogFromSources();

  logInfo('Template source update accepted', { templateSourceId, commit: source.pendingCommit });

  return (await templateSourceModel.findById(templateSourceId))!;
};

export const rejectTemplateSourceUpdate = async (
  templateSourceId: string,
): Promise<TemplateSource> => {
  const source = await templateSourceModel.findById(templateSourceId);

  if (!source) {
    throw new Error('Template source not found');
  }

  removeIfExists(`${sourceCacheDirOf(templateSourceId)}.pending`);

  await templateSourceModel.updateOne(
    { _id: templateSourceId },
    { $unset: { pendingCommit: '', pendingTemplateCount: '', pendingSyncedAt: '' } },
  );

  logInfo('Template source update rejected', { templateSourceId, commit: source.pendingCommit });

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
  commit: source.commit,
  pendingCommit: source.pendingCommit,
  pendingTemplateCount: source.pendingTemplateCount,
  pendingSyncedAt: source.pendingSyncedAt,
  collisions: catalogCollisions().filter(collision => collision.sourceId === String(source._id)),
  createdAt: source.createdAt,
});
