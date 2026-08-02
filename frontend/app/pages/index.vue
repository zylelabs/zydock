<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';
  import {
    useDeployments,
    type Deployment,
    type DeploymentStatus,
  } from '~/composables/services/useDeployments';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects } from '~/composables/services/useProjects';
  import { useServers, type Server, type ServerStatus } from '~/composables/services/useServers';
  import { formatDuration } from '~/utils';

  useHead({ title: 'Overview' });

  const session = useSessionStore();
  const { current } = useOrganizations();

  const { list: listServers } = useServers();
  const { list: listProjects } = useProjects();
  const { list: listApplications } = useApplications();
  const { list: listDeployments } = useDeployments();

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

  const { data, refresh, status } = await useAsyncData(
    'overview',
    () => (session.organizationId ? load() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
  );

  const overview = computed(() => data.value ?? empty);

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

  const deploymentsSucceeded = computed(
    () => overview.value.deployments.filter(deployment => deployment.status === 'succeeded').length,
  );

  const applicationNames = computed(
    () =>
      new Map(overview.value.applications.map(application => [application.id, application.name])),
  );

  const applicationName = (applicationId: string) =>
    applicationNames.value.get(applicationId) ?? `${applicationId.slice(0, 8)}…`;

  const recentDeployments = computed(() => overview.value.deployments.slice(0, 5));

  const SERVER_STATUS: Record<ServerStatus, { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'default' },
    validating: { label: 'Validating', color: 'blue' },
    provisioning: { label: 'Provisioning', color: 'blue' },
    online: { label: 'Online', color: 'green' },
    offline: { label: 'Offline', color: 'yellow' },
    failed: { label: 'Failed', color: 'red' },
  };

  const DEPLOYMENT_STATUS: Record<DeploymentStatus, { label: string; color: string }> = {
    queued: { label: 'Queued', color: 'default' },
    running: { label: 'Running', color: 'blue' },
    succeeded: { label: 'Succeeded', color: 'green' },
    failed: { label: 'Failed', color: 'red' },
  };

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');
</script>

<template>
  <Content>
    <Header title="Overview" description="Summary of the current organization.">
      <template #right>
        <Button
          v-if="current"
          theme="secondary"
          class="my-auto"
          :disabled="status === 'pending'"
          @click="refresh()"
        >
          <Icon v-if="status === 'pending'" name="svg-spinners:tadpole" size="16" />
          <Icon v-else name="lucide:refresh-cw" size="16" />
          Refresh
        </Button>
      </template>
    </Header>

    <Card v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">
        Choose or create an organization in the sidebar selector to see its summary.
      </p>
    </Card>

    <Card v-else-if="status === 'pending'" title="Overview">
      <p class="text-sm text-content-muted">Loading…</p>
    </Card>

    <div
      v-else-if="!hasResources"
      class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-field-border bg-surface-sunken px-6 py-12 text-center"
    >
      <Icon name="lucide:layout-dashboard" class="size-8 text-content-dim" />
      <div>
        <h3 class="text-content-strong">Nothing here yet</h3>
        <p class="mt-1 text-sm text-content-muted">
          Add a server and create a project to start deploying applications.
        </p>
      </div>
      <div class="mt-1 flex gap-2">
        <Button theme="secondary" to="/servers">
          <Icon name="lucide:server" size="18" />
          Servers
        </Button>
        <Button theme="primary" to="/projects">
          <Icon name="proicons:add" size="18" />
          Projects
        </Button>
      </div>
    </div>

    <div v-else class="flex flex-col gap-6">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div
          class="rounded-xl border border-surface-border bg-surface-raised p-4 shadow-soft backdrop-blur-sm"
        >
          <p class="text-sm text-content-muted">Servers</p>
          <p class="mt-1 text-2xl font-semibold text-content-strong">
            {{ overview.serverTotal }}
          </p>
          <p class="mt-1 text-xs text-content-muted">{{ serversOnline }} online</p>
        </div>

        <div
          class="rounded-xl border border-surface-border bg-surface-raised p-4 shadow-soft backdrop-blur-sm"
        >
          <p class="text-sm text-content-muted">Projects</p>
          <p class="mt-1 text-2xl font-semibold text-content-strong">
            {{ overview.projectTotal }}
          </p>
        </div>

        <div
          class="rounded-xl border border-surface-border bg-surface-raised p-4 shadow-soft backdrop-blur-sm"
        >
          <p class="text-sm text-content-muted">Applications</p>
          <p class="mt-1 text-2xl font-semibold text-content-strong">
            {{ overview.applicationTotal }}
          </p>
          <p class="mt-1 text-xs text-content-muted">{{ applicationsRunning }} running</p>
        </div>

        <div
          class="rounded-xl border border-surface-border bg-surface-raised p-4 shadow-soft backdrop-blur-sm"
        >
          <p class="text-sm text-content-muted">Deploys</p>
          <p class="mt-1 text-2xl font-semibold text-content-strong">
            {{ overview.deploymentTotal }}
          </p>
          <p class="mt-1 text-xs text-content-muted">
            {{ deploymentsSucceeded }} succeeded in the last {{ overview.deployments.length }}
          </p>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <Card title="Recent deployments">
          <p v-if="!recentDeployments.length" class="text-sm text-content-muted">
            No deployments yet.
          </p>

          <ul v-else class="flex flex-col divide-y divide-surface-line">
            <li v-for="deployment in recentDeployments" :key="deployment.id">
              <NuxtLink
                :to="`/applications/${deployment.applicationId}/deployments/${deployment.id}`"
                class="-mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-hover"
              >
                <Tag :color="DEPLOYMENT_STATUS[deployment.status].color">
                  {{ DEPLOYMENT_STATUS[deployment.status].label }}
                </Tag>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm text-content-strong">
                    {{ applicationName(deployment.applicationId) }}
                  </p>
                  <p class="text-xs text-content-muted">
                    {{ deployment.trigger }} · {{ formatWhen(deployment.createdAt) }}
                  </p>
                </div>
                <span class="shrink-0 text-xs text-content-muted">
                  {{ formatDuration(deployment.durationMs) }}
                </span>
              </NuxtLink>
            </li>
          </ul>
        </Card>

        <Card title="Servers">
          <p v-if="!overview.servers.length" class="text-sm text-content-muted">No servers yet.</p>

          <ul v-else class="flex flex-col divide-y divide-surface-line">
            <li v-for="server in overview.servers" :key="server.id">
              <NuxtLink
                :to="`/servers/${server.id}`"
                class="-mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-hover"
              >
                <Tag :color="SERVER_STATUS[server.status].color">
                  {{ SERVER_STATUS[server.status].label }}
                </Tag>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm text-content-strong">{{ server.name }}</p>
                  <p class="truncate text-xs text-content-muted">
                    {{ server.type === 'local' ? 'Local machine' : server.ssh.host }}
                  </p>
                </div>
                <Tag v-if="server.online" color="green">agent</Tag>
              </NuxtLink>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  </Content>
</template>
