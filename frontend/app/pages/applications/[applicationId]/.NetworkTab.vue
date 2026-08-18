<script setup lang="ts">
  import type { Application } from '~/composables/services/useApplications';
  import { useDomains } from '~/composables/services/useDomains';
  import { useServers } from '~/composables/services/useServers';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const session = useSessionStore();
  const domainsApi = useDomains();
  const serversApi = useServers();

  const emptyDomains = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data: domainsData } = useLazyAsyncData(
    () => `application-${props.application.id}-network-domains`,
    () =>
      session.organizationId
        ? domainsApi.list({ applicationId: props.application.id })
        : Promise.resolve(emptyDomains),
    {
      server: false,
      watch: [() => session.organizationId, () => props.application.id],
      default: () => emptyDomains,
    },
  );

  const hasActiveDomain = computed(() => (domainsData.value?.items.length ?? 0) > 0);

  const { data: server } = useLazyAsyncData(
    () => `application-${props.application.id}-network-server`,
    async () => {
      const { server: item } = await serversApi.get(props.application.serverId);

      return item;
    },
    { server: false, watch: [() => props.application.serverId], default: () => null },
  );

  const portMappings = computed(() => props.application.portMappings ?? []);

  const endpoints = computed(() => {
    const host = server.value?.publicIp;

    if (!host || hasActiveDomain.value) {
      return [];
    }

    return portMappings.value.map(mapping => ({
      label: `${host}:${mapping.hostPort}`,
      protocol: mapping.protocol,
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
    <DomainsCard :application-id="application.id" :can-manage="canManage" />

    <Card v-if="endpoints.length" title="Reachable without a domain" content-class="p-0">
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
