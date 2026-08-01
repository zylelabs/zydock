<script setup lang="ts">
  import { useLogs, type LogEntry, type LogLevel } from '~/composables/services/useLogs';

  useHead({ title: 'Logs' });

  const route = useRoute();
  const session = useSessionStore();

  const { history, download, topic } = useLogs();
  const { subscribe, status } = useWebSocket();

  const applicationId = computed(() => String(route.params.applicationId));

  const filters = reactive({ search: '', stream: '', level: '', tail: '200' });
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
    error: 'text-danger',
    warn: 'text-warning',
    info: 'text-content',
  };

  const query = () => ({
    search: filters.search || undefined,
    stream: (filters.stream || undefined) as 'stdout' | 'stderr' | undefined,
    level: (filters.level || undefined) as LogLevel | undefined,
    tail: Number(filters.tail) || 200,
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

  onMounted(load);
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

    <Header title="Logs">
      <template #right>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-content-muted">{{ live ? status : 'paused' }}</span>
          <Button :theme="live ? 'danger' : 'secondary'" @click="toggleLive">
            <Icon :name="live ? 'lucide:pause' : 'lucide:play'" class="size-4" />
            {{ live ? 'Stop' : 'Live' }}
          </Button>
          <Button theme="ghost" :disabled="downloading" @click="handleDownload">
            <Icon :name="downloading ? 'svg-spinners:tadpole' : 'lucide:download'" class="size-4" />
            Download
          </Button>
        </div>
      </template>
    </Header>

    <div class="flex flex-col gap-4">
      <div class="grid gap-2 sm:grid-cols-4">
        <Input v-model="filters.search" placeholder="Search…" @keyup.enter="load" />
        <Select v-model="filters.stream" :options="streamOptions" />
        <Select v-model="filters.level" :options="levelOptions" />
        <Button theme="secondary" :disabled="loading" @click="load">
          <Icon v-if="loading" name="svg-spinners:tadpole" size="16" />
          Apply
        </Button>
      </div>

      <Alert v-if="error" theme="error">{{ error }}</Alert>

      <div
        class="h-[65vh] overflow-auto rounded-xl border border-surface-border bg-surface-raised p-4 font-mono text-xs leading-relaxed"
      >
        <p v-if="!visible.length" class="text-content-muted">No log lines.</p>
        <div v-for="(entry, index) in visible" :key="index" class="flex gap-2 whitespace-pre-wrap">
          <span v-if="entry.timestamp" class="shrink-0 text-content-muted">
            {{ entry.timestamp }}
          </span>
          <span :class="LEVEL_CLASS[entry.level]">{{ entry.message }}</span>
        </div>
      </div>
    </div>
  </Content>
</template>
