<script setup lang="ts">
  import type { ApplicationService } from '~/composables/services/useApplications';
  import { useLogs, type LogEntry, type LogLevel } from '~/composables/services/useLogs';

  const props = defineProps<{ applicationId: string; services: ApplicationService[] }>();

  const route = useRoute();
  const session = useSessionStore();

  const { history, download, topic } = useLogs();
  const { subscribe, status: socketStatus } = useWebSocket();

  const selectedService = ref('');
  const initialServiceApplied = ref(false);

  const exposedService = computed(() => props.services.find(entry => entry.exposed)?.service ?? '');

  const filters = reactive({ search: '', stream: '', level: '' });
  const entries = ref<LogEntry[]>([]);
  const loading = ref(false);
  const live = ref(false);
  const error = ref('');

  const streamOptions = [
    { value: '', label: 'All streams' },
    { value: 'stdout', label: 'stdout' },
    { value: 'stderr', label: 'stderr' },
  ];
  const levelOptions = [
    { value: '', label: 'All levels' },
    { value: 'error', label: 'error' },
    { value: 'warn', label: 'warn' },
    { value: 'info', label: 'info' },
  ];

  const LEVEL_CLASS: Record<LogLevel, string> = {
    error: 'text-failed',
    warn: 'text-attn',
    info: 'text-terminal-ink',
  };

  const query = () => ({
    search: filters.search || undefined,
    stream: (filters.stream || undefined) as 'stdout' | 'stderr' | undefined,
    level: (filters.level || undefined) as LogLevel | undefined,
    tail: 200,
    service: selectedService.value || undefined,
  });

  const load = async () => {
    if (!session.organizationId) {
      return;
    }

    loading.value = true;
    error.value = '';

    try {
      entries.value = (await history(props.applicationId, query())).entries;
    } catch (failure) {
      error.value = (failure as { message?: string }).message || 'Failed to load the logs.';
    } finally {
      loading.value = false;
    }
  };

  const visible = computed(() =>
    entries.value.filter(entry => {
      if (filters.stream && entry.stream !== filters.stream) {
        return false;
      }

      if (filters.level && entry.level !== filters.level) {
        return false;
      }

      if (
        filters.search &&
        !stripAnsi(entry.message).toLowerCase().includes(filters.search.toLowerCase())
      ) {
        return false;
      }

      return true;
    }),
  );

  let stop: (() => void) | undefined;

  const toggleLive = () => {
    live.value = !live.value;

    if (!live.value) {
      stop?.();
      stop = undefined;
      return;
    }

    stop = subscribe(topic(props.applicationId), message => {
      if (message.event !== 'log') {
        return;
      }

      entries.value.push(message.data as LogEntry);

      if (entries.value.length > 5000) {
        entries.value.splice(0, entries.value.length - 5000);
      }
    });
  };

  const downloading = ref(false);

  const handleDownload = async () => {
    downloading.value = true;

    try {
      const text = await download(props.applicationId, query());
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `${props.applicationId}.log`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      downloading.value = false;
    }
  };

  watch(
    () => props.services,
    () => {
      if (!initialServiceApplied.value) {
        initialServiceApplied.value = true;

        const queryService = String(route.query.service ?? '');

        if (queryService && props.services.some(entry => entry.service === queryService)) {
          selectedService.value = queryService;
          return;
        }
      }

      if (exposedService.value && selectedService.value !== exposedService.value) {
        selectedService.value = exposedService.value;
        return;
      }

      load();
    },
    { immediate: true },
  );

  watch(selectedService, () => {
    load();
  });
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <input
        v-model="filters.search"
        placeholder="Filter output"
        class="max-w-75 flex-1 rounded-control border border-edge bg-card px-3 py-2 text-caption text-ink outline-none placeholder:text-ink-3 focus:border-edge-strong"
        @keyup.enter="load"
      />
      <Segmented v-model="filters.stream" :options="streamOptions" @update:model-value="load" />
      <Segmented
        v-model="filters.level"
        :options="levelOptions"
        size="sm"
        @update:model-value="load"
      />

      <div class="flex-1" />

      <button
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-control border border-edge bg-card px-3.5 py-1.5 text-caption text-ink transition-colors hover:bg-inset"
        @click="toggleLive"
      >
        <StatusDot :status="live ? 'live' : 'stopped'" />
        {{ live ? (socketStatus === 'open' ? 'Live' : socketStatus) : 'Paused' }}
      </button>
      <Button theme="secondary" size="sm" :disabled="downloading" @click="handleDownload">
        <Icon v-if="downloading" name="svg-spinners:tadpole" class="size-4" />
        Download
      </Button>
    </div>

    <Alert v-if="error" theme="error">{{ error }}</Alert>

    <div
      class="max-h-[65vh] overflow-auto rounded-card bg-terminal p-4 font-mono text-[12.5px] leading-[1.8]"
    >
      <div v-if="loading" class="flex flex-col gap-2.5">
        <Skeleton
          v-for="index in 6"
          :key="index"
          class="h-3"
          :class="index % 2 ? 'w-3/4' : 'w-1/2'"
        />
      </div>
      <p v-else-if="!visible.length" class="text-terminal-ink-3">No log lines.</p>
      <div v-for="(entry, index) in visible" :key="index" class="flex gap-3.5 whitespace-pre-wrap">
        <span v-if="entry.timestamp" class="shrink-0 text-terminal-ink-3">{{
          entry.timestamp
        }}</span>
        <AnsiText :text="entry.message" :class="LEVEL_CLASS[entry.level]" />
      </div>
      <div v-if="live" class="text-terminal-ink-2">
        <span class="animate-pulse motion-reduce:animate-none">▋</span>
      </div>
    </div>
  </div>
</template>
