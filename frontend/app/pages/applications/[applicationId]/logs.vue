<script setup lang="ts">
  import { useApplications } from '~/composables/services/useApplications';
  import { useLogs, type LogEntry, type LogLevel } from '~/composables/services/useLogs';

  const route = useRoute();
  const session = useSessionStore();

  const applications = useApplications();
  const { history, download, topic } = useLogs();
  const { subscribe, status } = useWebSocket();

  const applicationId = computed(() => String(route.params.applicationId));
  const applicationName = ref('');

  useHead(() => ({ title: `Logs · ${applicationName.value || 'Application'}` }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({ title: 'Logs', context: applicationName.value });
  });

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
    info: 'text-white/85',
  };

  const query = () => ({
    search: filters.search || undefined,
    stream: (filters.stream || undefined) as 'stdout' | 'stderr' | undefined,
    level: (filters.level || undefined) as LogLevel | undefined,
    tail: 200,
  });

  const load = async () => {
    if (!session.organizationId) {
      return;
    }

    loading.value = true;
    error.value = '';

    try {
      entries.value = (await history(applicationId.value, query())).entries;
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

      if (filters.search && !entry.message.toLowerCase().includes(filters.search.toLowerCase())) {
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

    stop = subscribe(topic(applicationId.value), message => {
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
      const text = await download(applicationId.value, query());
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `${applicationId.value}.log`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      downloading.value = false;
    }
  };

  onMounted(async () => {
    if (!session.organizationId) {
      return;
    }

    const { application } = await applications.get(applicationId.value);
    applicationName.value = application.name;

    await load();
  });
</script>

<template>
  <Content>
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="filters.search"
          placeholder="Filter output"
          class="max-w-75 flex-1 rounded-control border border-edge bg-card px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-strong"
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
          class="flex cursor-pointer items-center gap-2 rounded-control border border-edge bg-card px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:bg-inset"
          @click="toggleLive"
        >
          <StatusDot :status="live ? 'live' : 'stopped'" />
          {{ live ? (status === 'open' ? 'Live' : status) : 'Paused' }}
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
        <p v-if="loading" class="text-white/50">Loading…</p>
        <p v-else-if="!visible.length" class="text-white/50">No log lines.</p>
        <div
          v-for="(entry, index) in visible"
          :key="index"
          class="flex gap-3.5 whitespace-pre-wrap"
        >
          <span v-if="entry.timestamp" class="shrink-0 text-white/50">{{ entry.timestamp }}</span>
          <span :class="LEVEL_CLASS[entry.level]">{{ entry.message }}</span>
        </div>
        <div v-if="live" class="text-white/75">
          <span class="animate-pulse motion-reduce:animate-none">▋</span>
        </div>
      </div>
    </div>
  </Content>
</template>
