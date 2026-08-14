<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';
  import {
    deploymentStatusDot,
    useDeployments,
    type Deployment,
  } from '~/composables/services/useDeployments';
  import { useMetrics, type SystemMetrics } from '~/composables/services/useMetrics';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects } from '~/composables/services/useProjects';
  import { serverStatusDot, useServers, type Server } from '~/composables/services/useServers';
  import { formatDuration } from '~/utils';

  useHead({ title: 'Overview' });

  const session = useSessionStore();
  const { current } = useOrganizations();

  const { list: listServers } = useServers();
  const { list: listProjects } = useProjects();
  const { list: listApplications } = useApplications();
  const { list: listDeployments } = useDeployments();
  const { serverMetrics } = useMetrics();

  const empty = {
    servers: [] as Server[],
    serverTotal: 0,
    projectTotal: 0,
    applications: [] as Application[],
    applicationTotal: 0,
    deployments: [] as Deployment[],
    deploymentTotal: 0,
  };

  const load = async () => {
    const [servers, projects, applications, deployments] = await Promise.all([
      listServers(),
      listProjects(),
      listApplications(),
      listDeployments(),
    ]);

    return {
      servers: servers.items,
      serverTotal: servers.total,
      projectTotal: projects.total,
      applications: applications.items,
      applicationTotal: applications.total,
      deployments: deployments.items,
      deploymentTotal: deployments.total,
    };
  };

  const { data, refresh, status } = useLazyAsyncData(
    'overview',
    () => (session.organizationId ? load() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
  );

  const overview = computed(() => data.value ?? empty);

  const hasLoadedOnce = useFirstLoad(status);

  const hasResources = computed(
    () =>
      overview.value.serverTotal > 0 ||
      overview.value.projectTotal > 0 ||
      overview.value.applicationTotal > 0,
  );

  const serversOnline = computed(
    () => overview.value.servers.filter(server => server.status === 'online').length,
  );

  const applicationsRunning = computed(
    () =>
      overview.value.applications.filter(application => application.status === 'running').length,
  );

  const deploymentsLast24h = computed(() => {
    const since = Date.now() - 24 * 60 * 60 * 1000;

    return overview.value.deployments.filter(
      deployment => new Date(deployment.createdAt).getTime() >= since,
    );
  });

  const deploymentsSucceeded = computed(
    () => deploymentsLast24h.value.filter(deployment => deployment.status === 'succeeded').length,
  );

  const stats = computed(() => [
    {
      label: 'Servers',
      value: String(overview.value.serverTotal),
      note: `${serversOnline.value} online`,
    },
    { label: 'Projects', value: String(overview.value.projectTotal) },
    {
      label: 'Applications',
      value: String(overview.value.applicationTotal),
      note: `${applicationsRunning.value} running`,
    },
    {
      label: 'Deploys · 24h',
      value: String(deploymentsLast24h.value.length),
      note: `${deploymentsSucceeded.value} succeeded`,
    },
  ]);

  const percent = (used = 0, total = 0) => (total ? Math.round((used / total) * 100) : 0);

  const metricsByServer = reactive(new Map<string, SystemMetrics>());
  const metricsLoading = reactive(new Set<string>());

  const loadServerMetrics = async (serverId: string) => {
    if (metricsByServer.has(serverId) || metricsLoading.has(serverId)) {
      return;
    }

    metricsLoading.add(serverId);

    try {
      metricsByServer.set(serverId, await serverMetrics(serverId));
    } catch {
      // metrics unavailable for an offline or unreachable server
    } finally {
      metricsLoading.delete(serverId);
    }
  };

  watch(
    () => overview.value.servers,
    servers => {
      servers.forEach(server => loadServerMetrics(server.id));
    },
    { immediate: true },
  );

  const serverLoad = (server: Server) => {
    const metrics = metricsByServer.get(server.id);

    if (!metrics) {
      return null;
    }

    return `${Math.round(metrics.cpuPercent ?? 0)}% · ${percent(metrics.memoryUsedMb, metrics.memoryTotalMb)}%`;
  };

  const applicationNames = computed(
    () =>
      new Map(overview.value.applications.map(application => [application.id, application.name])),
  );

  const applicationName = (applicationId: string) =>
    applicationNames.value.get(applicationId) ?? `${applicationId.slice(0, 8)}…`;

  const recentDeployments = computed(() => overview.value.deployments.slice(0, 5));

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');

  const { set: setNavbar } = useNavbar({ title: 'Overview' });

  watchEffect(() => {
    setNavbar({
      title: 'Overview',
      context: current.value?.name,
      action: current.value
        ? {
            label: 'Refresh',
            icon: 'lucide:refresh-cw',
            theme: 'secondary',
            loading: status.value === 'pending',
            onClick: () => refresh(),
          }
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
      description="Choose or create an organization in the sidebar selector to see its summary."
    />

    <div v-else-if="status === 'pending' && !hasLoadedOnce" class="flex flex-col gap-5">
      <div class="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton v-for="index in 4" :key="index" class="h-21" />
      </div>
      <Skeleton class="h-64" />
    </div>

    <EmptyState
      v-else-if="!hasResources"
      variant="action"
      centered
      title="Nothing running yet."
      description="Register a machine first, then point a repository at it. The two steps take about four minutes together."
    >
      <Button theme="primary" to="/servers">Add a server</Button>
      <Button theme="secondary" to="/projects">Create a project</Button>
    </EmptyState>

    <div v-else class="flex flex-col gap-5">
      <div class="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          v-for="stat in stats"
          :key="stat.label"
          :label="stat.label"
          :value="stat.value"
          :note="stat.note"
        />
      </div>

      <div class="grid gap-4.5 lg:grid-cols-[1.5fr_1fr]">
        <Card title="Recent deployments" content-class="p-0">
          <p
            v-if="!recentDeployments.length"
            class="px-4.5 py-6 text-center text-caption text-ink-2"
          >
            No deployments yet.
          </p>

          <template v-else>
            <Row
              v-for="deployment in recentDeployments"
              :key="deployment.id"
              :to="`/applications/${deployment.applicationId}/deployments/${deployment.id}`"
              class="grid-cols-[auto_1fr_auto_auto]"
            >
              <StatusDot :status="deploymentStatusDot(deployment.status)" />
              <div class="min-w-0">
                <div class="truncate text-[13.5px] font-medium text-ink">
                  {{ applicationName(deployment.applicationId) }}
                </div>
                <div class="truncate text-caption text-ink-2">
                  {{ deployment.trigger }} · {{ formatWhen(deployment.createdAt) }}
                </div>
              </div>
              <div v-if="deployment.commit" class="font-mono text-caption text-ink-2">
                {{ deployment.commit.sha.slice(0, 7) }}
              </div>
              <div class="text-caption text-ink-2">{{ formatDuration(deployment.durationMs) }}</div>
            </Row>
          </template>
        </Card>

        <Card title="Servers" content-class="p-0">
          <p
            v-if="!overview.servers.length"
            class="px-4.5 py-6 text-center text-caption text-ink-2"
          >
            No servers yet.
          </p>

          <template v-else>
            <Row
              v-for="server in overview.servers"
              :key="server.id"
              :to="`/servers/${server.id}`"
              class="grid-cols-[auto_1fr_auto]"
            >
              <StatusDot :status="serverStatusDot(server.status)" />
              <div class="min-w-0">
                <div class="truncate text-[13.5px] font-medium text-ink">{{ server.name }}</div>
                <div class="truncate font-mono text-caption text-ink-2">
                  {{ server.type === 'local' ? 'Local machine' : server.ssh.host }}
                </div>
              </div>
              <Skeleton v-if="metricsLoading.has(server.id)" class="h-3 w-16 shrink-0" />
              <div v-else-if="serverLoad(server)" class="text-caption text-ink-2">
                {{ serverLoad(server) }}
              </div>
            </Row>
          </template>
        </Card>
      </div>
    </div>
  </Content>
</template>
