<script setup lang="ts">
  import { z } from 'zod';
  import { useApplications, type Application } from '~/composables/services/useApplications';
  import {
    BACKUP_TYPES,
    useBackups,
    type Backup,
    type BackupStatus,
    type BackupType,
    type CreateBackupBody,
  } from '~/composables/services/useBackups';
  import { useDatabases, type Database } from '~/composables/services/useDatabases';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useServers, type Server } from '~/composables/services/useServers';
  import { formatBytes, formatDuration } from '~/utils';

  useHead({ title: 'Backups' });

  const toast = useToast();
  const session = useSessionStore();
  const { current } = useOrganizations();

  const backupsApi = useBackups();
  const databasesApi = useDatabases();
  const serversApi = useServers();
  const applicationsApi = useApplications();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({ title: 'Error', message: (error as { message?: string }).message || fallback });
  };

  const empty = {
    backups: [] as Backup[],
    databases: [] as Database[],
    servers: [] as Server[],
    applications: [] as Application[],
  };

  const load = async () => {
    const [backups, databases, servers, applications] = await Promise.all([
      backupsApi.list(),
      databasesApi.list(),
      serversApi.list(),
      applicationsApi.list(),
    ]);

    return {
      backups: backups.items,
      databases: databases.items,
      servers: servers.items,
      applications: applications.items,
    };
  };

  const { getCachedData, markFetched } = useNavigationCache();

  const { data, refresh, status } = useLazyAsyncData(
    'backups',
    async () => {
      const result = session.organizationId ? await load() : empty;

      markFetched('backups');

      return result;
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => empty,
      getCachedData: key => getCachedData(key),
    },
  );

  const backups = computed(() => data.value?.backups ?? []);

  const databaseOptions = computed(() =>
    (data.value?.databases ?? []).map(database => ({ value: database.id, label: database.name })),
  );

  const serverOptions = computed(() =>
    (data.value?.servers ?? []).map(server => ({ value: server.id, label: server.name })),
  );

  const applicationOptions = computed(() => [
    { value: '', label: 'None' },
    ...(data.value?.applications ?? []).map(application => ({
      value: application.id,
      label: application.name,
    })),
  ]);

  const TYPE_LABELS: Record<BackupType, string> = {
    database: 'Database',
    volume: 'Volume',
    configuration: 'Configuration',
  };

  const STATUS: Record<BackupStatus, { label: string; color: string }> = {
    running: { label: 'Running', color: 'default' },
    completed: { label: 'Completed', color: 'live' },
    failed: { label: 'Failed', color: 'failed' },
  };

  const typeOptions = BACKUP_TYPES.map(type => ({ value: type, label: TYPE_LABELS[type] }));

  const VOLUME_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

  const schema = z
    .object({
      type: z.enum(BACKUP_TYPES),
      databaseId: z.string(),
      serverId: z.string(),
      volumeName: z.string().trim(),
      applicationId: z.string(),
    })
    .superRefine((value, ctx) => {
      if (value.type === 'database' && !value.databaseId) {
        ctx.addIssue({ code: 'custom', path: ['databaseId'], message: 'Choose a database' });
      }

      if (value.type === 'volume') {
        if (!value.serverId) {
          ctx.addIssue({ code: 'custom', path: ['serverId'], message: 'Choose a server' });
        }

        if (!value.volumeName) {
          ctx.addIssue({ code: 'custom', path: ['volumeName'], message: 'Enter a volume name' });
        } else if (!VOLUME_NAME_REGEX.test(value.volumeName)) {
          ctx.addIssue({ code: 'custom', path: ['volumeName'], message: 'Invalid volume name' });
        }
      }
    });

  const form = useSchemaForm(
    schema,
    {
      type: 'database' as BackupType,
      databaseId: '',
      serverId: '',
      volumeName: '',
      applicationId: '',
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  watch(
    () => form.values.type,
    () => {
      form.values.databaseId = databaseOptions.value[0]?.value ?? '';
      form.values.serverId = serverOptions.value[0]?.value ?? '';
    },
  );

  const handleCreate = form.submit(async values => {
    const body: CreateBackupBody =
      values.type === 'database'
        ? { type: 'database', databaseId: values.databaseId }
        : values.type === 'volume'
          ? {
              type: 'volume',
              serverId: values.serverId,
              volumeName: values.volumeName,
              applicationId: values.applicationId || undefined,
            }
          : { type: 'configuration' };

    await backupsApi.create(body);
    form.reset();
    form.values.databaseId = databaseOptions.value[0]?.value ?? '';
    form.values.serverId = serverOptions.value[0]?.value ?? '';
    await refresh();
  });

  const busy = ref('');

  const handleDownload = async (backup: Backup) => {
    busy.value = `${backup.id}:download`;

    try {
      const blob = await backupsApi.download(backup.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = backup.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notifyError(error, 'Failed to download the backup.');
    } finally {
      busy.value = '';
    }
  };

  const handleRestore = async (backup: Backup) => {
    busy.value = `${backup.id}:restore`;

    try {
      await backupsApi.restore(backup.id);
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to start the restore.');
    } finally {
      busy.value = '';
    }
  };

  const toRemove = ref<Backup | null>(null);
  const confirmRemoveOpen = ref(false);
  const removing = ref(false);

  const openRemove = (backup: Backup) => {
    toRemove.value = backup;
    confirmRemoveOpen.value = true;
  };

  const handleRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;

    try {
      await backupsApi.remove(toRemove.value.id);
      await refresh();
      confirmRemoveOpen.value = false;
      toRemove.value = null;
    } catch (error) {
      notifyError(error, 'Failed to remove the backup.');
    } finally {
      removing.value = false;
    }
  };

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({ title: 'Backups', context: current.value?.name });
  });
</script>

<template>
  <Content>
    <EmptyState
      v-if="!current"
      variant="action"
      title="Select an organization"
      description="Choose or create an organization in the sidebar selector to manage backups."
    />

    <div v-else class="flex max-w-215 flex-col gap-4.5">
      <Card v-if="canManage" title="New backup" rows>
        <template #right>
          <Segmented v-model="form.values.type" :options="typeOptions" />
        </template>

        <form class="flex flex-col" @submit.prevent="handleCreate">
          <Select
            v-if="form.values.type === 'database'"
            v-model="form.values.databaseId"
            label="Database"
            :options="databaseOptions"
            boxed
          />

          <template v-else-if="form.values.type === 'volume'">
            <Select v-model="form.values.serverId" label="Server" :options="serverOptions" boxed />
            <Input
              v-model="form.values.volumeName"
              label="Volume name"
              placeholder="zydock-my-app-data"
              mono
              boxed
              :call-error="form.errors.value.volumeName"
            />
            <Select
              v-model="form.values.applicationId"
              label="Application"
              :options="applicationOptions"
              boxed
            />
          </template>

          <p v-else class="px-4.25 py-3.5 text-[13px] text-ink-2">
            Exports the organization's configuration — no application data.
          </p>

          <Alert
            v-if="form.values.type === 'database' && !databaseOptions.length"
            theme="warning"
            class="mx-4.25 mt-3"
          >
            No databases available.
          </Alert>
          <Alert
            v-if="form.values.type === 'volume' && !serverOptions.length"
            theme="warning"
            class="mx-4.25 mt-3"
          >
            No servers available.
          </Alert>

          <div class="flex justify-end px-4.25 py-3.25">
            <Button
              theme="primary"
              size="sm"
              type="submit"
              :disabled="
                form.loading.value ||
                (form.values.type === 'database' && !databaseOptions.length) ||
                (form.values.type === 'volume' && !serverOptions.length)
              "
            >
              <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
              Create backup
            </Button>
          </div>
        </form>
      </Card>

      <div v-if="status === 'pending'" class="flex flex-col gap-2">
        <Skeleton v-for="index in 3" :key="index" class="h-14 rounded-card" />
      </div>

      <EmptyState
        v-else-if="!backups.length"
        title="No backups yet"
        description="Create a backup of a database, volume or the configuration."
      />

      <Card v-else content-class="p-0">
        <Row
          v-for="backup in backups"
          :key="backup.id"
          as="div"
          class="grid-cols-[1.2fr_0.7fr_0.6fr_auto]"
        >
          <div class="min-w-0 flex flex-wrap items-center gap-2">
            <span class="truncate font-mono text-[13.5px] text-ink">{{ backup.label }}</span>
            <Tag>{{ TYPE_LABELS[backup.type] }}</Tag>
            <Tag :color="STATUS[backup.status].color">{{ STATUS[backup.status].label }}</Tag>
            <Tag v-if="backup.restoreStatus === 'running'" color="attn">Restoring</Tag>
          </div>

          <div class="truncate text-caption text-ink-2">
            {{ formatBytes(backup.sizeBytes) }} · {{ formatDuration(backup.durationMs) }}
          </div>

          <div class="truncate text-caption text-failed">
            <template v-if="backup.error">{{ backup.error }}</template>
            <template v-else-if="backup.restoreError">
              Restore failed: {{ backup.restoreError }}
            </template>
          </div>

          <div class="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              v-if="backup.status === 'completed'"
              theme="quiet"
              size="xs"
              :disabled="busy === `${backup.id}:download`"
              @click="handleDownload(backup)"
            >
              <Icon v-if="busy === `${backup.id}:download`" name="svg-spinners:tadpole" size="14" />
              Download
            </Button>
            <Button
              v-if="canManage && backup.status === 'completed' && backup.type !== 'configuration'"
              theme="secondary"
              size="xs"
              :disabled="backup.restoreStatus === 'running' || busy === `${backup.id}:restore`"
              @click="handleRestore(backup)"
            >
              <Icon v-if="busy === `${backup.id}:restore`" name="svg-spinners:tadpole" size="14" />
              Restore
            </Button>
            <button
              v-if="canManage"
              type="button"
              title="Remove backup"
              class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
              @click="openRemove(backup)"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </Row>
      </Card>
    </div>

    <Confirm
      v-model:open="confirmRemoveOpen"
      title="Remove backup"
      :message="`Remove “${toRemove?.label}”? This cannot be undone.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="handleRemove"
    />
  </Content>
</template>
