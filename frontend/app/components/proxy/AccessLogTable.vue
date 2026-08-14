<script setup lang="ts">
  import type { AccessLogEntry } from '~/composables/services/useProxyAccess';

  const props = withDefaults(
    defineProps<{
      items: AccessLogEntry[];
      loading?: boolean;
      showApplication?: boolean;
      clickableHost?: boolean;
      emptyLabel?: string;
    }>(),
    { emptyLabel: 'No access logs yet.' },
  );

  const emit = defineEmits<{ hostClick: [entry: AccessLogEntry] }>();

  const live = defineModel<boolean>('live', { default: false });

  const columns = computed(() => [
    { key: 'at', label: 'Time' },
    { key: 'host', label: 'Host' },
    ...(props.showApplication ? [{ key: 'applicationName', label: 'Application' }] : []),
    { key: 'method', label: 'Method' },
    { key: 'path', label: 'Path' },
    { key: 'status', label: 'Status' },
    { key: 'durationMs', label: 'Duration' },
    { key: 'remoteIp', label: 'IP' },
    { key: 'userAgent', label: 'User agent' },
  ]);

  const gridClass = computed(() =>
    props.showApplication
      ? 'grid-cols-[0.85fr_1.1fr_1fr_0.6fr_1.4fr_0.55fr_0.65fr_0.85fr_1.3fr]'
      : 'grid-cols-[0.85fr_1.1fr_0.6fr_1.4fr_0.55fr_0.65fr_0.85fr_1.3fr]',
  );

  const formatTime = (at: string) =>
    new Date(at).toLocaleTimeString('en-US', { hour12: false, timeStyle: 'medium' });

  const formatDuration = (durationMs: number) =>
    durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${Math.round(durationMs)}ms`;

  const statusColor = (status: number) => {
    if (!status || status >= 500) {
      return 'failed';
    }

    if (status >= 400) {
      return 'attn';
    }

    return 'default';
  };

  const rowKey = (item: Record<string, unknown>, index: number) =>
    `${(item as unknown as AccessLogEntry).at}-${index}`;
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <slot name="filters" />

      <div class="flex-1" />

      <button
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-control border border-edge bg-card px-3.5 py-1.5 text-caption text-ink transition-colors hover:bg-inset"
        @click="live = !live"
      >
        <StatusDot :status="live ? 'live' : 'stopped'" />
        {{ live ? 'Live' : 'Paused' }}
      </button>
    </div>

    <Table
      :columns="columns"
      :items="items as unknown as Record<string, unknown>[]"
      :grid-class="gridClass"
      :loading="loading"
      :row-key="rowKey"
      :empty-label="emptyLabel"
    >
      <template #at="{ item }">
        <span class="font-mono text-caption text-ink-2">{{
          formatTime((item as unknown as AccessLogEntry).at)
        }}</span>
      </template>

      <template #host="{ item }">
        <button
          v-if="clickableHost && (item as unknown as AccessLogEntry).applicationId"
          type="button"
          class="max-w-full cursor-pointer truncate font-mono text-caption text-ink underline decoration-edge-strong underline-offset-2 hover:text-accent"
          :title="(item as unknown as AccessLogEntry).host"
          @click="emit('hostClick', item as unknown as AccessLogEntry)"
        >
          {{ (item as unknown as AccessLogEntry).host }}
        </button>
        <span
          v-else
          class="block max-w-full truncate font-mono text-caption text-ink"
          :title="(item as unknown as AccessLogEntry).host"
        >
          {{ (item as unknown as AccessLogEntry).host }}
        </span>
      </template>

      <template v-if="showApplication" #applicationName="{ item }">
        <span
          v-if="(item as unknown as AccessLogEntry).applicationName"
          class="truncate text-caption text-ink-2"
        >
          {{ (item as unknown as AccessLogEntry).applicationName }}
        </span>
        <Tag v-else color="attn">unmatched</Tag>
      </template>

      <template #method="{ item }">
        <span class="font-mono text-caption text-ink-2">{{
          (item as unknown as AccessLogEntry).method
        }}</span>
      </template>

      <template #path="{ item }">
        <span
          class="block max-w-full truncate font-mono text-caption text-ink"
          :title="(item as unknown as AccessLogEntry).path"
        >
          {{ (item as unknown as AccessLogEntry).path }}
        </span>
      </template>

      <template #status="{ item }">
        <Tag :color="statusColor((item as unknown as AccessLogEntry).status)">
          {{ (item as unknown as AccessLogEntry).status || '—' }}
        </Tag>
      </template>

      <template #durationMs="{ item }">
        <span class="text-caption text-ink-2">{{
          formatDuration((item as unknown as AccessLogEntry).durationMs)
        }}</span>
      </template>

      <template #remoteIp="{ item }">
        <span class="font-mono text-caption text-ink-2">{{
          (item as unknown as AccessLogEntry).remoteIp
        }}</span>
      </template>

      <template #userAgent="{ item }">
        <span
          class="block max-w-full truncate text-caption text-ink-3"
          :title="(item as unknown as AccessLogEntry).userAgent"
        >
          {{ (item as unknown as AccessLogEntry).userAgent || '—' }}
        </span>
      </template>
    </Table>
  </div>
</template>
