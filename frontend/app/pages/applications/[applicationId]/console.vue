<script setup lang="ts">
  useHead({ title: 'Console' });

  const route = useRoute();
  const session = useSessionStore();
  const applicationId = computed(() => String(route.params.applicationId));

  const applications = useApplications();
  const deployments = useDeployments();

  const { data } = await useAsyncData(
    () => `console-${applicationId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [app, deps] = await Promise.all([
        applications.get(applicationId.value),
        deployments.list({ applicationId: applicationId.value }),
      ]);

      // The running container is the one of the most recent deploy that produced one.
      const containerId = deps.items.find(deployment => deployment.containerId)?.containerId;

      return { serverId: app.application.serverId, containerId };
    },
    { server: false, watch: [() => session.organizationId, applicationId] },
  );
</script>

<template>
  <section class="mx-auto flex max-w-5xl flex-col gap-4">
    <NuxtLink
      :to="`/applications/${applicationId}`"
      class="flex items-center gap-1 text-sm text-content-muted hover:text-content"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Aplicação
    </NuxtLink>

    <h1>Console</h1>

    <TerminalConsole
      v-if="data?.containerId"
      :server-id="data.serverId"
      :container-id="data.containerId"
    />

    <UiCard v-else-if="data" title="Nenhum container em execução">
      <p class="text-sm text-content-muted">
        Faça um deploy bem-sucedido para abrir um console no container da aplicação.
      </p>
    </UiCard>

    <p v-else class="text-sm text-content-muted">Carregando…</p>
  </section>
</template>
