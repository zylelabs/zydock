<script setup lang="ts">
  import z from 'zod';

  type AuthResponse = { accessToken: string; refreshToken: string; user: ISessionUser };

  definePageMeta({
    layout: 'blank',
  });

  const api = useApi();
  const toast = useToast();
  const session = useSessionStore();

  const schema = z.object({
    email: z.email('Enter a valid email'),
    password: z.string().min(1, 'Enter the password'),
  });

  const form = useSchemaForm(
    schema,
    { email: '', password: '' },
    {
      onError: (message, error) => {
        console.error('Login failed:', error);
        toast.error({ title: 'Error', message });
      },
      onInvalid: (errors, lastError) => {
        console.warn('Form validation errors:', errors);
        toast.error({ title: 'Error', message: lastError });
      },
    },
  );

  const handleSubmit = form.submit(async data => {
    const response = await api.post<AuthResponse>('/auth/signin', { body: data, anonymous: true });

    session.start(
      { accessToken: response.accessToken, refreshToken: response.refreshToken },
      response.user,
    );

    await navigateTo('/');
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
    <Card title="Sign in" description="Sign in to your account to manage your deployments.">
      <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <Input
          v-model="form.values.email"
          label="Email"
          type="email"
          placeholder="you@company.com"
          :disabled="form.loading.value"
        />
        <Input
          v-model="form.values.password"
          label="Password"
          type="password"
          placeholder="••••••••"
          :disabled="form.loading.value"
        />
        <div class="flex justify-end">
          <NuxtLink to="/auth/forgot-password" class="text-xs text-primary hover:underline">
            Forgot your password?
          </NuxtLink>
        </div>
        <Button class="btn-primary" :disabled="form.loading.value">Sign In</Button>
        <p class="text-center text-sm text-content-muted">
          Don't have an account?
          <NuxtLink to="/auth/register" class="text-primary hover:underline"
            >Create account</NuxtLink
          >
        </p>
      </form>
    </Card>
  </div>
</template>
