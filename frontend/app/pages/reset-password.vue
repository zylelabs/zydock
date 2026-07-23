<script setup lang="ts">
  import { z } from 'zod';

  definePageMeta({ layout: 'blank' });
  useHead({ title: 'Reset password' });

  const api = useApi();
  const route = useRoute();

  const token = computed(() => String(route.query.token ?? ''));

  const schema = z
    .object({
      password: z.string().min(8, 'At least 8 characters').max(128, 'Password is too long'),
      confirm: z.string(),
    })
    .refine(data => data.password === data.confirm, {
      path: ['confirm'],
      message: 'Passwords do not match',
    });

  const form = useForm(schema, { password: '', confirm: '' });
  const done = ref(false);

  const onSubmit = form.submit(async data => {
    await api.post('/auth/reset-password', {
      body: { token: token.value, password: data.password },
      anonymous: true,
    });

    done.value = true;
  });
</script>

<template>
  <UiCard title="Reset password" description="Choose a new password for your account.">
    <UiAlert v-if="done" variant="success">
      Password reset. You can now
      <NuxtLink to="/login" class="underline">sign in</NuxtLink>.
    </UiAlert>

    <UiAlert v-else-if="!token" variant="error">
      Invalid or incomplete link. Request a new one at
      <NuxtLink to="/forgot-password" class="underline">reset password</NuxtLink>.
    </UiAlert>

    <form v-else class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

      <UiInput
        v-model="form.values.password"
        label="New password"
        type="password"
        autocomplete="new-password"
        placeholder="••••••••"
        hint="At least 8 characters."
        :error="form.errors.value.password"
      />

      <UiInput
        v-model="form.values.confirm"
        label="Confirm password"
        type="password"
        autocomplete="new-password"
        placeholder="••••••••"
        :error="form.errors.value.confirm"
      />

      <UiButton type="submit" block :loading="form.submitting.value">Reset password</UiButton>
    </form>

    <p v-if="!done" class="mt-5 text-center text-sm text-content-muted">
      <NuxtLink to="/login" class="text-primary hover:underline">Back to sign in</NuxtLink>
    </p>
  </UiCard>
</template>
