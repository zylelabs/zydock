<script setup lang="ts">
  import type { AccessStatsHost } from '~/composables/services/useProxyAccess';

  const props = defineProps<{ hosts: AccessStatsHost[] }>();

  const maxRequests = computed(() => Math.max(...props.hosts.map(host => host.requests), 0));

  const percentOf = (requests: number) =>
    maxRequests.value > 0 ? Math.round((requests / maxRequests.value) * 100) : 0;
</script>

<template>
  <Card title="Most requested hosts" description="Ranked by requests in the current window" rows>
    <EmptyState v-if="!hosts.length" title="No traffic in this window" />

    <template v-for="host in hosts" :key="host.host">
      <Row
        v-if="host.applicationId"
        :to="`/applications/${host.applicationId}/logs?view=access`"
        class="grid-cols-[1fr_auto]"
      >
        <div class="min-w-0">
          <div class="truncate text-caption font-medium text-ink">{{ host.host }}</div>
          <div class="text-caption text-ink-2">{{ host.applicationName }}</div>
        </div>

        <div class="w-32">
          <Gauge :value="String(host.requests)" :percent="percentOf(host.requests)" />
        </div>
      </Row>

      <Row v-else as="div" class="grid-cols-[1fr_auto]">
        <div class="min-w-0">
          <div class="truncate text-caption font-medium text-ink">{{ host.host }}</div>
          <Tag color="attn" class="mt-1">unmatched</Tag>
        </div>

        <div class="w-32">
          <Gauge :value="String(host.requests)" :percent="percentOf(host.requests)" />
        </div>
      </Row>
    </template>
  </Card>
</template>
