<script setup lang="ts">
  import type { AccessStatsPoint } from '~/composables/services/useProxyAccess';

  const props = defineProps<{ series: AccessStatsPoint[]; loading?: boolean }>();

  const MAX_BARS = 30;

  const points = computed(() => props.series.slice(-MAX_BARS));

  const bars = (values: number[]) => {
    const max = Math.max(...values, 0);

    return values.map(value => (max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0));
  };

  const latest = computed(() => points.value.at(-1));

  const requestsBars = computed(() => bars(points.value.map(point => point.requests)));
  const errorBars = computed(() => bars(points.value.map(point => point.errorRate * 100)));
  const p95Bars = computed(() => bars(points.value.map(point => point.p95Ms)));
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-3">
    <Metric
      label="Requests / min"
      :value="latest ? String(latest.requests) : '—'"
      :note="loading ? 'Loading…' : `last ${points.length} min`"
      :bars="requestsBars"
    />
    <Metric
      label="Error rate"
      :value="latest ? `${Math.round(latest.errorRate * 100)}%` : '—'"
      note="4xx, 5xx or unmatched"
      :bars="errorBars"
    />
    <Metric
      label="p95 duration"
      :value="latest ? `${latest.p95Ms} ms` : '—'"
      note="estimated from duration buckets"
      :bars="p95Bars"
    />
  </div>
</template>
