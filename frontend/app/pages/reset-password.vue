<script setup lang="ts">
  import { z } from 'zod';

  definePageMeta({ layout: 'blank' });
  useHead({ title: 'Redefinir senha' });

  const api = useApi();
  const route = useRoute();

  const token = computed(() => String(route.query.token ?? ''));

  const schema = z
    .object({
      password: z
        .string()
        .min(8, 'A senha precisa de ao menos 8 caracteres')
        .max(128, 'Senha muito longa'),
      confirm: z.string(),
    })
    .refine(data => data.password === data.confirm, {
      path: ['confirm'],
      message: 'As senhas não coincidem',
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
  <UiCard title="Redefinir senha" description="Escolha uma nova senha para sua conta.">
    <UiAlert v-if="done" variant="success">
      Senha redefinida. Agora você já pode
      <NuxtLink to="/login" class="underline">entrar</NuxtLink>.
    </UiAlert>

    <UiAlert v-else-if="!token" variant="error">
      Link inválido ou incompleto. Solicite um novo em
      <NuxtLink to="/forgot-password" class="underline">recuperar senha</NuxtLink>.
    </UiAlert>

    <form v-else class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

      <UiInput
        v-model="form.values.password"
        label="Nova senha"
        type="password"
        autocomplete="new-password"
        placeholder="••••••••"
        hint="Ao menos 8 caracteres."
        :error="form.errors.value.password"
      />

      <UiInput
        v-model="form.values.confirm"
        label="Confirmar senha"
        type="password"
        autocomplete="new-password"
        placeholder="••••••••"
        :error="form.errors.value.confirm"
      />

      <UiButton type="submit" block :loading="form.submitting.value">Redefinir senha</UiButton>
    </form>

    <p v-if="!done" class="mt-5 text-center text-sm text-content-muted">
      <NuxtLink to="/login" class="text-primary hover:underline">Voltar para entrar</NuxtLink>
    </p>
  </UiCard>
</template>
