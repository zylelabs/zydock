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

const pathOf = (workspace: string) => {
  const target = resolve(root, workspace);

  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error(`Invalid workspace "${workspace}"`);
  }

  return target;
};

export type CloneLogEntry = { stream: 'stdout' | 'stderr'; message: string };

const pump = async (
  readable: ReadableStream<Uint8Array>,
  stream: 'stdout' | 'stderr',
  onLog?: (entry: CloneLogEntry) => void,
) => {
  const decoder = new TextDecoder();

  let buffer = '';
  let full = '';

  for await (const chunk of readable) {
    const text = decoder.decode(chunk, { stream: true });

    full += text;
    buffer += text;

    const lines = buffer.split('\n');

    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line) {
        onLog?.({ stream, message: line });
      }
    }
  }

  if (buffer) {
    onLog?.({ stream, message: buffer });
  }

  return full;
};

const run = async (args: string[], cwd?: string, onLog?: (entry: CloneLogEntry) => void) => {
  const process = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' },
  });

  const [stdout, stderr, code] = await Promise.all([
    pump(process.stdout, 'stdout', onLog),
    pump(process.stderr, 'stderr', onLog),
    process.exited,
  ]);

  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

const withoutCredentials = (message: string) => message.replace(/\/\/[^@\s/]+@/g, '//');

const runChecked = async (
  args: string[],
  description: string,
  cwd?: string,
  onLog?: (entry: CloneLogEntry) => void,
) => {
  const result = await run(args, cwd, onLog);

  if (result.code !== 0) {
    throw new Error(`${description}: ${withoutCredentials(result.stderr || 'git failed')}`);
  }

  return result.stdout;
};

export const cloneRepository = async (
  request: CloneDTO,
  onLog?: (entry: CloneLogEntry) => void,
): Promise<CloneResult> => {
  const path = pathOf(request.workspace);

  await rm(path, { recursive: true, force: true });

  const shallow = request.commit ? [] : ['--depth', '1'];

  await runChecked(
    ['clone', ...shallow, '--branch', request.branch, '--single-branch', request.url, path],
    `Failed to clone the ${request.branch} branch`,
    undefined,
    onLog,
  );

  if (request.commit) {
    await runChecked(
      ['checkout', request.commit],
      `Failed to check out ${request.commit}`,
      path,
      onLog,
    );
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
