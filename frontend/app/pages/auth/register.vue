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

  const { data: bootstrapStatus } = useLazyAsyncData(
    'bootstrap-status',
    () => api.get<{ required: boolean }>('/bootstrap/status', { anonymous: true }),
    { server: false, default: () => ({ required: false }) },
  );

  const bootstrapRequired = computed(() => bootstrapStatus.value?.required ?? false);

  const normalizeBootstrapCode = (input: string) =>
    input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');

  const bootstrapCodePattern = /^[0-9A-HJ-KM-NP-TV-Z]{8}$/;

  const schema = z.object({
    name: z.string().trim().min(1, 'Enter a name').max(120, 'Name is too long'),
    email: z.email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters').max(128, 'Password is too long'),
    bootstrapCode: z
      .string()
      .trim()
      .transform(normalizeBootstrapCode)
      .pipe(
        z.string().regex(bootstrapCodePattern, 'Enter the eight-character code').or(z.literal('')),
      )
      .optional(),
  });

  const form = useSchemaForm(
    schema,
    { name: '', email: '', password: '', bootstrapCode: '' },
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

  watch(
    () => form.values.bootstrapCode,
    value => {
      const normalized = normalizeBootstrapCode(value ?? '');

      if (normalized !== value) {
        form.values.bootstrapCode = normalized;
      }
    },
  );

  const handleSubmit = form.submit(async data => {
    const response = await api.post<AuthResponse>('/auth/signup', {
      body: { ...data, bootstrapCode: data.bootstrapCode || undefined },
      anonymous: true,
    });

    session.start({ accessToken: response.accessToken }, response.user);

    await navigateTo('/');
  });
</script>

<template>
  <div>
    <h1 class="text-title text-ink">Create your account</h1>
    <p class="mt-1.75 mb-5.5 text-body text-pretty text-ink-2">
      {{
        bootstrapRequired
          ? 'This is the first account on this installation, and it will be the administrator.'
          : 'You land straight in the product. No email confirmation step.'
      }}
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
        <Input
          v-if="bootstrapRequired"
          v-model="form.values.bootstrapCode"
          stacked
          mono
          label="Installation code"
          placeholder="XXXXXXXX"
          :disabled="form.loading.value"
          :call-error="form.errors.value.bootstrapCode"
        />
      </Card>

      <p class="mt-2.25 text-caption text-ink-2">
        {{
          bootstrapRequired
            ? 'The installation code came from the installer output on the server.'
            : 'A personal organization is created for you. You can add others later.'
        }}
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
