<script setup lang="ts">
  type Health = {
    status: string;
    dependencies: Record<string, { status: string }>;
  };

  const api = useApi();

  // Proves the whole path on the first render: browser → Nitro proxy → API.
  const { data: health, error } = await useAsyncData('health', () =>
    api.get<Health>('/health', { anonymous: true }),
  );
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
    <h1>Zydock</h1>

    <p class="text-content-muted">
      Plataforma de deploy. A interface começa a ser construída na Fase 16.
    </p>

    <div class="rounded-lg border border-surface-border bg-surface-raised p-4 text-sm">
      <p v-if="error" class="text-danger">A API não respondeu.</p>

      <template v-else>
        <p>
          API: <span class="text-success">{{ health?.status }}</span>
        </p>
        <p
          v-for="(dependency, name) in health?.dependencies"
          :key="name"
          class="text-content-muted"
        >
          {{ name }}: {{ dependency.status }}
        </p>
      </template>
    </div>
  </main>
</template>
