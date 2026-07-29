import type { ZodType } from 'zod';

export const useForm = <T extends Record<string, unknown>>(schema: ZodType<T>, initial: T) => {
  const values = reactive({ ...initial }) as T;
  const errors = ref<Partial<Record<keyof T, string>>>({});
  const formError = ref('');
  const submitting = ref(false);

  const reset = () => {
    Object.assign(values, initial);
    errors.value = {};
    formError.value = '';
  };

  const submit = (handler: (data: T) => Promise<void> | void) => async () => {
    errors.value = {};
    formError.value = '';

    const parsed = schema.safeParse(values);

    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof T, string>> = {};

      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof T | undefined;

        if (key && !fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }

      errors.value = fieldErrors;

      return;
    }

    submitting.value = true;

    try {
      await handler(parsed.data);
    } catch (error) {
      formError.value =
        (error as { message?: string }).message || 'Could not complete the request.';
    } finally {
      submitting.value = false;
    }
  };

  return { values, errors, formError, submitting, submit, reset };
};
