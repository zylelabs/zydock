<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';
  import { useDeployments, type Deployment } from '~/composables/services/useDeployments';
  import { useMetrics, type SystemMetrics } from '~/composables/services/useMetrics';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects, type Environment, type Project } from '~/composables/services/useProjects';
  import { serverStatusDot, useServers, type Server } from '~/composables/services/useServers';

  useHead({ title: 'Applications' });

  const session = useSessionStore();
  const { current } = useOrganizations();

  const { list: listApplications } = useApplications();
  const { list: listProjects, listEnvironments } = useProjects();
  const { list: listServers } = useServers();
  const { list: listDeployments } = useDeployments();
  const { serverMetrics } = useMetrics();

  const load = async () => {
    const [applications, projects, servers, deployments] = await Promise.all([
      listApplications(),
      listProjects(),
      listServers(),
      listDeployments(),
    ]);

    const environmentLists = await Promise.all(
      projects.items.map(project => listEnvironments(project.id)),
    );

    const usedServerIds = new Set(applications.items.map(application => application.serverId));
    const metricsByServer = new Map<string, SystemMetrics>();

    await Promise.all(
      servers.items
        .filter(server => usedServerIds.has(server.id))
        .map(async server => {
          try {
            metricsByServer.set(server.id, await serverMetrics(server.id));
          } catch {
            // metrics unavailable for an offline or unreachable server
          }
        }),
    );

    return {
      applications: applications.items,
      metricsByServer,
      projects: projects.items,
      environmentNames: new Map(
        environmentLists
          .flatMap(result => result.items)
          .map((env: Environment) => [env.id, env.name]),
      ),
      servers: servers.items,
      lastDeployAt: new Map<string, string>(
        deployments.items.reduce<[string, string][]>((entries, deployment: Deployment) => {
          if (!entries.some(([applicationId]) => applicationId === deployment.applicationId)) {
            entries.push([deployment.applicationId, deployment.createdAt]);
          }

          return entries;
        }, []),
      ),
    };
  };

  const empty = {
    applications: [] as Application[],
    metricsByServer: new Map<string, SystemMetrics>(),
    projects: [] as Project[],
    environmentNames: new Map<string, string>(),
    servers: [] as Server[],
    lastDeployAt: new Map<string, string>(),
  };

  const { data, status } = await useAsyncData(
    'applications-list',
    () => (session.organizationId ? load() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
  );

  const applications = computed(() => data.value?.applications ?? []);

  const hasLoadedOnce = ref(false);

  watch(
    status,
    value => {
      if (value !== 'pending') {
        hasLoadedOnce.value = true;
      }
    },
    { immediate: true },
  );

  const viewOptions = [
    { label: 'List', value: 'list' },
    { label: 'By project', value: 'project' },
    { label: 'By server', value: 'server' },
  ];

  const viewMode = ref<'list' | 'server' | 'project'>('list');

  const groupBy = (key: (application: Application) => string) => {
    const buckets = new Map<string, Application[]>();

    for (const application of applications.value) {
      const bucket = buckets.get(key(application)) ?? [];

      bucket.push(application);
      buckets.set(key(application), bucket);
    }

    return buckets;
  };

  const serverGroups = computed(() => {
    const buckets = groupBy(application => application.serverId);

    return (data.value?.servers ?? [])
      .filter(server => buckets.has(server.id))
      .map(server => ({ server, applications: buckets.get(server.id) ?? [] }));
  });

  const projectGroups = computed(() => {
    const buckets = groupBy(application => application.projectId);

    return (data.value?.projects ?? [])
      .filter(project => buckets.has(project.id))
      .map(project => ({ project, applications: buckets.get(project.id) ?? [] }));
  });

  const projectName = (application: Application) =>
    data.value?.projects.find(project => project.id === application.projectId)?.name ?? '—';

  const environmentName = (application: Application) =>
    data.value?.environmentNames.get(application.environmentId) ?? '—';

  const projectAndEnv = (application: Application) =>
    `${projectName(application)} · ${environmentName(application)}`;

  const serverName = (application: Application) =>
    data.value?.servers.find(server => server.id === application.serverId)?.name ?? '—';

  const serverHost = (server: Server) =>
    server.type === 'local' ? `${server.agent.host}:${server.agent.port}` : (server.ssh.host ?? '');

  const metricsFor = (server: Server) => data.value?.metricsByServer.get(server.id) ?? null;

  const percent = (used = 0, total = 0) => (total ? Math.round((used / total) * 100) : 0);

  const environmentCount = (group: { applications: Application[] }) =>
    new Set(group.applications.map(application => application.environmentId)).size;

  const lastDeploy = (application: Application) => {
    const value = data.value?.lastDeployAt.get(application.id);

    return value ? new Date(value).toLocaleDateString('en-US') : 'Never deployed';
  };

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'Applications',
      context: current.value?.name,
      action: {
        label: 'New application',
        icon: 'proicons:add',
        onClick: () => navigateTo('/applications/new'),
      },
    });
  });
</script>

<template>
  <Content>
    <EmptyState
      v-if="!current"
      variant="action"
      title="Select an organization"
      description="Choose or create an organization in the sidebar selector to see its applications."
    />

    <div v-else class="flex flex-col gap-4.5">
      <div v-if="applications.length" class="flex items-center justify-between">
        <Segmented v-model="viewMode" :options="viewOptions" />
      </div>

      <div v-if="status === 'pending' && !hasLoadedOnce" class="flex flex-col gap-2">
        <Skeleton v-for="index in 4" :key="index" class="h-16" />
      </div>

      <EmptyState
        v-else-if="!applications.length"
        variant="action"
        title="No applications yet."
        description="The wizard walks you through the repository, the project and the server."
      >
        <Button theme="primary" to="/applications/new">New application</Button>
      </EmptyState>

      <div v-else-if="viewMode === 'server'" class="flex flex-col gap-4.5">
        <Card
          v-for="group in serverGroups"
          :key="group.server.id"
          :title="group.server.name"
          :description="serverHost(group.server)"
          header-class="items-center"
          content-class="p-0"
        >
          <template #right>
            <div class="flex items-center gap-2.5">
              <Tag v-if="group.server.type === 'local'">local</Tag>
              <StatusDot :status="serverStatusDot(group.server.status)" />
              <Button theme="quiet" size="xs" :to="`/servers/${group.server.id}`">
                <Icon name="lucide:chevron-right" size="16" />
              </Button>
            </div>
          </template>

          <ApplicationRow
            v-for="application in group.applications"
            :key="application.id"
            :application="application"
            :context="projectAndEnv(application)"
            :last-deploy="lastDeploy(application)"
          />

          <template #footer>
            <div v-if="metricsFor(group.server)" class="grid w-full grid-cols-2 gap-3.5">
              <Gauge
                label="CPU"
                :value="`${Math.round(metricsFor(group.server)?.cpuPercent ?? 0)}%`"
                :percent="metricsFor(group.server)?.cpuPercent ?? 0"
              />
              <Gauge
                label="Memory"
                :value="`${percent(metricsFor(group.server)?.memoryUsedMb, metricsFor(group.server)?.memoryTotalMb)}%`"
                :percent="
                  percent(
                    metricsFor(group.server)?.memoryUsedMb,
                    metricsFor(group.server)?.memoryTotalMb,
                  )
                "
              />
            </div>
            <div v-else class="text-caption text-ink-3">Metrics unavailable</div>
          </template>
        </Card>
      </div>

      <div v-else-if="viewMode === 'project'" class="flex flex-col gap-4.5">
        <Card
          v-for="group in projectGroups"
          :key="group.project.id"
          :title="group.project.name"
          :description="
            group.project.description ||
            `${group.applications.length} applications · ${environmentCount(group)} environments`
          "
          header-class="items-center"
          content-class="p-0"
        >
          <template #right>
            <Button theme="quiet" size="xs" :to="`/projects/${group.project.id}`">
              <Icon name="lucide:chevron-right" size="16" />
            </Button>
          </template>

          <ApplicationRow
            v-for="application in group.applications"
            :key="application.id"
            :application="application"
            :context="environmentName(application)"
            :server="serverName(application)"
            :last-deploy="lastDeploy(application)"
          />
        </Card>
      </div>

      <Card v-else content-class="p-0">
        <ApplicationRow
          v-for="application in applications"
          :key="application.id"
          :application="application"
          :context="projectAndEnv(application)"
          :server="serverName(application)"
          :last-deploy="lastDeploy(application)"
        />
      </Card>
    </div>
  </Content>
</template>
