<script setup lang="ts">
  import type { AccessLogEntry } from '~/composables/services/useProxyAccess';

  const props = defineProps<{ items: AccessLogEntry[] }>();

  const activeHosts = computed(() => new Set(props.items.map(entry => entry.host)).size);

  const requestsPerMinute = computed(() => {
    if (props.items.length < 2) {
      return props.items.length;
    }

    const timestamps = props.items.map(entry => new Date(entry.at).getTime());
    const spanMinutes = (Math.max(...timestamps) - Math.min(...timestamps)) / 60000;

    return spanMinutes > 0 ? Math.round(props.items.length / spanMinutes) : props.items.length;
  });

  const errorRate = computed(() => {
    if (!props.items.length) {
      return 0;
    }

    const errors = props.items.filter(entry => entry.status === 0 || entry.status >= 400).length;

    return Math.round((errors / props.items.length) * 100);
  });
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-3">
    <Metric label="Active hosts" :value="String(activeHosts)" note="in this window" />
    <Metric label="Requests / min" :value="String(requestsPerMinute)" />
    <Metric label="Error rate" :value="`${errorRate}%`" note="status ≥ 400 or unmatched" />
  </div>
</template>
