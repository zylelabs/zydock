import type { AccessLogEntry, AccessLogFilters, AccessLogPage } from './services/useProxyAccess';

const POLL_INTERVAL_MS = 8000;
const MAX_ENTRIES = 500;
const LOAD_TAIL = 200;
const POLL_TAIL = 50;

export const useAccessLogFeed = (
  fetcher: (filters: AccessLogFilters) => Promise<AccessLogPage>,
) => {
  const items = ref<AccessLogEntry[]>([]);
  const loading = ref(false);
  const error = ref('');
  const filtered = ref(false);
  const live = ref(true);
  const visible = usePageVisibility();

  let timer: ReturnType<typeof setInterval> | undefined;
  let activeFilters: AccessLogFilters = {};

  const dedupeKey = (entry: AccessLogEntry) =>
    `${entry.at}:${entry.host}:${entry.path}:${entry.remoteIp}:${entry.status}`;

  const merge = (page: AccessLogPage) => {
    const seen = new Set(items.value.map(dedupeKey));
    const incoming = page.items.filter(entry => !seen.has(dedupeKey(entry)));

    items.value = [...incoming, ...items.value].slice(0, MAX_ENTRIES);
    filtered.value = page.filtered;
  };

  const stopPolling = () => {
    clearInterval(timer);
    timer = undefined;
  };

  const poll = async () => {
    try {
      merge(await fetcher({ tail: POLL_TAIL, ...activeFilters }));
    } catch {
      stopPolling();
    }
  };

  const startPolling = () => {
    stopPolling();
    timer = setInterval(poll, POLL_INTERVAL_MS);
  };

  const load = async (filters: AccessLogFilters = {}) => {
    activeFilters = filters;
    loading.value = true;
    error.value = '';

    try {
      const page = await fetcher({ tail: LOAD_TAIL, ...filters });

      items.value = page.items;
      filtered.value = page.filtered;
    } catch (failure) {
      error.value = (failure as { message?: string }).message || 'Failed to load the access log.';
    } finally {
      loading.value = false;
    }

    if (live.value && visible.value) {
      startPolling();
    }
  };

  watch(live, value => {
    if (value && visible.value) {
      startPolling();
    } else {
      stopPolling();
    }
  });

  watch(visible, value => {
    if (!live.value) {
      return;
    }

    if (value) {
      void poll();
      startPolling();
    } else {
      stopPolling();
    }
  });

  if (getCurrentScope()) {
    onScopeDispose(stopPolling);
  }

  return { items, loading, error, filtered, live, load };
};
