import { rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import config from '../../config';
import { logInfo } from '../../utils/logger';
import type { CloneDTO } from './repositories.schema';

const root = resolve(config.workspacePath);

export type CloneResult = {
  workspace: string;
  path: string;
  commit: string;
  message: string;
  author: string;
  committedAt: string;
};

/** The workspace id is validated by Zod, and the resolved path is checked against the root anyway. */
const pathOf = (workspace: string) => {
  const target = resolve(root, workspace);

  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error(`Invalid workspace "${workspace}"`);
  }

  return target;
};

const run = async (args: string[], cwd?: string) => {
  const process = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    // Never let git stop waiting for credentials on a private repository.
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' },
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

/** Credentials travel inside the clone URL; they must never reach a log or an error message. */
const withoutCredentials = (message: string) => message.replace(/\/\/[^@\s/]+@/g, '//');

const runChecked = async (args: string[], description: string, cwd?: string) => {
  const result = await run(args, cwd);

  if (result.code !== 0) {
    throw new Error(`${description}: ${withoutCredentials(result.stderr || 'git failed')}`);
  }

  return result.stdout;
};

export const cloneRepository = async (request: CloneDTO): Promise<CloneResult> => {
  const path = pathOf(request.workspace);

  // A workspace is disposable: a leftover from a previous attempt must not affect this build.
  await rm(path, { recursive: true, force: true });

  const shallow = request.commit ? [] : ['--depth', '1'];

  await runChecked(
    ['clone', ...shallow, '--branch', request.branch, '--single-branch', request.url, path],
    `Failed to clone the ${request.branch} branch`,
  );

  if (request.commit) {
    await runChecked(['checkout', request.commit], `Failed to check out ${request.commit}`, path);
  }

  const [commit, message, author, committedAt] = (
    await runChecked(['log', '-1', '--format=%H%n%s%n%an%n%cI'], 'Failed to read the commit', path)
  ).split('\n');

  logInfo('Repository cloned', { workspace: request.workspace, branch: request.branch, commit });

  return {
    workspace: request.workspace,
    path,
    commit: commit ?? '',
    message: message ?? '',
    author: author ?? '',
    committedAt: committedAt ?? new Date().toISOString(),
  };
};

export const removeWorkspace = async (workspace: string) => {
  await rm(pathOf(workspace), { recursive: true, force: true });

  logInfo('Workspace removed', { workspace });
};

export const workspacePathOf = (workspace: string) => join(root, workspace);
