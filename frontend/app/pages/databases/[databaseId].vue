<script setup lang="ts">
  import type { DatabaseCredentials, DatabaseStatus } from '~/composables/use-databases';
  import type { ContainerLogEntry } from '~/composables/use-containers';
  import type { ContainerMetric } from '~/composables/use-metrics';
  import type { Backup, BackupStatus } from '~/composables/use-backups';

  const route = useRoute();
  const session = useSessionStore();
  const databaseId = computed(() => String(route.params.databaseId));

  const { current } = useOrganizations();
  const databases = useDatabases();
  const servers = useServers();
  const containersApi = useContainers();
  const metricsApi = useMetrics();
  const backupsApi = useBackups();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');
  const busy = ref('');

  const { data, refresh } = await useAsyncData(
    () => `database-${databaseId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const { database } = await databases.get(databaseId.value);
      const { server } = await servers.get(database.serverId);

      return { database, server };
    },
    { server: false, watch: [() => session.organizationId, databaseId] },
  );

  useHead(() => ({ title: data.value?.database.name ?? 'Database' }));

  const database = computed(() => data.value?.database ?? null);
  const serverName = computed(() => data.value?.server.name ?? '');

  const STATUS: Record<
    DatabaseStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    provisioning: { label: 'Provisioning', variant: 'info' },
    running: { label: 'Running', variant: 'success' },
    stopped: { label: 'Stopped', variant: 'warning' },
    failed: { label: 'Failed', variant: 'danger' },
    unknown: { label: 'Unknown', variant: 'neutral' },
  };

  const runLifecycle = async (action: 'start' | 'stop' | 'restart') => {
    actionError.value = '';
    busy.value = action;

    try {
      await databases.lifecycle(databaseId.value, action);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'The operation failed.';
    } finally {
      busy.value = '';
    }
  };

  const credentials = ref<DatabaseCredentials | null>(null);
  const credentialsError = ref('');
  const credentialsLoading = ref(false);

  const revealCredentials = async () => {
    credentialsError.value = '';
    credentialsLoading.value = true;

    try {
      credentials.value = (await databases.credentials(databaseId.value)).credentials;
    } catch (error) {
      credentialsError.value =
        (error as { message?: string }).message || 'Failed to read credentials.';
    } finally {
      credentialsLoading.value = false;
    }
  };

  const containerMetric = ref<ContainerMetric | null>(null);
  const metricsError = ref('');

  const loadMetrics = async () => {
    if (!database.value?.containerId || !database.value.serverId) {
      return;
    }

    metricsError.value = '';

    try {
      const containers = await metricsApi.serverContainerMetrics(database.value.serverId);
      containerMetric.value =
        containers.find(container => container.id === database.value?.containerId) ?? null;
    } catch (error) {
      containerMetric.value = null;
      metricsError.value = (error as { message?: string }).message || 'Metrics unavailable.';
    }
  };

  const percent = (used = 0, total = 0) => (total ? Math.round((used / total) * 100) : 0);

  const logEntries = ref<ContainerLogEntry[]>([]);
  const logsError = ref('');
  const logsLoading = ref(false);

  const loadLogs = async () => {
    if (!database.value?.containerId || !database.value.serverId) {
      return;
    }

    logsError.value = '';
    logsLoading.value = true;

    try {
      logEntries.value = await containersApi.logs(
        database.value.serverId,
        database.value.containerId,
        200,
      );
    } catch (error) {
      logEntries.value = [];
      logsError.value = (error as { message?: string }).message || 'Failed to load logs.';
    } finally {
      logsLoading.value = false;
    }
  };

  watch(
    database,
    value => {
      if (value?.containerId) {
        loadMetrics();
        loadLogs();
      }
    },
    { immediate: true },
  );

  const backups = ref<Backup[]>([]);
  const backupsError = ref('');
  const backupsLoading = ref(false);
  const creatingBackup = ref(false);
  const backupBusy = ref('');

  const BACKUP_STATUS: Record<
    BackupStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    running: { label: 'Running', variant: 'info' },
    completed: { label: 'Completed', variant: 'success' },
    failed: { label: 'Failed', variant: 'danger' },
  };

  const loadBackups = async () => {
    backupsError.value = '';
    backupsLoading.value = true;

    try {
      const result = await backupsApi.list({ databaseId: databaseId.value });
      backups.value = result.items;
    } catch (error) {
      backups.value = [];
      backupsError.value = (error as { message?: string }).message || 'Failed to list backups.';
    } finally {
      backupsLoading.value = false;
    }
  };

  onMounted(loadBackups);

  const createBackup = async () => {
    actionError.value = '';
    creatingBackup.value = true;

    try {
      await backupsApi.create({ type: 'database', databaseId: databaseId.value });
      await loadBackups();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to start the backup.';
    } finally {
      creatingBackup.value = false;
    }
  };

  const downloadBackup = async (backup: Backup) => {
    actionError.value = '';
    backupBusy.value = `${backup.id}:download`;

    try {
      const blob = await backupsApi.download(backup.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = backup.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to download the backup.';
    } finally {
      backupBusy.value = '';
    }
  };

  const restoreBackup = async (backup: Backup) => {
    actionError.value = '';
    backupBusy.value = `${backup.id}:restore`;

    try {
      await backupsApi.restore(backup.id);
      await loadBackups();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to start the restore.';
    } finally {
      backupBusy.value = '';
    }
  };

  const backupToRemove = ref<Backup | null>(null);
  const removingBackup = ref(false);

  const confirmRemoveBackup = async () => {
    if (!backupToRemove.value) {
      return;
    }

    removingBackup.value = true;
    actionError.value = '';

    try {
      await backupsApi.remove(backupToRemove.value.id);
      backupToRemove.value = null;
      await loadBackups();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to remove the backup.';
    } finally {
      removingBackup.value = false;
    }
  };

  const confirmDeleteOpen = ref(false);
  const removeData = ref(false);
  const deleting = ref(false);

  const onDeleteDatabase = async () => {
    actionError.value = '';
    deleting.value = true;

    try {
      await databases.remove(databaseId.value, removeData.value);
      await navigateTo('/databases');
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to delete the database.';
      deleting.value = false;
    }
  };
</script>

<template>
  <section v-if="database" class="mx-auto flex max-w-4xl flex-col gap-6">
    <NuxtLink
      to="/databases"
      class="flex items-center gap-1 text-sm text-content-muted hover:text-content"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Databases
    </NuxtLink>

    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <h1>{{ database.name }}</h1>
        <UiBadge variant="info">{{ database.engine }} {{ database.version }}</UiBadge>
        <UiBadge :variant="STATUS[database.status].variant">
          {{ STATUS[database.status].label }}
        </UiBadge>
      </div>

      <div v-if="canManage" class="flex items-center gap-2">
        <UiButton
          v-if="database.status === 'stopped'"
          variant="secondary"
          :loading="busy === 'start'"
          @click="runLifecycle('start')"
        >
          Start
        </UiButton>
        <template v-else-if="database.status === 'running'">
          <UiButton
            variant="secondary"
            :loading="busy === 'restart'"
            @click="runLifecycle('restart')"
          >
            Restart
          </UiButton>
          <UiButton variant="ghost" :loading="busy === 'stop'" @click="runLifecycle('stop')">
            Stop
          </UiButton>
        </template>
      </div>
    </header>

    <p class="text-sm text-content-muted">
      {{ serverName }} · {{ database.connection.host }}:{{ database.connection.port }}
    </p>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard title="Credentials">
      <UiAlert v-if="credentialsError" variant="error">{{ credentialsError }}</UiAlert>

      <UiButton
        v-if="!credentials"
        variant="secondary"
        :loading="credentialsLoading"
        @click="revealCredentials"
      >
        Reveal
      </UiButton>

      <div v-else class="flex flex-col gap-2 font-mono text-xs">
        <p><span class="text-content-muted">host:</span> {{ credentials.host }}</p>
        <p><span class="text-content-muted">port:</span> {{ credentials.port }}</p>
        <p><span class="text-content-muted">user:</span> {{ credentials.username }}</p>
        <p><span class="text-content-muted">database:</span> {{ credentials.database }}</p>
        <p class="break-all">
          <span class="text-content-muted">password:</span> {{ credentials.password }}
        </p>
        <p class="break-all">
          <span class="text-content-muted">URI:</span> {{ credentials.connectionUri }}
        </p>
      </div>
    </UiCard>

    <UiCard v-if="database.containerId" title="Metrics">
      <UiAlert v-if="metricsError" variant="error">{{ metricsError }}</UiAlert>

      <div v-if="containerMetric" class="grid gap-4 sm:grid-cols-2">
        <div>
          <div class="mb-1 flex justify-between text-xs text-content-muted">
            <span>CPU</span><span>{{ Math.round(containerMetric.cpuPercent) }}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              class="h-full bg-primary"
              :style="{ width: `${Math.min(100, containerMetric.cpuPercent)}%` }"
            />
          </div>
        </div>
        <div>
          <div class="mb-1 flex justify-between text-xs text-content-muted">
            <span>Memory</span>
            <span>{{ percent(containerMetric.memoryUsedMb, containerMetric.memoryLimitMb) }}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              class="h-full bg-primary"
              :style="{
                width: `${percent(containerMetric.memoryUsedMb, containerMetric.memoryLimitMb)}%`,
              }"
            />
          </div>
        </div>
      </div>
      <p v-else class="text-sm text-content-muted">No metrics available yet.</p>
    </UiCard>

    <UiCard v-if="database.containerId" title="Logs">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Logs</h2>
          <UiButton variant="ghost" :loading="logsLoading" @click="loadLogs">Refresh</UiButton>
        </div>
      </template>

      <UiAlert v-if="logsError" variant="error">{{ logsError }}</UiAlert>
      <p v-else-if="!logEntries.length" class="text-sm text-content-muted">No log lines.</p>
      <pre
        v-else
        class="max-h-72 overflow-y-auto rounded-lg border border-surface-border bg-surface p-3 font-mono text-xs leading-relaxed"
        >{{ logEntries.map(entry => entry.message).join('\n') }}</pre>
    </UiCard>

    <UiCard title="Backups">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Backups</h2>
          <UiButton
            v-if="canManage"
            variant="secondary"
            :loading="creatingBackup"
            @click="createBackup"
          >
            <Icon name="lucide:plus" class="size-4" />
            New backup
          </UiButton>
        </div>
      </template>

      <UiAlert v-if="backupsError" variant="error">{{ backupsError }}</UiAlert>
      <p v-else-if="backupsLoading" class="text-sm text-content-muted">Loading…</p>
      <p v-else-if="!backups.length" class="text-sm text-content-muted">No backups yet.</p>

      <ul v-else class="flex flex-col divide-y divide-surface-border">
        <li
          v-for="backup in backups"
          :key="backup.id"
          class="flex flex-wrap items-center gap-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium">{{ backup.label }}</p>
              <UiBadge :variant="BACKUP_STATUS[backup.status].variant">
                {{ BACKUP_STATUS[backup.status].label }}
              </UiBadge>
              <UiBadge v-if="backup.restoreStatus === 'running'" variant="warning"
                >Restoring</UiBadge
              >
            </div>
            <p class="mt-1 truncate text-xs text-content-muted">
              {{ formatBytes(backup.sizeBytes) }} · {{ formatDuration(backup.durationMs) }}
            </p>
            <p v-if="backup.error" class="mt-1 truncate text-xs text-danger">{{ backup.error }}</p>
          </div>

          <div v-if="canManage" class="flex flex-wrap items-center gap-2">
            <UiButton
              v-if="backup.status === 'completed'"
              variant="ghost"
              :loading="backupBusy === `${backup.id}:download`"
              @click="downloadBackup(backup)"
            >
              Download
            </UiButton>
            <UiButton
              v-if="backup.status === 'completed'"
              variant="secondary"
              :disabled="backup.restoreStatus === 'running'"
              :loading="backupBusy === `${backup.id}:restore`"
              @click="restoreBackup(backup)"
            >
              Restore
            </UiButton>
            <button
              type="button"
              title="Remove"
              class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
              @click="backupToRemove = backup"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </li>
      </ul>
    </UiCard>

    <UiCard v-if="canManage" title="Danger zone">
      <div class="flex items-center justify-between gap-4">
        <p class="text-sm text-content-muted">Deletes this database from the platform.</p>
        <UiButton variant="danger" @click="confirmDeleteOpen = true">Delete database</UiButton>
      </div>
    </UiCard>

    <UiModal
      :open="confirmDeleteOpen"
      title="Delete database"
      :description="`Delete “${database.name}”?`"
      @update:open="value => (confirmDeleteOpen = value)"
    >
      <UiCheckbox v-model="removeData" label="Also delete the data (volume)" />
      <template #footer="{ close }">
        <UiButton variant="ghost" :disabled="deleting" @click="close">Cancel</UiButton>
        <UiButton variant="danger" :loading="deleting" @click="onDeleteDatabase">Delete</UiButton>
      </template>
    </UiModal>

    <UiConfirm
      :open="Boolean(backupToRemove)"
      title="Remove backup"
      :message="`Remove “${backupToRemove?.label}”? This cannot be undone.`"
      confirm-label="Remove"
      danger
      :loading="removingBackup"
      @confirm="confirmRemoveBackup"
      @update:open="value => !value && (backupToRemove = null)"
    />
  </section>
</template>
