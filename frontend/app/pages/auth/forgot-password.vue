<script setup lang="ts">
  import z from 'zod';

  definePageMeta({
    layout: 'blank',
  });

  useHead({ title: 'Reset password' });

  const api = useApi();
  const toast = useToast();

  const schema = z.object({
    email: z.email('Enter a valid email'),
  });

  const sent = ref(false);

  const form = useSchemaForm(
    schema,
    { email: '' },
    {
      onError: (message, error) => {
        console.error('Forgot password failed:', error);
        toast.error({ title: 'Error', message });
      },
      onInvalid: (errors, lastError) => {
        console.warn('Form validation errors:', errors);
        toast.error({ title: 'Error', message: lastError });
      },
    },
  );

  const handleSubmit = form.submit(async data => {
    await api.post('/auth/forgot-password', { body: data, anonymous: true });

    sent.value = true;
  });
</script>

<template>
  <div>
    <h1 class="text-title text-ink">
      {{ sent ? 'Check your email' : 'Reset your password' }}
    </h1>
    <p v-if="!sent" class="mt-1.75 mb-5.5 text-body text-pretty text-ink-2">
      We send a link that stays valid for one hour.
    </p>

    <Alert v-if="sent" class="mt-5.5" theme="success">
      If the email exists, we've sent a link to reset the password.
    </Alert>

    <form v-else @submit.prevent="handleSubmit">
      <Card rows>
        <Input
          v-model="form.values.email"
          stacked
          label="Email"
          type="email"
          placeholder="you@company.com"
          :disabled="form.loading.value"
          :call-error="form.errors.value.email"
        />
      </Card>

      <Button theme="primary" type="submit" class="mt-4 w-full" :disabled="form.loading.value">
        <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
        Send reset link
      </Button>
    </form>

    <div class="mt-4.5 flex flex-wrap gap-4 text-caption">
      <NuxtLink to="/auth/login" class="text-accent hover:underline">Back to sign in</NuxtLink>
    </div>
  </div>
</template>
