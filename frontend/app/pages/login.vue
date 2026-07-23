<script setup lang="ts">
  import { z } from 'zod';
  import type { ISessionUser } from '~/stores/session.store';

  definePageMeta({ layout: 'blank' });
  useHead({ title: 'Sign in' });

  const api = useApi();
  const session = useSessionStore();

  const schema = z.object({
    email: z.email('Enter a valid email'),
    password: z.string().min(1, 'Enter the password'),
  });

  const form = useForm(schema, { email: '', password: '' });

  type AuthResponse = { accessToken: string; refreshToken: string; user: ISessionUser };

  const onSubmit = form.submit(async data => {
    const result = await api.post<AuthResponse>('/auth/signin', { body: data, anonymous: true });

    session.start(
      { accessToken: result.accessToken, refreshToken: result.refreshToken },
      result.user,
    );

    await navigateTo('/');
  });
</script>

<template>
  <UiCard title="Sign in" description="Sign in to your account to manage your deployments.">
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

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
        autocomplete="current-password"
        placeholder="••••••••"
        :error="form.errors.value.password"
      />

      <div class="flex justify-end">
        <NuxtLink to="/forgot-password" class="text-xs text-primary hover:underline">
          Forgot your password?
        </NuxtLink>
      </div>

      <UiButton type="submit" block :loading="form.submitting.value">Sign in</UiButton>
    </form>

    <p class="mt-5 text-center text-sm text-content-muted">
      Don't have an account?
      <NuxtLink to="/register" class="text-primary hover:underline">Create account</NuxtLink>
    </p>
  </UiCard>
</template>
