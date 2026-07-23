import type { ZodType } from 'zod';

/**
 * A form bound to a Zod schema that mirrors the API contract. Validation runs on submit; the field
 * errors come from the schema, and a top-level `formError` carries whatever message the API wrote
 * (already normalized by `useApi`). Reusable by every form of the interface.
 */
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

  /**
   * Wraps a submit handler: validates first (mapping the first issue of each field), then runs the
   * handler and turns a thrown API error into `formError`. Returns a listener for `@submit.prevent`.
   */
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
