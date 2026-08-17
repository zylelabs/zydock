<script setup lang="ts">
  import {
    useBackups,
    type Backup,
    type CreateBackupBody,
  } from '~/composables/services/useBackups';
  import type { Database } from '~/composables/services/useDatabases';

  const props = defineProps<{ database: Database; canManage: boolean }>();

  const session = useSessionStore();
  const toast = useToast();
  const backupsApi = useBackups();

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({ title: 'Error', message: (error as { message?: string }).message || fallback });
  };

  const { getCachedData, markFetched } = useNavigationCache();

  const { data, refresh, status } = useLazyAsyncData(
    () => `database-${props.database.id}-backups`,
    async () => {
      if (!session.organizationId) {
        return [] as Backup[];
      }

      const { items } = await backupsApi.list({ databaseId: props.database.id, type: 'database' });

      markFetched(`database-${props.database.id}-backups`);

      return items;
    },
    {
      server: false,
      watch: [() => session.organizationId, () => props.database.id],
      default: () => [],
      getCachedData: key => getCachedData(key),
    },
  );

  const backups = computed(() => data.value ?? []);
  const backupsFirstLoad = useFirstLoad(status);

  const creating = ref(false);

  const handleCreate = async () => {
    creating.value = true;

    try {
      const body: CreateBackupBody = { type: 'database', databaseId: props.database.id };

      await backupsApi.create(body);
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to create the backup.');
    } finally {
      creating.value = false;
    }
  };

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
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <div v-if="canManage && backups.length" class="flex justify-end">
      <Button theme="primary" size="sm" :disabled="creating" @click="handleCreate">
        <Icon v-if="creating" name="svg-spinners:tadpole" size="16" />
        Back up now
      </Button>
    </div>

    <div v-if="backupsFirstLoad" class="flex flex-col gap-2">
      <Skeleton v-for="index in 3" :key="index" class="h-14 rounded-card" />
    </div>

    <EmptyState
      v-else-if="!backups.length"
      title="No backups yet"
      description="Back up this database to restore it later."
      :action-label="canManage ? 'Back up now' : undefined"
      @action="handleCreate"
    />

    <Card v-else content-class="p-0">
      <BackupRow
        v-for="backup in backups"
        :key="backup.id"
        :backup="backup"
        :can-manage="canManage"
        :busy="busy"
        @download="handleDownload"
        @restore="handleRestore"
        @remove="openRemove"
      />
    </Card>

    <Confirm
      v-model:open="confirmRemoveOpen"
      title="Remove backup"
      :message="`Remove “${toRemove?.label}”? This cannot be undone.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="handleRemove"
    />
  </div>
</template>
