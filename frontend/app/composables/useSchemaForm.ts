import type { ZodType } from 'zod';

type FieldErrors<T> = Partial<Record<keyof T, string>>;

type SchemaFormOptions<T> = {
  onError?: (message: string, error: unknown) => void;
  onInvalid?: (errors: FieldErrors<T>, lastError: string) => void;
};

export const useSchemaForm = <T extends Record<string, unknown>>(
  schema: ZodType<T>,
  initial: T,
  options: SchemaFormOptions<T> = {},
) => {
  const values = reactive({ ...initial }) as T;
  const errors = ref<FieldErrors<T>>({});
  const formError = ref('');
  const loading = ref(false);

  const reset = () => {
    Object.assign(values, initial);
    errors.value = {};
    formError.value = '';
  };

  const submit = (handler: (data: T) => Promise<void> | void) => async () => {
    loading.value = true;
    errors.value = {};
    formError.value = '';

    const parsed = schema.safeParse(values);

    if (!parsed.success) {
      const fieldErrors: FieldErrors<T> = {};

      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof T | undefined;

        if (key && !fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }

      errors.value = fieldErrors;

      const messages = Object.values(fieldErrors) as string[];

      options.onInvalid?.(fieldErrors, messages[messages.length - 1] ?? '');

      loading.value = false;
      return;
    }

    try {
      await handler(parsed.data);
    } catch (error) {
      const message = (error as { message?: string }).message || 'Could not complete the request.';

      formError.value = message;
      options.onError?.(message, error);
    } finally {
      loading.value = false;
    }
  };

  return { values, errors, formError, loading, submit, reset };
};
