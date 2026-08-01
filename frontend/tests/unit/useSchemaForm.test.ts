import { describe, expect, test } from 'bun:test';
import { reactive, ref } from 'vue';
import { z } from 'zod';

Object.assign(globalThis, { reactive, ref });

const { useSchemaForm } = await import('../../app/composables/useSchemaForm');

describe('useSchemaForm', () => {
  const schema = z.object({
    email: z.email('invalid email'),
    password: z.string().min(8, 'too short'),
  });

  test('validation blocks submit and maps field errors', async () => {
    const form = useSchemaForm(schema, { email: 'nope', password: '123' });
    let ran = false;

    await form.submit(async () => {
      ran = true;
    })();

    expect(ran).toBeFalse();
    expect(form.errors.value.email).toBe('invalid email');
    expect(form.errors.value.password).toBe('too short');
  });

  test('valid data runs the handler and clears errors', async () => {
    const form = useSchemaForm(schema, { email: 'a@b.com', password: 'longenough' });
    let ran = false;

    await form.submit(async () => {
      ran = true;
    })();

    expect(ran).toBeTrue();
    expect(Object.keys(form.errors.value)).toHaveLength(0);
  });

  test('a thrown handler error becomes formError, loading resets', async () => {
    const form = useSchemaForm(schema, { email: 'a@b.com', password: 'longenough' });

    await form.submit(async () => {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    })();

    expect(form.formError.value).toBe('Invalid credentials');
    expect(form.loading.value).toBeFalse();
  });

  test('reset restores initial values and clears errors', async () => {
    const form = useSchemaForm(schema, { email: '', password: '' });
    form.values.email = 'changed@b.com';

    await form.submit(async () => undefined)();
    form.reset();

    expect(form.values.email).toBe('');
    expect(Object.keys(form.errors.value)).toHaveLength(0);
  });
});
