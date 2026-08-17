<script setup lang="ts">
  import {
    databaseStatusDot,
    engineLabel,
    type Database,
    type DatabaseStatsItem,
  } from '~/composables/services/useDatabases';
  import { formatBytes } from '~/utils';

  const props = defineProps<{
    database: Database;
    stats?: DatabaseStatsItem;
    server?: string;
  }>();

  const subtitle = computed(() => {
    const label = engineLabel(props.database.engine, props.database.version);

    return props.database.application ? `${label} · ${props.database.application.service}` : label;
  });

  const host = computed(
    () => `${props.database.connection.host}:${props.database.connection.port}`,
  );

  const size = computed(() =>
    props.stats?.sizeBytes !== undefined ? formatBytes(props.stats.sizeBytes) : '—',
  );

  const connections = computed(() => {
    if (props.stats?.connections === undefined) {
      return '—';
    }

    return props.stats.maxConnections !== undefined
      ? `${props.stats.connections} / ${props.stats.maxConnections}`
      : `${props.stats.connections}`;
  });
</script>

<template>
  <Row :to="`/databases/${database.id}`" class="grid-cols-[1.3fr_1.1fr_0.7fr_0.9fr_0.8fr]">
    <div class="flex min-w-0 items-center gap-2.75">
      <StatusDot :status="databaseStatusDot(database.status)" />
      <div class="min-w-0">
        <div class="truncate text-body font-medium text-ink">{{ database.name }}</div>
        <div class="truncate text-caption text-ink-2">{{ subtitle }}</div>
      </div>
    </div>
    <div class="min-w-0 truncate font-mono text-caption text-ink-2" :title="host">{{ host }}</div>
    <div class="truncate text-caption text-ink-2">{{ size }}</div>
    <div class="truncate text-caption text-ink-2">{{ connections }}</div>
    <div class="truncate text-caption text-ink-2">{{ server ?? '—' }}</div>
  </Row>
</template>
