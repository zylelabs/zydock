<script setup lang="ts">
  import { z } from 'zod';

  definePageMeta({ layout: 'blank' });
  useHead({ title: 'Reset password' });

  const api = useApi();

  const schema = z.object({ email: z.email('Enter a valid email') });

  const form = useForm(schema, { email: '' });
  const sent = ref(false);

  const onSubmit = form.submit(async data => {
    await api.post('/auth/forgot-password', { body: data, anonymous: true });

    sent.value = true;
  });
</script>

<template>
  <UiCard title="Reset password" description="We'll send you a link to reset your password.">
    <UiAlert v-if="sent" variant="success">
      If the email exists, we've sent a link to reset the password.
    </UiAlert>

    <form v-else class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

      <UiInput
        v-model="form.values.email"
        label="Email"
        type="email"
        autocomplete="email"
        placeholder="you@company.com"
        :error="form.errors.value.email"
      />

      <UiButton type="submit" block :loading="form.submitting.value">Send link</UiButton>
    </form>

    <p class="mt-5 text-center text-sm text-content-muted">
      <NuxtLink to="/login" class="text-primary hover:underline">Back to sign in</NuxtLink>
    </p>
  </UiCard>
</template>
