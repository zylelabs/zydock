<script setup lang="ts">
  import CreateDatabasePanel from '~/components/databases/CreateDatabasePanel.vue';
  import { useBackups, type Backup } from '~/composables/services/useBackups';
  import {
    useDatabases,
    type Database,
    type DatabaseStatsItem,
  } from '~/composables/services/useDatabases';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useServers, type Server } from '~/composables/services/useServers';
  import { formatBytes } from '~/utils';

  useHead({ title: 'Databases' });

  const session = useSessionStore();
  const { current } = useOrganizations();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const databasesApi = useDatabases();
  const serversApi = useServers();
  const backupsApi = useBackups();

  const empty = {
    databases: [] as Database[],
    servers: [] as Server[],
    backups: [] as Backup[],
  };

  const load = async () => {
    const [databases, servers, backups] = await Promise.all([
      databasesApi.list(),
      serversApi.list(),
      backupsApi.list({ type: 'database', size: 100 }),
    ]);

    return { databases: databases.items, servers: servers.items, backups: backups.items };
  };

  const { getCachedData, markFetched } = useNavigationCache();

  const { data, refresh, status } = useLazyAsyncData(
    'databases-list',
    async () => {
      const result = session.organizationId ? await load() : empty;

      markFetched('databases-list');

      return result;
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => empty,
      getCachedData: key => getCachedData(key),
    },
  );

  const databases = computed(() => data.value?.databases ?? []);
  const servers = computed(() => data.value?.servers ?? []);
  const backups = computed(() => data.value?.backups ?? []);

  const isFirstLoad = useFirstLoad(status);

  const statsByDatabase = reactive(new Map<string, DatabaseStatsItem>());
  const statsLoaded = ref(false);

  const loadStats = async () => {
    if (!session.organizationId) {
      return;
    }

    try {
      const result = await databasesApi.stats();

      statsByDatabase.clear();
      result.items.forEach(item => statsByDatabase.set(item.databaseId, item));
    } finally {
      statsLoaded.value = true;
    }
  };

  watch(
    databases,
    items => {
      if (!session.organizationId || !items.length) {
        statsByDatabase.clear();
        statsLoaded.value = !session.organizationId;

        return;
      }

      loadStats();
    },
    { immediate: true },
  );

  const sumStats = (
    field: 'sizeBytes' | 'diskTotalBytes' | 'connections' | 'maxConnections' | 'peakConnections',
  ) =>
    databases.value.reduce((total, database) => {
      const value = statsByDatabase.get(database.id)?.[field];

      return typeof value === 'number' ? total + value : total;
    }, 0);

  const runningCount = computed(
    () => databases.value.filter(database => database.status === 'running').length,
  );

  const totalStorage = computed(() => sumStats('sizeBytes'));
  const totalDiskCapacity = computed(() => sumStats('diskTotalBytes'));
  const totalConnections = computed(() => sumStats('connections'));
  const totalMaxConnections = computed(() => sumStats('maxConnections'));
  const totalPeakConnections = computed(() => sumStats('peakConnections'));
  const hasPeakConnections = computed(() =>
    databases.value.some(
      database => statsByDatabase.get(database.id)?.peakConnections !== undefined,
    ),
  );

  const connectionsNote = computed(() =>
    hasPeakConnections.value
      ? `of ${totalMaxConnections.value} · peak ${totalPeakConnections.value}`
      : `of ${totalMaxConnections.value}`,
  );

  const completedBackups = computed(() =>
    backups.value
      .filter(backup => backup.status === 'completed' && backup.finishedAt)
      .sort(
        (a, b) =>
          new Date(b.finishedAt as string).getTime() - new Date(a.finishedAt as string).getTime(),
      ),
  );

  const lastBackupValue = computed(() => {
    const latest = completedBackups.value[0];

    return latest
      ? new Date(latest.finishedAt as string).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Never';
  });

  const lastBackupNote = computed(() => {
    if (!backups.value.length) {
      return undefined;
    }

    const failed = backups.value.filter(backup => backup.status === 'failed').length;

    return failed ? `${failed} failed` : 'all healthy';
  });

  const serverName = (database: Database) =>
    servers.value.find(server => server.id === database.serverId)?.name;

  const toast = useToast();

  const adding = ref(false);

  const openAdd = () => {
    adding.value = true;
  };

  const handleCreated = async (database: Database) => {
    toast.success({ title: 'Database created', message: `${database.name} is provisioning.` });
    await refresh();
    navigateTo(`/databases/${database.id}`);
  };

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'Databases',
      context: current.value?.name,
      action:
        current.value && canManage.value && !adding.value
          ? { label: 'New database', icon: 'proicons:add', onClick: openAdd }
          : undefined,
    });
  });
</script>

<template>
  <Content>
    <EmptyState
      v-if="!current"
      variant="action"
      title="Select an organization"
      description="Choose or create an organization in the sidebar selector to see its databases."
    />

    <div v-else class="flex flex-col gap-4.5">
      <CreateDatabasePanel v-model:open="adding" :servers="servers" @created="handleCreated" />

      <div class="grid grid-cols-4 gap-3.5">
        <Metric
          label="Databases"
          :value="`${databases.length}`"
          :note="`${runningCount} running`"
        />

        <div class="rounded-card border border-edge bg-card px-4.25 py-3.75">
          <div class="text-caption text-ink-2">Storage used</div>
          <div class="my-1.5 flex items-baseline gap-2">
            <Skeleton v-if="!statsLoaded" class="h-7 w-20" />
            <template v-else>
              <span class="text-metric text-ink">{{ formatBytes(totalStorage) }}</span>
              <span class="text-caption text-ink-3">of {{ formatBytes(totalDiskCapacity) }}</span>
            </template>
          </div>
        </div>

        <div class="rounded-card border border-edge bg-card px-4.25 py-3.75">
          <div class="text-caption text-ink-2">Connections</div>
          <div class="my-1.5 flex items-baseline gap-2">
            <Skeleton v-if="!statsLoaded" class="h-7 w-20" />
            <template v-else>
              <span class="text-metric text-ink">{{ totalConnections }}</span>
              <span class="text-caption text-ink-3">{{ connectionsNote }}</span>
            </template>
          </div>
        </div>

        <Metric label="Last backup" :value="lastBackupValue" :note="lastBackupNote" />
      </div>

      <div v-if="isFirstLoad" class="flex flex-col gap-2">
        <Skeleton v-for="index in 4" :key="index" class="h-16" />
      </div>

      <EmptyState
        v-else-if="!databases.length"
        variant="action"
        title="No databases yet."
        description="Create a database and it provisions on the server you pick."
      >
        <Button v-if="canManage" theme="primary" @click="openAdd">New database</Button>
      </EmptyState>

      <Card v-else content-class="p-0">
        <div
          class="grid grid-cols-[1.3fr_1.1fr_0.7fr_0.9fr_0.8fr] gap-4.25 border-b border-hairline px-4.25 py-2.5 text-label text-ink-3 uppercase"
        >
          <div>Database</div>
          <div>Host</div>
          <div>Size</div>
          <div>Connections</div>
          <div>Server</div>
        </div>

        <DatabaseRow
          v-for="database in databases"
          :key="database.id"
          :database="database"
          :stats="statsByDatabase.get(database.id)"
          :server="serverName(database)"
        />
      </Card>
    </div>
  </Content>
</template>
