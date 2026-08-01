<script setup lang="ts">
  import z from 'zod';

  definePageMeta({
    layout: 'blank',
  });

  const api = useApi();
  const toast = useToast();
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

  const done = ref(false);

  const form = useSchemaForm(
    schema,
    { password: '', confirm: '' },
    {
      onError: (message, error) => {
        console.error('Reset password failed:', error);
        toast.error({ title: 'Error', message });
      },
      onInvalid: (errors, lastError) => {
        console.warn('Form validation errors:', errors);
        toast.error({ title: 'Error', message: lastError });
      },
    },
  );

  const handleSubmit = form.submit(async data => {
    await api.post('/auth/reset-password', {
      body: { token: token.value, password: data.password },
      anonymous: true,
    });

    done.value = true;
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
    <Card title="Reset password" description="Choose a new password for your account.">
      <Alert v-if="done" theme="success">
        Password reset. You can now
        <NuxtLink to="/auth/login" class="underline">sign in</NuxtLink>.
      </Alert>

      <Alert v-else-if="!token" theme="error">
        Invalid or incomplete link. Request a new one at
        <NuxtLink to="/auth/forgot-password" class="underline">reset password</NuxtLink>.
      </Alert>

      <form v-else class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <Input
          v-model="form.values.password"
          label="New password"
          type="password"
          placeholder="••••••••"
          :disabled="form.loading.value"
        />
        <Input
          v-model="form.values.confirm"
          label="Confirm password"
          type="password"
          placeholder="••••••••"
          :disabled="form.loading.value"
        />
        <Button class="btn-primary" :disabled="form.loading.value">Reset password</Button>
      </form>

      <p v-if="!done" class="mt-4 text-center text-sm text-content-muted">
        <NuxtLink to="/auth/login" class="text-primary hover:underline">Back to sign in</NuxtLink>
      </p>
    </Card>
  </div>
</template>
