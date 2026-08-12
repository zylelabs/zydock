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
  const selectedService = ref('');

  const { data } = useLazyAsyncData(
    () => `console-${applicationId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const app = await applications.get(applicationId.value);
      const server = await servers.get(app.application.serverId);

      if (app.application.source === 'compose') {
        const { services } = await applications.services(applicationId.value);

        selectedService.value =
          services.find(entry => entry.exposed)?.service ?? services[0]?.service ?? '';

        return {
          name: app.application.name,
          serverId: app.application.serverId,
          serverName: server.server.name,
          services,
        };
      }

      const deps = await deployments.list({ applicationId: applicationId.value });
      const containerId = deps.items.find(deployment => deployment.containerId)?.containerId;

      return {
        name: app.application.name,
        serverId: app.application.serverId,
        serverName: server.server.name,
        containerId,
        services: [],
      };
    },
    { server: false, watch: [() => session.organizationId, applicationId], default: () => null },
  );

  const serviceOptions = computed(
    () =>
      data.value?.services.map(entry => ({
        value: entry.service,
        label: entry.exposed ? `${entry.service} (exposed)` : entry.service,
      })) ?? [],
  );

  const containerId = computed(() => {
    if (!data.value) {
      return undefined;
    }

    if (data.value.services.length) {
      return data.value.services.find(entry => entry.service === selectedService.value)
        ?.containerName;
    }

    return data.value.containerId;
  });

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
    <div v-if="data && containerId" class="flex flex-col gap-2.5">
      <Select
        v-if="serviceOptions.length > 1"
        v-model="selectedService"
        label="Service"
        :options="serviceOptions"
        boxed
        class="max-w-60"
      />
      <Terminal
        :key="containerId"
        :server-id="data.serverId"
        :container-id="containerId"
        host-class="min-h-85"
      />
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
