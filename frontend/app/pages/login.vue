<script setup lang="ts">
  import { z } from 'zod';
  import type { ISessionUser } from '~/stores/session.store';

  definePageMeta({ layout: 'blank' });
  useHead({ title: 'Entrar' });

  const api = useApi();
  const session = useSessionStore();

  const schema = z.object({
    email: z.email('Informe um e-mail válido'),
    password: z.string().min(1, 'Informe a senha'),
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
  <UiCard title="Entrar" description="Acesse sua conta para gerenciar seus deploys.">
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

      <UiInput
        v-model="form.values.email"
        label="E-mail"
        type="email"
        autocomplete="email"
        placeholder="voce@empresa.com"
        :error="form.errors.value.email"
      />

      <UiInput
        v-model="form.values.password"
        label="Senha"
        type="password"
        autocomplete="current-password"
        placeholder="••••••••"
        :error="form.errors.value.password"
      />

      <div class="flex justify-end">
        <NuxtLink to="/forgot-password" class="text-xs text-primary hover:underline">
          Esqueceu a senha?
        </NuxtLink>
      </div>

      <UiButton type="submit" block :loading="form.submitting.value">Entrar</UiButton>
    </form>

    <p class="mt-5 text-center text-sm text-content-muted">
      Não tem conta?
      <NuxtLink to="/register" class="text-primary hover:underline">Criar conta</NuxtLink>
    </p>
  </UiCard>
</template>
