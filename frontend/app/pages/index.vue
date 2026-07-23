<script setup lang="ts">
  type Health = {
    status: string;
    dependencies: Record<string, { status: string }>;
  };

  useHead({ title: 'Overview' });

  const api = useApi();

  // Proves the whole path on the first render: browser → Nitro proxy → API.
  const { data: health, error } = await useAsyncData('health', () =>
    api.get<Health>('/health', { anonymous: true }),
  );
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header>
      <h1>Overview</h1>
      <p class="mt-1 text-sm text-content-muted">
        Deployment platform. The screens for each section arrive in the next blocks of Phase 16.
      </p>
    </header>

    <div class="rounded-xl border border-surface-border bg-surface-raised p-5">
      <div class="mb-4 flex items-center gap-2">
        <Icon name="lucide:heart-pulse" class="size-5 text-primary" />
        <h3>API status</h3>
      </div>

      <p v-if="error" class="text-sm text-danger">The API did not respond.</p>

      <div v-else class="space-y-2 text-sm">
        <p class="flex items-center justify-between">
          <span class="text-content-muted">API</span>
          <span class="font-medium text-success">{{ health?.status }}</span>
        </p>
        <p
          v-for="(dependency, name) in health?.dependencies"
          :key="name"
          class="flex items-center justify-between"
        >
          <span class="text-content-muted">{{ name }}</span>
          <span class="font-medium">{{ dependency.status }}</span>
        </p>
      </div>
    </div>
  </section>
</template>
