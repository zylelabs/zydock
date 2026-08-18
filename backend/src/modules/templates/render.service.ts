export type RenderTemplateAnswers = Record<string, string>;

export type RenderTemplateContext = {
  applicationSlug: string;
  serverHost: string;
  domain?: string;
};

export type RenderTemplateResult = {
  composeYaml: string;
  env: string;
};

const contextVariablesOf = (context: RenderTemplateContext): Record<string, string> => ({
  ZYDOCK_APPLICATION_SLUG: context.applicationSlug,
  ZYDOCK_SERVER_HOST: context.serverHost,
  ...(context.domain ? { ZYDOCK_DOMAIN: context.domain } : {}),
});

const assertAnswersAreDeclared = (template: TemplateManifest, answers: RenderTemplateAnswers) => {
  const declared = new Set([
    ...template.inputs.map(input => input.key),
    ...template.secrets.map(secret => secret.key),
    ...(template.versions ? [template.versions.key] : []),
  ]);

  for (const key of Object.keys(answers)) {
    if (!declared.has(key)) {
      throw new Error(
        `"${key}" is not declared in "inputs" or "secrets" of template "${template.id}"`,
      );
    }
  }
};

const throwInputError = (message: string, key: string): never => {
  const error = new Error(message) as Error & { field?: string };

  error.field = key;

  throw error;
};

const describeRange = (input: TemplateInput): string => {
  if (input.min !== undefined && input.max !== undefined) {
    return `between ${input.min} and ${input.max}`;
  }

  return input.min !== undefined ? `${input.min} or greater` : `${input.max} or lower`;
};

const assertInputValuesAreValid = (template: TemplateManifest, values: Record<string, string>) => {
  for (const input of template.inputs) {
    const value = values[input.key];

    if (input.required && value === undefined) {
      throwInputError(`"${input.label}" is required for template "${template.id}"`, input.key);
    }

    if (input.must_be_true && value !== 'true') {
      throwInputError(`"${input.label}" must be accepted to continue`, input.key);
    }

    if (value === undefined || value === '') {
      continue;
    }

    if (input.type === 'number' && (input.min !== undefined || input.max !== undefined)) {
      const numeric = Number(value);

      const outOfRange =
        !Number.isFinite(numeric) ||
        (input.min !== undefined && numeric < input.min) ||
        (input.max !== undefined && numeric > input.max);

      if (outOfRange) {
        throwInputError(`"${input.label}" must be ${describeRange(input)}`, input.key);
      }
    }

    if (input.type === 'text' && input.pattern && !new RegExp(input.pattern).test(value)) {
      throwInputError(`"${input.label}" has an invalid value`, input.key);
    }
  }

  for (const secret of template.secrets) {
    if (values[secret.key] === undefined) {
      throw new Error(`Secret "${secret.key}" is required for template "${template.id}"`);
    }
  }
};

export const parseEnvContent = (env: string): Array<{ key: string; value: string }> =>
  env
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const separator = line.indexOf('=');

      return { key: line.slice(0, separator), value: line.slice(separator + 1) };
    });

export const renderTemplate = (
  template: Template,
  answers: RenderTemplateAnswers,
  context: RenderTemplateContext,
): RenderTemplateResult => {
  assertAnswersAreDeclared(template, answers);

  const defaults = Object.fromEntries(
    template.inputs
      .filter(input => input.default !== undefined && answers[input.key] === undefined)
      .map(input => [input.key, String(input.default)]),
  );

  const values = { ...defaults, ...answers };

  assertInputValuesAreValid(template, values);

  const env = { ...values, ...contextVariablesOf(context) };

  return {
    composeYaml: template.dockerComposeContent,
    env: Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  };
};
