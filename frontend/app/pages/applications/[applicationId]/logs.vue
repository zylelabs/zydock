<script setup lang="ts">
  import type { LogEntry, LogLevel } from '~/composables/use-logs';

  useHead({ title: 'Logs' });

  const route = useRoute();
  const session = useSessionStore();
  const applicationId = computed(() => String(route.params.applicationId));

  const { history, download, topic } = useLogs();
  const { subscribe, status } = useWebSocket();

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

  // Lines that pass the current filters — applied to both history and live output.
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

    if (live.value) {
      stop = subscribe(topic(applicationId.value), message => {
        if (message.event === 'log') {
          entries.value.push(message.data as LogEntry);

          // Keep the buffer bounded so a long stream never grows without limit.
          if (entries.value.length > 5000) {
            entries.value.splice(0, entries.value.length - 5000);
          }
        }
      });
    } else {
      stop?.();
      stop = undefined;
    }
  };

  const downloading = ref(false);

  const onDownload = async () => {
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

  const LEVEL_CLASS: Record<LogLevel, string> = {
    error: 'text-danger',
    warn: 'text-warning',
    info: 'text-content',
  };

  onMounted(load);
</script>

<template>
  <section class="mx-auto flex h-full max-w-5xl flex-col gap-4">
    <NuxtLink
      :to="`/applications/${applicationId}`"
      class="flex items-center gap-1 text-sm text-content-muted hover:text-content"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Application
    </NuxtLink>

    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1>Logs</h1>
      <div class="flex items-center gap-2">
        <span class="text-xs text-content-muted">{{ live ? status : 'paused' }}</span>
        <UiButton :variant="live ? 'danger' : 'secondary'" @click="toggleLive">
          <Icon :name="live ? 'lucide:pause' : 'lucide:play'" class="size-4" />
          {{ live ? 'Stop' : 'Live' }}
        </UiButton>
        <UiButton variant="ghost" :loading="downloading" @click="onDownload">
          <Icon name="lucide:download" class="size-4" />
          Download
        </UiButton>
      </div>
    </header>

    <div class="grid gap-2 sm:grid-cols-4">
      <UiInput v-model="filters.search" placeholder="Search…" @keyup.enter="load" />
      <UiSelect v-model="filters.stream" :options="streamOptions" />
      <UiSelect v-model="filters.level" :options="levelOptions" />
      <UiButton variant="secondary" :loading="loading" @click="load">Apply</UiButton>
    </div>

    <UiAlert v-if="error" variant="error">{{ error }}</UiAlert>

    <div
      class="flex-1 overflow-auto rounded-xl border border-surface-border bg-surface-raised p-4 font-mono text-xs leading-relaxed"
    >
      <p v-if="!visible.length" class="text-content-muted">No log lines.</p>
      <div v-for="(entry, index) in visible" :key="index" class="flex gap-2 whitespace-pre-wrap">
        <span v-if="entry.timestamp" class="shrink-0 text-content-muted">{{
          entry.timestamp
        }}</span>
        <span :class="LEVEL_CLASS[entry.level]">{{ entry.message }}</span>
      </div>
    </div>
  </section>
</template>
