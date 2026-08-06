<script setup lang="ts">
  import z from 'zod';

  definePageMeta({
    layout: 'blank',
  });

  useHead({ title: 'Reset password' });

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
  <div>
    <h1 class="text-[25px] font-semibold tracking-tight text-ink">
      {{
        done ? 'Password updated' : !token ? 'This link no longer works' : 'Choose a new password'
      }}
    </h1>
    <p v-if="!done && token" class="mt-1.75 mb-5.5 text-body text-pretty text-ink-2">
      Signing in elsewhere is unaffected until you revoke those sessions.
    </p>

    <Alert v-if="done" class="mt-5.5" theme="success">
      Password reset. You can now
      <NuxtLink to="/auth/login" class="underline">sign in</NuxtLink>.
    </Alert>

    <Alert v-else-if="!token" class="mt-5.5" theme="error">
      Invalid or incomplete link. Request a new one at
      <NuxtLink to="/auth/forgot-password" class="underline">reset password</NuxtLink>.
    </Alert>

    <form v-else @submit.prevent="handleSubmit">
      <Card rows>
        <Input
          v-model="form.values.password"
          stacked
          label="New password"
          type="password"
          placeholder="••••••••"
          :disabled="form.loading.value"
          :call-error="form.errors.value.password"
        />
        <Input
          v-model="form.values.confirm"
          stacked
          label="Confirm"
          type="password"
          placeholder="••••••••"
          :disabled="form.loading.value"
          :call-error="form.errors.value.confirm"
        />
      </Card>

      <Button theme="primary" type="submit" class="mt-4 w-full" :disabled="form.loading.value">
        <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
        Save password
      </Button>
    </form>

    <div v-if="!done" class="mt-4.5 flex flex-wrap gap-4 text-[13px]">
      <NuxtLink to="/auth/login" class="text-accent hover:underline">Back to sign in</NuxtLink>
    </div>
  </div>
</template>
