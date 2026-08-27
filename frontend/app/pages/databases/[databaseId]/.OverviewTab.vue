<script setup lang="ts">
  import { applicationStatusDot, useApplications } from '~/composables/services/useApplications';
  import {
    engineLabel,
    useDatabases,
    type Database,
    type DatabaseConsumer,
    type DatabaseStats,
  } from '~/composables/services/useDatabases';
  import { formatBytes, formatUptime } from '~/utils';

  const props = defineProps<{ database: Database }>();

  const session = useSessionStore();
  const databasesApi = useDatabases();
  const applicationsApi = useApplications();

  const { data: stats, status: statsStatus } = useLazyAsyncData<DatabaseStats>(
    () => `database-${props.database.id}-stats`,
    () =>
      session.organizationId
        ? databasesApi.statsOf(props.database.id)
        : Promise.resolve({} as DatabaseStats),
    {
      server: false,
      watch: [() => session.organizationId, () => props.database.id],
      default: () => ({}) as DatabaseStats,
    },
  );

  const statsFirstLoad = useFirstLoad(statsStatus);

  const connections = computed(() => {
    if (stats.value?.connections === undefined) {
      return '—';
    }

    return stats.value.maxConnections !== undefined
      ? `${stats.value.connections} / ${stats.value.maxConnections}`
      : `${stats.value.connections}`;
  });

  const volumePercent = computed(() => {
    const used = stats.value?.diskUsedBytes;
    const total = stats.value?.diskTotalBytes;

    return used !== undefined && total ? (used / total) * 100 : undefined;
  });

  const volumeLabel = computed(() => {
    const used = stats.value?.diskUsedBytes;
    const total = stats.value?.diskTotalBytes;

    return used !== undefined && total !== undefined
      ? `${formatBytes(used)} of ${formatBytes(total)} disk`
      : '—';
  });

  const degradedReason = computed(() => stats.value?.degraded?.reason ?? '');

  const peakNote = computed(() =>
    stats.value?.peakConnections !== undefined
      ? `peak ${stats.value.peakConnections} (${stats.value.peakWindowHours}h)`
      : undefined,
  );

  const emptyApplications = { items: [] };

  const { data: overviewData, status: consumersStatus } = useLazyAsyncData(
    () => `database-${props.database.id}-consumers`,
    async () => {
      if (!session.organizationId) {
        return {
          consumers: [] as DatabaseConsumer[],
          applications: emptyApplications.items,
          otherConnections: undefined as number | undefined,
          degraded: undefined as { reason: string } | undefined,
        };
      }

      const [consumersResult, applicationsResult] = await Promise.all([
        databasesApi.consumers(props.database.id),
        applicationsApi.list(),
      ]);

      return {
        consumers: consumersResult.items,
        applications: applicationsResult.items,
        otherConnections: consumersResult.otherConnections,
        degraded: consumersResult.degraded,
      };
    },
    {
      server: false,
      watch: [() => session.organizationId, () => props.database.id],
      default: () => ({
        consumers: [],
        applications: [],
        otherConnections: undefined,
        degraded: undefined,
      }),
    },
  );

  const consumersFirstLoad = useFirstLoad(consumersStatus);

  const consumers = computed(() => overviewData.value?.consumers ?? []);
  const otherConnections = computed(() => overviewData.value?.otherConnections);
  const consumersDegradedReason = computed(() => overviewData.value?.degraded?.reason ?? '');

  const connectionsLabel = (consumer: DatabaseConsumer) =>
    consumer.connections !== undefined ? `${consumer.connections} conns` : '—';

  const statusByApplication = computed(
    () => new Map((overviewData.value?.applications ?? []).map(app => [app.id, app.status])),
  );
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <div v-if="statsFirstLoad" class="grid grid-cols-4 gap-3.5">
      <SkeletonChart v-for="index in 4" :key="index" />
    </div>
    <div v-else class="grid grid-cols-4 gap-3.5">
      <Metric label="Size on disk" :value="formatBytes(stats?.sizeBytes)" />
      <Metric label="Connections" :value="connections" :note="peakNote" />
      <Metric label="Uptime" :value="formatUptime(stats?.uptimeSeconds)" />
      <Metric
        label="Version"
        :value="engineLabel(database.engine, stats?.versionLabel ?? database.version)"
      />
    </div>

    <Card title="Volume">
      <Gauge v-if="volumePercent !== undefined" :value="volumeLabel" :percent="volumePercent" />
      <p v-else class="text-caption text-ink-2">No disk data available.</p>

      <template v-if="degradedReason" #footer>
        <p class="text-caption text-ink-3">Live stats unavailable — {{ degradedReason }}</p>
      </template>
    </Card>

    <Card title="Applications connected" content-class="p-0">
      <template v-if="consumersFirstLoad">
        <SkeletonRow v-for="index in 2" :key="index" />
      </template>

      <EmptyState
        v-else-if="!consumers.length"
        variant="prompt"
        description="No application references this database."
        class="m-2.5"
      />

      <Row
        v-for="consumer in consumers"
        :key="consumer.applicationId"
        :to="`/applications/${consumer.applicationId}`"
        class="grid-cols-[auto_1fr_auto]"
      >
        <StatusDot
          :status="
            applicationStatusDot(statusByApplication.get(consumer.applicationId) ?? 'stopped')
          "
        />
        <span class="truncate text-caption text-ink">{{ consumer.name }}</span>
        <div class="flex items-center gap-2.75">
          <span v-if="consumer.variableKey" class="font-mono text-caption text-ink-2">{{
            consumer.variableKey
          }}</span>
          <span class="text-caption text-ink-3">{{ connectionsLabel(consumer) }}</span>
        </div>
      </Row>

      <Row v-if="otherConnections" as="div" class="grid-cols-[auto_1fr_auto]">
        <span></span>
        <span class="truncate text-caption text-ink-3">Other clients</span>
        <span class="text-caption text-ink-3">{{ otherConnections }} conns</span>
      </Row>

      <template v-if="consumersDegradedReason" #footer>
        <p class="text-caption text-ink-3">
          Live connections unavailable — {{ consumersDegradedReason }}
        </p>
      </template>
    </Card>
  </div>
</template>
