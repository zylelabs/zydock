<script setup lang="ts">
  import type { Status } from '~/components/elements/StatusDot.vue';
  import type { Application, ApplicationExposeKind } from '~/composables/services/useApplications';
  import { useApplications } from '~/composables/services/useApplications';
  import { useServers } from '~/composables/services/useServers';

  const props = defineProps<{
    application: Application;
    canManage: boolean;
    exposeKind: ApplicationExposeKind;
  }>();
  const emit = defineEmits<{ refresh: [] }>();

  const serversApi = useServers();
  const applicationsApi = useApplications();

  const isHttp = computed(() => props.exposeKind === 'http');

  const { data: server } = useLazyAsyncData(
    () => `application-${props.application.id}-network-server`,
    async () => {
      const { server: item } = await serversApi.get(props.application.serverId);

      return item;
    },
    { server: false, watch: [() => props.application.serverId], default: () => null },
  );

  const portMappings = computed(() => props.application.portMappings ?? []);

  const endpointsTitle = computed(() => (isHttp.value ? 'Reachable without a domain' : 'Endpoint'));

  const { data: reachability } = useLazyAsyncData(
    () => `application-${props.application.id}-reachability`,
    async () => {
      const { mappings } = await applicationsApi.reachability(props.application.id);

      return mappings;
    },
    {
      server: false,
      watch: [() => props.application.id],
      default: () => [],
      immediate: portMappings.value.length > 0,
    },
  );

  type ReachabilityStatus = 'responding' | 'blocked' | 'unreachable';

  const STATUS_META: Record<ReachabilityStatus, { dot: Status; label: string }> = {
    responding: { dot: 'live', label: 'Responding' },
    blocked: {
      dot: 'attn',
      label: 'Port open on the host, blocked from outside — check the provider firewall',
    },
    unreachable: { dot: 'failed', label: 'Nothing listening' },
  };

  const statusOf = (hostPort: number, protocol: string): ReachabilityStatus | null => {
    const result = reachability.value?.find(
      entry => entry.hostPort === hostPort && entry.protocol === protocol,
    );

    if (!result) {
      return null;
    }

    if (!result.reachable) {
      return 'unreachable';
    }

    return props.application.status === 'running' ? 'responding' : 'blocked';
  };

  const endpoints = computed(() => {
    const host = server.value?.publicIp;

    if (!host) {
      return [];
    }

    return portMappings.value.map(mapping => ({
      label: `${host}:${mapping.hostPort}`,
      protocol: mapping.protocol,
      status: statusOf(mapping.hostPort, mapping.protocol),
    }));
  });

  const copiedEndpoint = ref('');

  const copyEndpoint = async (label: string) => {
    await navigator.clipboard.writeText(label);
    copiedEndpoint.value = label;
    setTimeout(() => {
      if (copiedEndpoint.value === label) {
        copiedEndpoint.value = '';
      }
    }, 2000);
  };
</script>

<template>
  <div class="flex max-w-205 flex-col gap-4.5">
    <DomainsCard v-if="isHttp" :application-id="application.id" :can-manage="canManage" />
    <p v-else class="text-caption text-ink-2">
      Domains route requests through the HTTP proxy. This application is reached over
      {{ exposeKind.toUpperCase() }}, which never goes through the proxy.
    </p>

    <Card v-if="endpoints.length" :title="endpointsTitle" content-class="p-0">
      <Row
        v-for="endpoint in endpoints"
        :key="endpoint.label"
        as="div"
        class="flex items-center gap-3"
      >
        <span class="font-mono text-caption text-ink">{{ endpoint.label }}</span>
        <button
          type="button"
          title="Copy"
          class="cursor-pointer rounded-control p-1 text-ink-2 hover:bg-inset hover:text-ink"
          @click="copyEndpoint(endpoint.label)"
        >
          <Icon
            :name="copiedEndpoint === endpoint.label ? 'lucide:check' : 'lucide:copy'"
            class="size-3.5"
          />
        </button>
        <Tag>{{ endpoint.protocol }}</Tag>
        <StatusDot
          v-if="endpoint.status"
          :status="STATUS_META[endpoint.status].dot"
          :title="STATUS_META[endpoint.status].label"
        />
      </Row>
    </Card>

    <template v-if="application.source === 'git'">
      <PortsCard :application="application" :can-manage="canManage" @refresh="emit('refresh')" />
      <NetworksCard :application="application" :can-manage="canManage" @refresh="emit('refresh')" />
    </template>
    <p v-else class="text-caption text-ink-2">
      Ports and networks come from the compose file — see the Compose tab.
    </p>
  </div>
</template>
