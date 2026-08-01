<script setup lang="ts">
  import { z } from 'zod';
  import { useApplications, type ApplicationStatus } from '~/composables/services/useApplications';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects } from '~/composables/services/useProjects';
  import { useServers } from '~/composables/services/useServers';

  const route = useRoute();
  const toast = useToast();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const projects = useProjects();
  const applications = useApplications();
  const servers = useServers();

  const projectId = computed(() => String(route.params.projectId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({
      title: 'Error',
      message: (error as { message?: string }).message || fallback,
    });
  };

  const { data, refresh } = await useAsyncData(
    () => `project-${projectId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [project, environmentList, serverList, applicationList] = await Promise.all([
        projects.get(projectId.value),
        projects.listEnvironments(projectId.value),
        servers.list(),
        applications.list({ projectId: projectId.value }),
      ]);

      return {
        project: project.project,
        environments: environmentList.items,
        servers: serverList.items,
        applications: applicationList.items,
      };
    },
    { server: false, watch: [() => session.organizationId, projectId] },
  );

  useHead(() => ({ title: data.value?.project.name ?? 'Project' }));

  const environments = computed(() => data.value?.environments ?? []);
  const serverList = computed(() => data.value?.servers ?? []);
  const apps = computed(() => data.value?.applications ?? []);

  const APP_STATUS: Record<ApplicationStatus, { label: string; color: string }> = {
    created: { label: 'Created', color: 'default' },
    deploying: { label: 'Deploying', color: 'blue' },
    running: { label: 'Running', color: 'green' },
    stopped: { label: 'Stopped', color: 'yellow' },
    failed: { label: 'Failed', color: 'red' },
  };

  const projectForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      description: z.string().trim(),
    }),
    { name: '', description: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const editingProject = ref(false);

  const openEditProject = () => {
    if (!data.value) {
      return;
    }

    projectForm.reset();
    projectForm.values.name = data.value.project.name;
    projectForm.values.description = data.value.project.description ?? '';
    editingProject.value = true;
  };

  const handleSaveProject = projectForm.submit(async values => {
    await projects.update(projectId.value, {
      name: values.name,
      description: values.description || undefined,
    });

    await refresh();
    editingProject.value = false;
  });

  const confirmDeleteProjectOpen = ref(false);
  const deletingProject = ref(false);

  const handleDeleteProject = async () => {
    deletingProject.value = true;

    try {
      await projects.remove(projectId.value);
      await navigateTo('/projects');
    } catch (error) {
      notifyError(error, 'Failed to delete the project.');
      deletingProject.value = false;
    }
  };

  const newEnvironment = ref('');
  const addingEnvironment = ref(false);

  const handleAddEnvironment = async () => {
    if (!newEnvironment.value.trim()) {
      return;
    }

    addingEnvironment.value = true;

    try {
      await projects.createEnvironment(projectId.value, newEnvironment.value.trim());
      newEnvironment.value = '';
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to create environment.');
    } finally {
      addingEnvironment.value = false;
    }
  };

  const handleRemoveEnvironment = async (environmentId: string) => {
    try {
      await projects.removeEnvironment(projectId.value, environmentId);
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to remove environment.');
    }
  };

  const renamingEnvironment = ref('');
  const renameValue = ref('');
  const renamingBusy = ref(false);

  const startRenameEnvironment = (environment: { id: string; name: string }) => {
    renamingEnvironment.value = environment.id;
    renameValue.value = environment.name;
  };

  const handleRenameEnvironment = async () => {
    if (!renameValue.value.trim()) {
      return;
    }

    renamingBusy.value = true;

    try {
      await projects.updateEnvironment(
        projectId.value,
        renamingEnvironment.value,
        renameValue.value.trim(),
      );
      renamingEnvironment.value = '';
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to rename environment.');
    } finally {
      renamingBusy.value = false;
    }
  };

  const addingApp = ref(false);

  const appForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      environmentId: z.string().min(1, 'Choose an environment'),
      serverId: z.string().min(1, 'Choose a server'),
      repository: z
        .string()
        .trim()
        .regex(/^[^/\s]+\/[^/\s]+$/, 'Use the owner/repository format'),
      branch: z.string().trim().min(1),
      dockerfilePath: z.string().trim().min(1),
      port: z.string().regex(/^\d+$/, 'Invalid port'),
      autoDeploy: z.boolean(),
      token: z.string().trim(),
    }),
    {
      name: '',
      environmentId: '',
      serverId: '',
      repository: '',
      branch: 'main',
      dockerfilePath: 'Dockerfile',
      port: '3000',
      autoDeploy: true,
      token: '',
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const environmentOptions = computed(() =>
    environments.value.map(environment => ({ value: environment.id, label: environment.name })),
  );
  const serverOptions = computed(() =>
    serverList.value.map(server => ({ value: server.id, label: server.name })),
  );

  const openAddApp = () => {
    appForm.reset();
    appForm.values.environmentId = environments.value[0]?.id ?? '';
    appForm.values.serverId = serverList.value[0]?.id ?? '';
    addingApp.value = true;
  };

  const handleCreateApp = appForm.submit(async values => {
    const { application } = await applications.create({
      name: values.name,
      environmentId: values.environmentId,
      serverId: values.serverId,
      port: Number(values.port),
      git: {
        host: 'github',
        repository: values.repository,
        branch: values.branch,
        dockerfilePath: values.dockerfilePath,
        buildContext: '.',
        autoDeploy: values.autoDeploy,
        token: values.token || undefined,
      },
    });

    addingApp.value = false;
    await navigateTo(`/applications/${application.id}`);
  });
</script>

<template>
  <Content>
    <NuxtLink
      to="/projects"
      class="mb-4 inline-flex items-center gap-1 text-sm text-content-muted transition-colors hover:text-content-strong"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Projects
    </NuxtLink>

    <Header :title="data?.project.name ?? 'Project'" :description="data?.project.description ?? ''">
      <template #right>
        <Button v-if="canManage" theme="ghost" class="my-auto" @click="openEditProject">
          <Icon name="lucide:pencil" size="16" />
          Edit
        </Button>
      </template>
    </Header>

    <div class="flex flex-col gap-6">
      <Card v-if="editingProject" title="Edit project">
        <form class="flex flex-col gap-4" @submit.prevent="handleSaveProject">
          <Input
            v-model="projectForm.values.name"
            label="Name"
            :call-error="projectForm.errors.value.name"
            :disabled="projectForm.loading.value"
          />
          <Input
            v-model="projectForm.values.description"
            label="Description"
            type="textarea"
            :rows="3"
            :disabled="projectForm.loading.value"
          />

          <div class="flex items-center justify-end gap-2">
            <Button theme="ghost" type="button" @click="editingProject = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="projectForm.loading.value">
              <Icon v-if="projectForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Environments">
        <ul class="flex flex-col divide-y divide-surface-line">
          <li
            v-for="environment in environments"
            :key="environment.id"
            class="flex items-center justify-between gap-2 py-2"
          >
            <template v-if="renamingEnvironment === environment.id">
              <div class="flex flex-1 items-center gap-2">
                <Input
                  v-model="renameValue"
                  class="flex-1"
                  compact
                  @keyup.enter="handleRenameEnvironment"
                />
                <Button
                  theme="secondary"
                  type="button"
                  :disabled="renamingBusy"
                  @click="handleRenameEnvironment"
                >
                  <Icon v-if="renamingBusy" name="svg-spinners:tadpole" size="16" />
                  Save
                </Button>
                <Button theme="ghost" type="button" @click="renamingEnvironment = ''">
                  Cancel
                </Button>
              </div>
            </template>

            <template v-else>
              <span class="text-sm text-content">{{ environment.name }}</span>
              <div v-if="canManage" class="flex items-center gap-1">
                <button
                  type="button"
                  title="Rename environment"
                  class="cursor-pointer rounded-lg p-1.5 text-content-muted transition-colors hover:bg-surface-hover hover:text-content-strong"
                  @click="startRenameEnvironment(environment)"
                >
                  <Icon name="lucide:pencil" class="size-4" />
                </button>
                <button
                  v-if="environments.length > 1"
                  type="button"
                  title="Remove environment"
                  class="cursor-pointer rounded-lg p-1.5 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
                  @click="handleRemoveEnvironment(environment.id)"
                >
                  <Icon name="lucide:trash-2" class="size-4" />
                </button>
              </div>
            </template>
          </li>
        </ul>

        <form v-if="canManage" class="mt-3 flex gap-2" @submit.prevent="handleAddEnvironment">
          <Input v-model="newEnvironment" class="flex-1" placeholder="staging" compact />
          <Button theme="secondary" type="submit" :disabled="addingEnvironment">
            <Icon v-if="addingEnvironment" name="svg-spinners:tadpole" size="16" />
            Add
          </Button>
        </form>
      </Card>

      <Card title="Applications">
        <template #right>
          <Button v-if="canManage && !addingApp" theme="primary" @click="openAddApp">
            <Icon name="proicons:add" size="18" />
            New application
          </Button>
        </template>

        <form
          v-if="addingApp"
          class="mb-5 flex flex-col gap-4 rounded-lg border border-surface-border p-4"
          @submit.prevent="handleCreateApp"
        >
          <div class="grid gap-4 sm:grid-cols-2">
            <Input
              v-model="appForm.values.name"
              label="Name"
              placeholder="api"
              :call-error="appForm.errors.value.name"
            />
            <Input
              v-model="appForm.values.repository"
              label="Repository (GitHub)"
              placeholder="owner/repository"
              :call-error="appForm.errors.value.repository"
            />

            <div class="flex flex-col gap-1">
              <Select
                v-model="appForm.values.environmentId"
                label="Environment"
                :options="environmentOptions"
                placeholder="Choose an environment"
              />
              <span v-if="appForm.errors.value.environmentId" class="text-xs text-danger">
                {{ appForm.errors.value.environmentId }}
              </span>
            </div>

            <div class="flex flex-col gap-1">
              <Select
                v-model="appForm.values.serverId"
                label="Server"
                :options="serverOptions"
                placeholder="Choose a server"
              />
              <span v-if="appForm.errors.value.serverId" class="text-xs text-danger">
                {{ appForm.errors.value.serverId }}
              </span>
            </div>

            <Input v-model="appForm.values.branch" label="Branch" />
            <Input v-model="appForm.values.dockerfilePath" label="Dockerfile" />
            <Input
              v-model="appForm.values.port"
              label="Port"
              :call-error="appForm.errors.value.port"
            />
          </div>

          <Input
            v-model="appForm.values.token"
            label="Access token (private repository)"
            password
            placeholder="Leave blank if the repository is public"
          />
          <p class="text-xs text-content-muted">
            GitHub Personal Access Token with repository read access. Stored encrypted.
          </p>

          <Switch v-model="appForm.values.autoDeploy" label="Auto-deploy on every push" />

          <p v-if="!serverOptions.length" class="text-xs text-warning">
            Register a server before creating applications.
          </p>

          <div class="flex justify-end gap-2">
            <Button theme="ghost" type="button" @click="addingApp = false">Cancel</Button>
            <Button
              theme="primary"
              type="submit"
              :disabled="appForm.loading.value || !serverOptions.length"
            >
              <Icon v-if="appForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Create application
            </Button>
          </div>
        </form>

        <p v-if="!apps.length" class="text-sm text-content-muted">
          No applications in this project.
        </p>

        <ul v-else class="flex flex-col divide-y divide-surface-line">
          <li v-for="app in apps" :key="app.id">
            <NuxtLink
              :to="`/applications/${app.id}`"
              class="flex items-center gap-3 py-3 transition-colors hover:text-primary"
            >
              <Icon name="lucide:box" class="size-5 shrink-0 text-content-muted" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-content-strong">{{ app.name }}</p>
                <p class="truncate text-xs text-content-muted">{{ app.git.repository }}</p>
              </div>
              <Tag :color="APP_STATUS[app.status].color">{{ APP_STATUS[app.status].label }}</Tag>
            </NuxtLink>
          </li>
        </ul>
      </Card>

      <Card v-if="canManage && data" title="Danger zone">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-content-muted">
            Deletes this project, its environments and every application inside it. This cannot be
            undone.
          </p>
          <Button theme="danger" class="shrink-0" @click="confirmDeleteProjectOpen = true">
            Delete project
          </Button>
        </div>
      </Card>
    </div>

    <Confirm
      v-model:open="confirmDeleteProjectOpen"
      title="Delete project"
      :message="`Delete “${data?.project.name}”? ${apps.length} application(s) and ${environments.length} environment(s) are removed too. This cannot be undone.`"
      confirm-label="Delete"
      danger
      :loading="deletingProject"
      @confirm="handleDeleteProject"
    />
  </Content>
</template>
