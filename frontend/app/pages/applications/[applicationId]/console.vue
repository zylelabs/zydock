<script setup lang="ts">
  import { applicationExposeKind, useApplications } from '~/composables/services/useApplications';
  import { useContainers } from '~/composables/services/useContainers';
  import { useDeployments } from '~/composables/services/useDeployments';
  import { useServers } from '~/composables/services/useServers';

  const route = useRoute();
  const session = useSessionStore();

  const applications = useApplications();
  const deployments = useDeployments();
  const servers = useServers();
  const containers = useContainers();

  const applicationId = computed(() => String(route.params.applicationId));
  const selectedService = ref('');
  const mode = ref<'shell' | 'attach'>('shell');

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
          exposeKind: applicationExposeKind(app.application),
          services,
        };
      }

      const deps = await deployments.list({ applicationId: applicationId.value });
      const containerId = deps.items.find(deployment => deployment.containerId)?.containerId;

      return {
        name: app.application.name,
        serverId: app.application.serverId,
        serverName: server.server.name,
        exposeKind: applicationExposeKind(app.application),
        containerId,
        services: [],
      };
    },
    { server: false, watch: [() => session.organizationId, applicationId], default: () => null },
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

  const { data: container } = useLazyAsyncData(
    () => `console-container-${containerId.value}`,
    async () => {
      if (!data.value || !containerId.value) {
        return null;
      }

      return containers.get(data.value.serverId, containerId.value);
    },
    { server: false, watch: [containerId], default: () => null },
  );

  const canAttach = computed(() => container.value?.stdinOpen ?? false);
  const exposeKind = computed(() => data.value?.exposeKind);
  const modeInitialized = ref(false);

  watch(
    [canAttach, exposeKind],
    ([allowed, kind]) => {
      if (!allowed) {
        mode.value = 'shell';
        return;
      }

      if (!modeInitialized.value && kind !== undefined) {
        modeInitialized.value = true;
        mode.value = kind !== 'http' ? 'attach' : 'shell';
      }
    },
    { immediate: true },
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
    <div v-if="data && containerId" class="flex flex-col gap-2.5">
      <div class="inline-flex w-fit rounded-[10px] bg-hairline p-0.75">
        <button
          type="button"
          class="cursor-pointer rounded-[7px] px-3.5 py-1.5 text-center text-caption font-medium whitespace-nowrap transition-colors"
          :class="mode === 'shell' ? 'bg-card text-ink shadow-lifted' : 'text-ink-2 hover:text-ink'"
          @click="mode = 'shell'"
        >
          Shell
        </button>
        <button
          type="button"
          :disabled="!canAttach"
          :title="
            canAttach
              ? 'Attach to the main process (PID 1)'
              : 'Container was not started with stdin_open: true'
          "
          class="rounded-[7px] px-3.5 py-1.5 text-center text-caption font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          :class="[
            mode === 'attach' ? 'bg-card text-ink shadow-lifted' : 'text-ink-2 hover:text-ink',
            canAttach ? 'cursor-pointer' : '',
          ]"
          @click="canAttach && (mode = 'attach')"
        >
          Attach
        </button>
      </div>

      <Terminal
        :key="`${containerId}-${mode}`"
        :server-id="data.serverId"
        :container-id="containerId"
        :mode="mode"
        :application-id="applicationId"
        :replay="mode === 'attach'"
        host-class="min-h-85"
      />
      <p class="text-caption text-ink-2">
        <template v-if="mode === 'attach'">
          Attached to the container's main process on {{ data.serverName }}. Closing this page
          detaches the session — it does not stop the process.
        </template>
        <template v-else>
          Session runs inside the container on {{ data.serverName }}. It closes when you leave the
          page.
        </template>
      </p>
    </div>

    <EmptyState
      v-else-if="data"
      variant="action"
      title="No running container"
      description="Run a successful deployment to open a console on the application's container."
    />

    <div v-else class="flex flex-col gap-2.5">
      <Skeleton class="h-9 max-w-60" />
      <Skeleton class="h-85 rounded-card" />
    </div>
  </Content>
</template>
