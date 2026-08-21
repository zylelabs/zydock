<script setup lang="ts">
  import z from 'zod';

  type AuthResponse = { accessToken: string; user: ISessionUser };

  definePageMeta({
    layout: 'blank',
  });

  useHead({ title: 'Create account' });

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

    session.start({ accessToken: response.accessToken }, response.user);

    await navigateTo('/');
  });
</script>

<template>
  <div>
    <h1 class="text-title text-ink">Create your account</h1>
    <p class="mt-1.75 mb-5.5 text-body text-pretty text-ink-2">
      You land straight in the product. No email confirmation step.
    </p>

    <form @submit.prevent="handleSubmit">
      <Card rows>
        <Input
          v-model="form.values.name"
          stacked
          label="Name"
          placeholder="Your name"
          :disabled="form.loading.value"
          :call-error="form.errors.value.name"
        />
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

      <p class="mt-2.25 text-caption text-ink-2">
        A personal organization is created for you. You can add others later.
      </p>

      <Button theme="primary" type="submit" class="mt-4 w-full" :disabled="form.loading.value">
        <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
        Create account
      </Button>
    </form>

    <div class="mt-4.5 flex flex-wrap gap-4 text-caption">
      <NuxtLink to="/auth/login" class="text-accent hover:underline">
        I already have an account
      </NuxtLink>
    </div>
  </div>
</template>
