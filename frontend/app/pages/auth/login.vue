<script setup lang="ts">
  import z from 'zod';

  type AuthResponse = { accessToken: string; user: ISessionUser };

  definePageMeta({
    layout: 'blank',
  });

  useHead({ title: 'Sign in' });

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

    session.start({ accessToken: response.accessToken }, response.user);

    await navigateTo('/');
  });
</script>

<template>
  <div>
    <h1 class="text-title text-ink">Sign in</h1>
    <p class="mt-1.75 mb-5.5 text-body text-pretty text-ink-2">
      Deployments, servers and logs for your organizations.
    </p>

    <form @submit.prevent="handleSubmit">
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
        <Input
          v-model="form.values.password"
          stacked
          label="Password"
          type="password"
          placeholder="••••••••"
          :disabled="form.loading.value"
          :call-error="form.errors.value.password"
        />
      </Card>

      <Button theme="primary" type="submit" class="mt-4 w-full" :disabled="form.loading.value">
        <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
        Sign in
      </Button>
    </form>

    <div class="mt-4.5 flex flex-wrap gap-4 text-caption">
      <NuxtLink to="/auth/forgot-password" class="text-accent hover:underline">
        Forgot your password?
      </NuxtLink>
      <NuxtLink to="/auth/register" class="text-accent hover:underline">Create account</NuxtLink>
    </div>
  </div>
</template>
