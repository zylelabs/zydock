<script setup lang="ts">
  import { z } from 'zod';
  import type { ISessionUser } from '~/stores/session.store';

  definePageMeta({ layout: 'blank' });
  useHead({ title: 'Create account' });

  const api = useApi();
  const session = useSessionStore();

  const schema = z.object({
    name: z.string().trim().min(1, 'Enter a name').max(120, 'Name is too long'),
    email: z.email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters').max(128, 'Password is too long'),
  });

  const form = useForm(schema, { name: '', email: '', password: '' });

  type AuthResponse = { accessToken: string; refreshToken: string; user: ISessionUser };

  const onSubmit = form.submit(async data => {
    const result = await api.post<AuthResponse>('/auth/signup', { body: data, anonymous: true });

    session.start(
      { accessToken: result.accessToken, refreshToken: result.refreshToken },
      result.user,
    );

    await navigateTo('/');
  });
</script>

<template>
  <UiCard title="Create account" description="Start deploying your applications in minutes.">
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

      <UiInput
        v-model="form.values.name"
        label="Name"
        autocomplete="name"
        placeholder="Your name"
        :error="form.errors.value.name"
      />

      <UiInput
        v-model="form.values.email"
        label="Email"
        type="email"
        autocomplete="email"
        placeholder="you@company.com"
        :error="form.errors.value.email"
      />

      <UiInput
        v-model="form.values.password"
        label="Password"
        type="password"
        autocomplete="new-password"
        placeholder="••••••••"
        hint="At least 8 characters."
        :error="form.errors.value.password"
      />

      <UiButton type="submit" block :loading="form.submitting.value">Create account</UiButton>
    </form>

    <p class="mt-5 text-center text-sm text-content-muted">
      Already have an account?
      <NuxtLink to="/login" class="text-primary hover:underline">Sign in</NuxtLink>
    </p>
  </UiCard>
</template>
