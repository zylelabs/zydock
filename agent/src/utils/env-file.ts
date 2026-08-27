export const parseEnvFile = (contents: string): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf('=');

    if (separator === -1 || trimmed.startsWith('#')) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');

    if (key) {
      values[key] = value;
    }
  }

  return values;
};

export const readEnvFile = async (path: string): Promise<Record<string, string>> => {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return {};
  }

  return parseEnvFile(await file.text());
};
