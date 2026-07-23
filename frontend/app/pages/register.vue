<script setup lang="ts">
  import { z } from 'zod';
  import type { ISessionUser } from '~/stores/session.store';

  definePageMeta({ layout: 'blank' });
  useHead({ title: 'Criar conta' });

  const api = useApi();
  const session = useSessionStore();

  const schema = z.object({
    name: z.string().trim().min(1, 'Informe seu nome').max(120, 'Nome muito longo'),
    email: z.email('Informe um e-mail válido'),
    password: z
      .string()
      .min(8, 'A senha precisa de ao menos 8 caracteres')
      .max(128, 'Senha muito longa'),
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
  <UiCard title="Criar conta" description="Comece a implantar suas aplicações em minutos.">
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

      <UiInput
        v-model="form.values.name"
        label="Nome"
        autocomplete="name"
        placeholder="Seu nome"
        :error="form.errors.value.name"
      />

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
        autocomplete="new-password"
        placeholder="••••••••"
        hint="Ao menos 8 caracteres."
        :error="form.errors.value.password"
      />

      <UiButton type="submit" block :loading="form.submitting.value">Criar conta</UiButton>
    </form>

    <p class="mt-5 text-center text-sm text-content-muted">
      Já tem conta?
      <NuxtLink to="/login" class="text-primary hover:underline">Entrar</NuxtLink>
    </p>
  </UiCard>
</template>
