<script setup lang="ts">
  import { useApplications } from '~/composables/services/useApplications';
  import { useDeployments } from '~/composables/services/useDeployments';

  useHead({ title: 'Console' });

  const route = useRoute();
  const session = useSessionStore();

  const applications = useApplications();
  const deployments = useDeployments();

  const applicationId = computed(() => String(route.params.applicationId));

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

      const containerId = deps.items.find(deployment => deployment.containerId)?.containerId;

      return { serverId: app.application.serverId, containerId };
    },
    { server: false, watch: [() => session.organizationId, applicationId] },
  );
</script>

<template>
  <Content>
    <NuxtLink
      :to="`/applications/${applicationId}`"
      class="mb-4 inline-flex items-center gap-1 text-sm text-content-muted transition-colors hover:text-content-strong"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Application
    </NuxtLink>

    <Header title="Console" />

    <Terminal
      v-if="data?.containerId"
      :server-id="data.serverId"
      :container-id="data.containerId"
    />

    <Card v-else-if="data" title="No running container">
      <p class="text-sm text-content-muted">
        Run a successful deployment to open a console on the application's container.
      </p>
    </Card>

    <p v-else class="text-sm text-content-muted">Loading…</p>
  </Content>
</template>
