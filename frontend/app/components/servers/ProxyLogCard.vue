<script setup lang="ts">
  import {
    useContainers,
    type ContainerInfo,
    type ContainerLogEntry,
  } from '~/composables/services/useContainers';

  const props = defineProps<{ serverId: string }>();

  const PROXY_CONTAINER_NAME = 'zydock-proxy';

  const toast = useToast();
  const api = useContainers();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const proxyContainer = ref<ContainerInfo | null>(null);
  const logsOpen = ref(false);
  const logLines = ref<ContainerLogEntry[]>([]);
  const logsLoading = ref(false);

  const loadProxyContainer = async () => {
    try {
      const found = await api.list(props.serverId, { namePrefix: PROXY_CONTAINER_NAME });

      proxyContainer.value = found[0] ?? null;
    } catch {
      proxyContainer.value = null;
    }
  };

  watch(() => props.serverId, loadProxyContainer, { immediate: true });

  const toggleLogs = async () => {
    if (!proxyContainer.value) {
      return;
    }

    if (logsOpen.value) {
      logsOpen.value = false;
      return;
    }

    logsOpen.value = true;
    logsLoading.value = true;

    try {
      logLines.value = await api.logs(props.serverId, proxyContainer.value.id, 200);
    } catch (error) {
      logLines.value = [];
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to load the logs.') });
    } finally {
      logsLoading.value = false;
    }
  };
</script>

<template>
  <Card v-if="proxyContainer" title="Reverse proxy">
    <template #right>
      <div class="flex items-center gap-2">
        <Tag color="live">{{ proxyContainer.state }}</Tag>
        <Button theme="quiet" size="sm" @click="toggleLogs">
          {{ logsOpen ? 'Hide logs' : 'View logs' }}
        </Button>
      </div>
    </template>

    <p class="text-caption text-ink-2">
      Access log for every request routed through Caddy on this server — every domain and
      application share this stream.
    </p>

    <div v-if="logsOpen" class="mt-3 rounded-card border border-edge bg-inset p-3">
      <p v-if="logsLoading" class="text-caption text-ink-2">Loading…</p>
      <p v-else-if="!logLines.length" class="text-caption text-ink-2">No log lines.</p>
      <pre v-else class="max-h-64 overflow-y-auto font-mono text-xs leading-relaxed text-ink-2">{{
        logLines.map(line => line.message).join('\n')
      }}</pre>
    </div>
  </Card>
</template>
