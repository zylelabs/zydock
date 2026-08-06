<script setup lang="ts">
  import { applicationStatusDot, useApplications } from '~/composables/services/useApplications';
  import { useDeployments, type Deployment } from '~/composables/services/useDeployments';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects, type Environment } from '~/composables/services/useProjects';
  import { useServers } from '~/composables/services/useServers';

  useHead({ title: 'Applications' });

  const session = useSessionStore();
  const { current } = useOrganizations();

  const { list: listApplications } = useApplications();
  const { list: listProjects, listEnvironments } = useProjects();
  const { list: listServers } = useServers();
  const { list: listDeployments } = useDeployments();

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

    return {
      applications: applications.items,
      projectNames: new Map(projects.items.map(project => [project.id, project.name])),
      environmentNames: new Map(
        environmentLists
          .flatMap(result => result.items)
          .map((env: Environment) => [env.id, env.name]),
      ),
      serverNames: new Map(servers.items.map(server => [server.id, server.name])),
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
    applications: [],
    projectNames: new Map<string, string>(),
    environmentNames: new Map<string, string>(),
    serverNames: new Map<string, string>(),
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

  const projectAndEnv = (application: (typeof applications.value)[number]) => {
    const project = data.value?.projectNames.get(application.projectId) ?? '—';
    const environment = data.value?.environmentNames.get(application.environmentId) ?? '—';

    return `${project} · ${environment}`;
  };

  const serverName = (application: (typeof applications.value)[number]) =>
    data.value?.serverNames.get(application.serverId) ?? '—';

  const lastDeploy = (application: (typeof applications.value)[number]) => {
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

    <div v-else-if="status === 'pending' && !hasLoadedOnce" class="flex flex-col gap-2">
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

    <Card v-else content-class="p-0">
      <Row
        v-for="application in applications"
        :key="application.id"
        :to="`/applications/${application.id}`"
        class="grid-cols-[1.3fr_1.1fr_0.8fr_0.8fr_auto]"
      >
        <div class="flex min-w-0 items-center gap-2.75">
          <StatusDot :status="applicationStatusDot(application.status)" />
          <div class="min-w-0">
            <div class="truncate text-[14px] font-medium text-ink">{{ application.name }}</div>
            <div class="truncate font-mono text-caption text-ink-2">{{ application.slug }}</div>
          </div>
        </div>
        <div class="truncate font-mono text-[13px] text-ink-2">
          {{ application.git.repository }}
        </div>
        <div class="truncate text-[13px] text-ink-2">{{ projectAndEnv(application) }}</div>
        <div class="truncate text-[13px] text-ink-2">{{ serverName(application) }}</div>
        <div class="text-right text-caption text-ink-2">{{ lastDeploy(application) }}</div>
      </Row>
    </Card>
  </Content>
</template>
