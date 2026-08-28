export type DockerfileInstruction = {
  instruction: string;
  args: string;
  startLine: number;
  endLine: number;
};

export type DockerfileStage = {
  fromLine: number;
  endLine: number;
  declaredArgs: Set<string>;
};

const eolOf = (contents: string): string => (contents.includes('\r\n') ? '\r\n' : '\n');

export const parseDockerfile = (contents: string): DockerfileInstruction[] => {
  const lines = contents.split(/\r\n|\n/);
  const instructions: DockerfileInstruction[] = [];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      i += 1;
      continue;
    }

    const startLine = i;
    const parts: string[] = [];
    let endLine = i;

    while (/\\\s*$/.test(lines[endLine])) {
      parts.push(lines[endLine].replace(/\\\s*$/, '').trim());
      endLine += 1;

      if (endLine >= lines.length) {
        break;
      }
    }

    if (endLine < lines.length) {
      parts.push(lines[endLine].replace(/\\\s*$/, '').trim());
    }

    const combined = parts.join(' ').trim();
    const match = combined.match(/^(\S+)\s*(.*)$/s);

    if (match) {
      instructions.push({
        instruction: match[1].toUpperCase(),
        args: match[2].trim(),
        startLine,
        endLine,
      });
    }

    i = endLine + 1;
  }

  return instructions;
};

export const stagesOf = (instructions: DockerfileInstruction[]): DockerfileStage[] => {
  const stages: DockerfileStage[] = [];
  let current: DockerfileStage | null = null;

  for (const instruction of instructions) {
    if (instruction.instruction === 'FROM') {
      current = {
        fromLine: instruction.startLine,
        endLine: instruction.endLine,
        declaredArgs: new Set(),
      };
      stages.push(current);
      continue;
    }

    if (instruction.instruction === 'ARG' && current) {
      const name = instruction.args.split('=')[0]?.trim();

      if (name) {
        current.declaredArgs.add(name);
      }
    }
  }

  return stages;
};

export const undeclaredBuildArgs = (contents: string, keys: string[]): string[] => {
  const stages = stagesOf(parseDockerfile(contents));

  return keys.filter(key => !stages.some(stage => stage.declaredArgs.has(key)));
};

const hasSecretMount = (runArgs: string, id: string): boolean => {
  const tokens = runArgs.split(/\s+/);

  return tokens.some(token => {
    if (!token.startsWith('--mount=')) {
      return false;
    }

    const flags = token.slice('--mount='.length).split(',');
    return flags.includes('type=secret') && flags.includes(`id=${id}`);
  });
};

export const undeclaredBuildSecrets = (contents: string, ids: string[]): string[] => {
  const runs = parseDockerfile(contents).filter(instruction => instruction.instruction === 'RUN');

  return ids.filter(id => !runs.some(run => hasSecretMount(run.args, id)));
};

export const withInjectedArgs = (contents: string, keys: string[]): string => {
  const stages = stagesOf(parseDockerfile(contents));
  const insertions = new Map<number, string[]>();

  for (const stage of stages) {
    const missing = keys.filter(key => !stage.declaredArgs.has(key));

    if (missing.length > 0) {
      insertions.set(
        stage.endLine,
        missing.map(key => `ARG ${key}`),
      );
    }
  }

  if (insertions.size === 0) {
    return contents;
  }

  const eol = eolOf(contents);
  const lines = contents.split(/\r\n|\n/);
  const result: string[] = [];

  lines.forEach((line, index) => {
    result.push(line);

    const toInsert = insertions.get(index);
    if (toInsert) {
      result.push(...toInsert);
    }
  });

  return result.join(eol);
};
