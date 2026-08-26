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

  const props = defineProps<{ database: Database; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const session = useSessionStore();
  const databasesApi = useDatabases();
  const applicationsApi = useApplications();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const isManaged = computed(() => props.database.source === 'managed');

  const desiredEnabled = ref(props.database.publicAccess.enabled);
  const hostPortDraft = ref(
    props.database.publicAccess.hostPort ? String(props.database.publicAccess.hostPort) : '',
  );

  watch(
    () => props.database.publicAccess,
    access => {
      desiredEnabled.value = access.enabled;
      hostPortDraft.value = access.hostPort ? String(access.hostPort) : '';
    },
  );

  const accessError = ref('');
  const accessSaving = ref(false);
  const confirmAccessOpen = ref(false);

  watch(confirmAccessOpen, open => {
    if (!open && !accessSaving.value) {
      desiredEnabled.value = props.database.publicAccess.enabled;
    }
  });

  const handleAccessToggle = (value: boolean) => {
    accessError.value = '';

    if (value && !hostPortDraft.value.trim()) {
      desiredEnabled.value = false;
      accessError.value = 'Enter a host port before enabling external access.';
      return;
    }

    confirmAccessOpen.value = true;
  };

  const applyAccess = async () => {
    const hostPort = desiredEnabled.value ? Number(hostPortDraft.value) : undefined;

    if (
      desiredEnabled.value &&
      (!hostPort || !Number.isInteger(hostPort) || hostPort < 1024 || hostPort > 65535)
    ) {
      accessError.value = 'The port must be a whole number between 1024 and 65535.';
      return;
    }

    accessError.value = '';
    accessSaving.value = true;

    try {
      await databasesApi.updateAccess(props.database.id, {
        enabled: desiredEnabled.value,
        hostPort,
      });
      confirmAccessOpen.value = false;
      emit('refresh');
    } catch (error) {
      desiredEnabled.value = props.database.publicAccess.enabled;
      accessError.value = messageOf(error, 'Failed to update external access.');
    } finally {
      accessSaving.value = false;
    }
  };

  const externalAddress = computed(() =>
    props.database.externalHost && props.database.externalPort
      ? `${props.database.externalHost}:${props.database.externalPort}`
      : null,
  );

  const addressCopied = ref(false);

  const copyExternalAddress = async () => {
    if (!externalAddress.value) {
      return;
    }

    await navigator.clipboard.writeText(externalAddress.value);
    addressCopied.value = true;
    setTimeout(() => (addressCopied.value = false), 2000);
  };

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

    <Card v-if="isManaged" title="External access" content-class="flex flex-col gap-3 p-4.25">
      <Switch
        :model-value="desiredEnabled"
        label="Publish to a host port"
        :disabled="!canManage"
        @update:model-value="handleAccessToggle"
      />

      <Alert theme="warning">
        Exposes the database directly to the internet. Use a strong password and keep the server's
        firewall in mind.
      </Alert>

      <Input
        v-if="desiredEnabled || database.publicAccess.enabled"
        v-model="hostPortDraft"
        label="Host port"
        placeholder="5432"
        mono
        boxed
        :disabled="!canManage || database.publicAccess.enabled"
      />

      <Alert v-if="accessError" theme="error">{{ accessError }}</Alert>

      <div v-if="externalAddress" class="flex items-center gap-2">
        <span class="font-mono text-caption text-ink">{{ externalAddress }}</span>
        <button
          type="button"
          title="Copy address"
          class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-ink"
          @click="copyExternalAddress"
        >
          <Icon :name="addressCopied ? 'lucide:check' : 'lucide:copy'" class="size-3.5" />
        </button>
      </div>

      <Confirm
        v-model:open="confirmAccessOpen"
        :title="desiredEnabled ? 'Enable external access' : 'Disable external access'"
        :message="
          desiredEnabled
            ? `This recreates the database container to publish port ${hostPortDraft}. The data is kept on its volume.`
            : 'This recreates the database container to remove the published port. The data is kept on its volume.'
        "
        :confirm-label="desiredEnabled ? 'Enable' : 'Disable'"
        :danger="desiredEnabled"
        :loading="accessSaving"
        @confirm="applyAccess"
      />
    </Card>
  </div>
</template>
