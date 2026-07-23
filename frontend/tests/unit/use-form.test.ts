import { describe, expect, test } from 'bun:test';
import { reactive, ref } from 'vue';
import { z } from 'zod';

// `useForm` relies on Nuxt auto-imports (`reactive`, `ref`) — free identifiers at runtime. Defining
// them on the global scope lets the real composable file run unchanged, with no copy.
Object.assign(globalThis, { reactive, ref });

const { useForm } = await import('../../app/composables/use-form');

describe('useForm', () => {
  const schema = z.object({
    email: z.email('invalid email'),
    password: z.string().min(8, 'too short'),
  });

  test('validation blocks submit and maps field errors', async () => {
    const form = useForm(schema, { email: 'nope', password: '123' });
    let ran = false;

    await form.submit(async () => {
      ran = true;
    })();

    expect(ran).toBeFalse();
    expect(form.errors.value.email).toBe('invalid email');
    expect(form.errors.value.password).toBe('too short');
  });

  test('valid data runs the handler and clears errors', async () => {
    const form = useForm(schema, { email: 'a@b.com', password: 'longenough' });
    let ran = false;

    await form.submit(async () => {
      ran = true;
    })();

    expect(ran).toBeTrue();
    expect(Object.keys(form.errors.value)).toHaveLength(0);
  });

  test('a thrown handler error becomes formError, submitting resets', async () => {
    const form = useForm(schema, { email: 'a@b.com', password: 'longenough' });

    await form.submit(async () => {
      throw Object.assign(new Error('Credenciais inválidas'), { statusCode: 401 });
    })();

    expect(form.formError.value).toBe('Credenciais inválidas');
    expect(form.submitting.value).toBeFalse();
  });

  test('reset restores initial values and clears errors', async () => {
    const form = useForm(schema, { email: '', password: '' });
    form.values.email = 'changed@b.com';

    await form.submit(async () => undefined)();
    form.reset();

    expect(form.values.email).toBe('');
    expect(Object.keys(form.errors.value)).toHaveLength(0);
  });
});
