<script setup lang="ts">
  import z from 'zod';

  definePageMeta({
    layout: 'blank',
  });

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
  <div class="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
    <div class="flex items-center gap-3 select-none">
      <img src="@/assets/img/logo.svg" width="42" />
      <div class="border-l border-white/25 pl-3 my-auto flex flex-col">
        <div class="text-lg/tight text-white uppercase font-montserrat tracking-wider">ZyDock</div>
      </div>
    </div>
    <Card title="Reset password" description="We'll send you a link to reset your password.">
      <Alert v-if="sent" theme="success">
        If the email exists, we've sent a link to reset the password.
      </Alert>
      <form v-else class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <Input
          v-model="form.values.email"
          label="Email"
          type="email"
          placeholder="you@company.com"
          :disabled="form.loading.value"
        />
        <Button class="btn-primary" :disabled="form.loading.value">Send link</Button>
      </form>
      <p class="mt-4 text-center text-sm text-content-muted">
        <NuxtLink to="/auth/login" class="text-primary hover:underline">Back to sign in</NuxtLink>
      </p>
    </Card>
  </div>
</template>
