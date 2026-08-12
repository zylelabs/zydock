import { logInfo } from '../../utils/logger';
import { runHealthSweep } from '../agent/monitor.service';
import type { AllowedCommand } from './commands.schema';

export type CommandResult = {
  name: AllowedCommand;
  exitCode: number;
  stdout: string;
  stderr: string;
};

const ARGV: Record<Exclude<AllowedCommand, 'agent.autoheal-sweep'>, string[]> = {
  'docker.version': ['docker', 'version', '--format', '{{.Server.Version}}'],
  'docker.info': ['docker', 'info', '--format', '{{json .}}'],
  'docker.prune': ['docker', 'system', 'prune', '--force'],
  'docker.compose-version': ['docker', 'compose', 'version', '--short'],
  'system.uptime': ['uptime'],
  'system.disk': ['df', '-h', '/'],
  'system.memory': ['free', '-m'],
};

const spawnAllowed = async (argv: string[]) => {
  const process = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { exitCode, stdout, stderr };
};

export const runAllowedCommand = async (name: AllowedCommand): Promise<CommandResult> => {
  logInfo('Running authorized command', { name });

  if (name === 'agent.autoheal-sweep') {
    const healed = await runHealthSweep();

    return { name, exitCode: 0, stdout: JSON.stringify({ healed }), stderr: '' };
  }

  return { name, ...(await spawnAllowed(ARGV[name])) };
};
