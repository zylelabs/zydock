<script setup lang="ts">
  import { useApplications } from '~/composables/services/useApplications';
  import { useDeployments } from '~/composables/services/useDeployments';
  import { useServers } from '~/composables/services/useServers';

  const route = useRoute();
  const session = useSessionStore();

  const applications = useApplications();
  const deployments = useDeployments();
  const servers = useServers();

  const applicationId = computed(() => String(route.params.applicationId));

  const { data } = useLazyAsyncData(
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
      const server = await servers.get(app.application.serverId);

      return {
        name: app.application.name,
        serverId: app.application.serverId,
        serverName: server.server.name,
        containerId,
      };
    },
    { server: false, watch: [() => session.organizationId, applicationId], default: () => null },
  );

  useHead(() => ({ title: `Console · ${data.value?.name ?? 'Application'}` }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'Console',
      context: data.value?.name,
      back: `/applications/${applicationId.value}`,
    });
  });
</script>

<template>
  <Content>
    <div v-if="data?.containerId" class="flex flex-col gap-2.5">
      <Terminal :server-id="data.serverId" :container-id="data.containerId" host-class="min-h-85" />
      <p class="text-caption text-ink-2">
        Session runs inside the container on {{ data.serverName }}. It closes when you leave the
        page.
      </p>
    </div>

    <EmptyState
      v-else-if="data"
      variant="action"
      title="No running container"
      description="Run a successful deployment to open a console on the application's container."
    />

    <p v-else class="text-caption text-ink-2">Loading…</p>
  </Content>
</template>
