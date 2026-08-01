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
    name: z.string().trim().min(1, 'Enter a name').max(120, 'Name is too long'),
    email: z.email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters').max(128, 'Password is too long'),
  });

  const form = useSchemaForm(
    schema,
    { name: '', email: '', password: '' },
    {
      onError: (message, error) => {
        console.error('Registration failed:', error);
        toast.error({ title: 'Error', message });
      },
      onInvalid: (errors, lastError) => {
        console.warn('Form validation errors:', errors);
        toast.error({ title: 'Error', message: lastError });
      },
    },
  );

  const handleSubmit = form.submit(async data => {
    const response = await api.post<AuthResponse>('/auth/signup', { body: data, anonymous: true });

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
    <Card title="Create account" description="Start deploying your applications in minutes.">
      <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <Input
          v-model="form.values.name"
          label="Name"
          placeholder="Your name"
          :disabled="form.loading.value"
        />
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
        <Button class="btn-primary" :disabled="form.loading.value">Create account</Button>
        <p class="text-center text-sm text-content-muted">
          Already have an account?
          <NuxtLink to="/auth/login" class="text-primary hover:underline">Sign in</NuxtLink>
        </p>
      </form>
    </Card>
  </div>
</template>
