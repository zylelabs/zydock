<script setup lang="ts">
  import {
    useContainers,
    APPLICATION_LABEL,
    CONTAINER_STATES,
    type ContainerInfo,
    type ContainerLogEntry,
    type ContainerState,
  } from '~/composables/services/useContainers';

  const props = defineProps<{ serverId: string; canManage: boolean }>();

  const toast = useToast();
  const api = useContainers();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const containers = ref<ContainerInfo[]>([]);
  const loading = ref(false);
  const stateFilter = ref<ContainerState | ''>('');
  const busy = ref('');

  const load = async () => {
    loading.value = true;

    try {
      containers.value = await api.list(props.serverId, { state: stateFilter.value || undefined });
    } catch (error) {
      containers.value = [];
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to list the containers.') });
    } finally {
      loading.value = false;
    }
  };

  watch(stateFilter, load, { immediate: true });

  const stateOptions = [
    { value: '', label: 'All states' },
    ...CONTAINER_STATES.map(state => ({ value: state, label: state })),
  ];

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'state', label: 'State' },
    { key: 'restartCount', label: 'Meta' },
    { key: 'id', label: '', class: 'text-right' },
  ];

  const ownerOf = (container: ContainerInfo) => container.labels?.[APPLICATION_LABEL];

  const handleAction = async (
    container: ContainerInfo,
    action: 'start' | 'stop' | 'restart' | 'remove',
  ) => {
    busy.value = `${container.id}:${action}`;

    try {
      if (action === 'remove') {
        await api.remove(props.serverId, container.id);
      } else {
        await api[action](props.serverId, container.id);
      }

      await load();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: messageOf(error, `Failed to ${action} the container.`),
      });
    } finally {
      busy.value = '';
    }
  };

  const logsFor = ref<ContainerInfo | null>(null);
  const logLines = ref<ContainerLogEntry[]>([]);
  const logsLoading = ref(false);

  const openLogs = async (container: ContainerInfo) => {
    logsFor.value = container;
    logsLoading.value = true;

    try {
      logLines.value = await api.logs(props.serverId, container.id, 200);
    } catch (error) {
      logLines.value = [];
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to load the logs.') });
    } finally {
      logsLoading.value = false;
    }
  };
</script>

<template>
  <div class="flex flex-col gap-3">
    <Select v-model="stateFilter" :options="stateOptions" class="w-44" boxed bare />

    <Table
      :columns="columns"
      :items="containers"
      grid-class="grid-cols-[1.4fr_0.6fr_1fr_auto]"
      :loading="loading"
      empty-label="No containers found."
    >
      <template #name="{ item }">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate font-mono text-[13px] text-ink">{{
            (item as unknown as ContainerInfo).name
          }}</span>
          <Tag v-if="ownerOf(item as unknown as ContainerInfo)">app-managed</Tag>
        </div>
      </template>

      <template #state="{ value }">
        <Tag :color="value === 'running' ? 'live' : value === 'exited' ? 'failed' : 'default'">
          {{ value }}
        </Tag>
      </template>

      <template #restartCount="{ item }">
        <span class="text-[12.5px] text-ink-2">
          restarts: {{ (item as unknown as ContainerInfo).restartCount }}
          <template v-if="(item as unknown as ContainerInfo).exitCode !== undefined">
            · exit {{ (item as unknown as ContainerInfo).exitCode }}
          </template>
        </span>
      </template>

      <template #id="{ item }">
        <div class="flex items-center justify-end gap-1.5">
          <Button theme="quiet" size="xs" @click="openLogs(item as unknown as ContainerInfo)"
            >Logs</Button
          >

          <template v-if="canManage">
            <Button
              v-if="(item as unknown as ContainerInfo).state !== 'running'"
              theme="secondary"
              size="xs"
              :disabled="busy === `${(item as unknown as ContainerInfo).id}:start`"
              @click="handleAction(item as unknown as ContainerInfo, 'start')"
            >
              <Icon
                v-if="busy === `${(item as unknown as ContainerInfo).id}:start`"
                name="svg-spinners:tadpole"
                size="14"
              />
              Start
            </Button>
            <Button
              v-else
              theme="secondary"
              size="xs"
              :disabled="busy === `${(item as unknown as ContainerInfo).id}:stop`"
              @click="handleAction(item as unknown as ContainerInfo, 'stop')"
            >
              <Icon
                v-if="busy === `${(item as unknown as ContainerInfo).id}:stop`"
                name="svg-spinners:tadpole"
                size="14"
              />
              Stop
            </Button>
            <Button
              theme="secondary"
              size="xs"
              :disabled="busy === `${(item as unknown as ContainerInfo).id}:restart`"
              @click="handleAction(item as unknown as ContainerInfo, 'restart')"
            >
              <Icon
                v-if="busy === `${(item as unknown as ContainerInfo).id}:restart`"
                name="svg-spinners:tadpole"
                size="14"
              />
              Restart
            </Button>
            <button
              type="button"
              title="Remove container"
              class="cursor-pointer rounded-button p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
              @click="handleAction(item as unknown as ContainerInfo, 'remove')"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </template>
        </div>
      </template>
    </Table>

    <Modal :open="!!logsFor" @on-close-modal="logsFor = null">
      <Card
        :title="logsFor ? `Logs — ${logsFor.name}` : 'Logs'"
        class="w-2xl max-w-full"
        close-button
        content-class="p-0"
        @on-close="logsFor = null"
      >
        <p v-if="logsLoading" class="p-4.25 text-caption text-ink-2">Loading…</p>
        <p v-else-if="!logLines.length" class="p-4.25 text-caption text-ink-2">No log lines.</p>
        <pre
          v-else
          class="max-h-100 overflow-y-auto p-4.25 font-mono text-xs leading-relaxed text-ink-2"
          >{{ logLines.map(line => line.message).join('\n') }}</pre>
      </Card>
    </Modal>
  </div>
</template>
