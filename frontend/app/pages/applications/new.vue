<script setup lang="ts">
  import { z } from 'zod';
  import type { GitSourceSelection } from '~/components/git/GitSourcePicker.vue';
  import { useApplications } from '~/composables/services/useApplications';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects, type Environment, type Project } from '~/composables/services/useProjects';
  import { useServers, type Server } from '~/composables/services/useServers';

  useHead({ title: 'New application' });

  const route = useRoute();
  const toast = useToast();
  const session = useSessionStore();
  const { current } = useOrganizations();
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const { list: listProjects, listEnvironments } = useProjects();
  const { list: listServers } = useServers();
  const { create } = useApplications();

  const { data } = await useAsyncData(
    'wizard-context',
    async () => {
      if (!session.organizationId) {
        return { projects: [] as Project[], servers: [] as Server[] };
      }

      const [projectsResult, serversResult] = await Promise.all([listProjects(), listServers()]);

      return { projects: projectsResult.items, servers: serversResult.items };
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => ({ projects: [] as Project[], servers: [] as Server[] }),
    },
  );

  const projects = computed(() => data.value?.projects ?? []);
  const servers = computed(() => data.value?.servers ?? []);
  const environments = ref<Environment[]>([]);

  const baseWizardSchema = z.object({
    sourceMode: z.enum(['github-app', 'token']),
    gitSourceId: z.string().trim(),
    installationId: z.string().trim(),
    repository: z.string().trim(),
    token: z.string().trim(),
    branch: z.string().trim().min(1, 'Enter a branch'),
    name: z.string().trim().min(1, 'Enter a name'),
    projectId: z.string().min(1, 'Choose a project'),
    environmentId: z.string().min(1, 'Choose an environment'),
    serverId: z.string().min(1, 'Choose a server'),
    dockerfilePath: z.string().trim().min(1, 'Enter a Dockerfile path'),
    port: z.string().regex(/^\d+$/, 'Invalid port'),
    autoDeploy: z.boolean(),
  });

  const wizardSchema = baseWizardSchema.superRefine((value, ctx) => {
    if (value.sourceMode === 'token') {
      if (!/^[^/\s]+\/[^/\s]+$/.test(value.repository)) {
        ctx.addIssue({
          code: 'custom',
          path: ['repository'],
          message: 'Use the owner/repository format',
        });
      }
      return;
    }

    if (!value.gitSourceId || !value.installationId || !value.repository) {
      ctx.addIssue({ code: 'custom', path: ['repository'], message: 'Choose a repository' });
    }
  });

  const form = useSchemaForm(
    wizardSchema,
    {
      sourceMode: 'github-app' as 'github-app' | 'token',
      gitSourceId: '',
      installationId: '',
      repository: '',
      token: '',
      branch: 'main',
      name: '',
      projectId: '',
      environmentId: '',
      serverId: '',
      dockerfilePath: 'Dockerfile',
      port: '3000',
      autoDeploy: true,
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const initialProjectId = String(route.query.projectId ?? '');

  watch(
    projects,
    list => {
      if (form.values.projectId || !list.length) {
        return;
      }

      const preferred = list.find(project => project.id === initialProjectId);
      form.values.projectId = (preferred ?? list[0])!.id;
    },
    { immediate: true },
  );

  watch(
    () => form.values.projectId,
    async projectId => {
      if (!projectId) {
        environments.value = [];
        return;
      }

      const { items } = await listEnvironments(projectId);
      environments.value = items;

      if (!items.some(environment => environment.id === form.values.environmentId)) {
        form.values.environmentId = items[0]?.id ?? '';
      }
    },
    { immediate: true },
  );

  watch(
    servers,
    list => {
      if (!form.values.serverId && list.length) {
        form.values.serverId = list[0]!.id;
      }
    },
    { immediate: true },
  );

  watch(
    () => form.values.repository,
    repository => {
      if (!repository || form.values.name) {
        return;
      }

      form.values.name = repository.split('/').pop() ?? '';
    },
  );

  const projectOptions = computed(() =>
    projects.value.map(project => ({ value: project.id, label: project.name })),
  );
  const environmentOptions = computed(() =>
    environments.value.map(environment => ({ value: environment.id, label: environment.name })),
  );
  const serverOptions = computed(() =>
    servers.value.map(server => ({ value: server.id, label: server.name })),
  );

  const projectName = computed(
    () => projects.value.find(project => project.id === form.values.projectId)?.name ?? '—',
  );
  const environmentName = computed(
    () =>
      environments.value.find(environment => environment.id === form.values.environmentId)?.name ??
      '—',
  );
  const serverName = computed(
    () => servers.value.find(server => server.id === form.values.serverId)?.name ?? '—',
  );

  const gitSourcePicker = ref<{ reset: () => void } | null>(null);

  const handlePickGitSource = (selection: GitSourceSelection | null) => {
    form.values.gitSourceId = selection?.gitSourceId ?? '';
    form.values.installationId = selection?.installationId ?? '';
    form.values.repository = selection?.repository ?? '';

    if (selection?.defaultBranch) {
      form.values.branch = selection.defaultBranch;
    }
  };

  const pickSource = (mode: 'github-app' | 'token') => {
    form.values.sourceMode = mode;
  };

  const currentStep = ref(0);

  const steps = computed(() => [
    {
      label: 'Source',
      hint: 'Where the code lives',
      status: (currentStep.value > 0 ? 'done' : 'running') as 'done' | 'running',
    },
    {
      label: 'Configure',
      hint: 'Name, server, build',
      status: (currentStep.value > 1 ? 'done' : currentStep.value === 1 ? 'running' : 'pending') as
        'done' | 'running' | 'pending',
    },
    {
      label: 'Review',
      hint: 'Create the application',
      status: (currentStep.value === 2 ? 'running' : 'pending') as 'running' | 'pending',
    },
  ]);

  const footnote = computed(() => {
    if (currentStep.value === 0) {
      return 'Branch and build settings are filled in from the repository.';
    }

    if (currentStep.value === 1) {
      return 'Everything here is editable after creation.';
    }

    return '';
  });

  const nextLabel = computed(() => (currentStep.value === 2 ? 'Create application' : 'Continue'));

  const validateSource = () => {
    if (form.values.sourceMode === 'token') {
      if (!/^[^/\s]+\/[^/\s]+$/.test(form.values.repository)) {
        form.errors.value = { ...form.errors.value, repository: 'Use the owner/repository format' };
        toast.error({ title: 'Error', message: 'Use the owner/repository format.' });
        return false;
      }

      form.errors.value = { ...form.errors.value, repository: undefined };
      return true;
    }

    if (!form.values.gitSourceId || !form.values.installationId || !form.values.repository) {
      form.errors.value = { ...form.errors.value, repository: 'Choose a repository' };
      toast.error({ title: 'Error', message: 'Choose a repository.' });
      return false;
    }

    form.errors.value = { ...form.errors.value, repository: undefined };
    return true;
  };

  const configureSlice = baseWizardSchema.pick({
    name: true,
    projectId: true,
    environmentId: true,
    serverId: true,
    dockerfilePath: true,
    port: true,
  });

  const validateConfigure = () => {
    const result = configureSlice.safeParse(form.values);

    if (result.success) {
      return true;
    }

    const fieldErrors: Record<string, string> = {};

    for (const issue of result.error.issues) {
      const key = issue.path[0] as string | undefined;

      if (key && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }

    form.errors.value = { ...form.errors.value, ...fieldErrors };

    const messages = Object.values(fieldErrors);
    toast.error({
      title: 'Error',
      message: messages[messages.length - 1] ?? 'Check the fields above.',
    });

    return false;
  };

  const handleCreate = form.submit(async values => {
    const { application } = await create({
      name: values.name,
      environmentId: values.environmentId,
      serverId: values.serverId,
      port: Number(values.port),
      git:
        values.sourceMode === 'github-app'
          ? {
              host: 'github',
              source: 'github-app',
              repository: values.repository,
              gitSourceId: values.gitSourceId,
              installationId: values.installationId,
              branch: values.branch,
              dockerfilePath: values.dockerfilePath,
              buildContext: '.',
              autoDeploy: values.autoDeploy,
            }
          : {
              host: 'github',
              source: 'pat',
              repository: values.repository,
              branch: values.branch,
              dockerfilePath: values.dockerfilePath,
              buildContext: '.',
              autoDeploy: values.autoDeploy,
              token: values.token || undefined,
            },
    });

    await navigateTo(`/applications/${application.id}`);
  });

  const wizNext = () => {
    if (currentStep.value === 0) {
      if (!validateSource()) {
        return;
      }

      currentStep.value = 1;
      return;
    }

    if (currentStep.value === 1) {
      if (!validateConfigure()) {
        return;
      }

      currentStep.value = 2;
      return;
    }

    handleCreate();
  };

  const wizBack = () => {
    if (currentStep.value === 0) {
      navigateTo(initialProjectId ? `/projects/${initialProjectId}` : '/applications');
      return;
    }

    currentStep.value -= 1;
  };

  const reviewRows = computed(() => [
    {
      label: 'Source',
      value: form.values.sourceMode === 'github-app' ? 'GitHub App' : 'Public repository or token',
    },
    { label: 'Repository', value: form.values.repository || '—' },
    { label: 'Branch', value: form.values.branch || '—' },
    { label: 'Project', value: `${projectName.value} · ${environmentName.value}` },
    { label: 'Server', value: serverName.value },
    { label: 'Auto-deploy', value: form.values.autoDeploy ? 'on' : 'off' },
  ]);

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'New application',
      context: `Projects · ${projectName.value}`,
    });
  });
</script>

<template>
  <Content>
    <EmptyState
      v-if="current && !canManage"
      variant="action"
      title="You can't create applications"
      description="Only administrators can create applications in this organization."
    />

    <div v-else class="flex max-w-255 gap-8.5">
      <StepList :steps="steps" class="w-52 shrink-0" />

      <div class="min-w-0 flex-1">
        <template v-if="currentStep === 0">
          <div class="mb-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              class="rounded-card border-[1.5px] p-4 text-left"
              :class="form.values.sourceMode === 'github-app' ? 'border-accent' : 'border-edge'"
              @click="pickSource('github-app')"
            >
              <div class="text-[14px] font-semibold text-ink">GitHub App</div>
              <div class="mt-1 text-caption text-ink-2">
                Webhooks and private repositories handled for you.
              </div>
            </button>
            <button
              type="button"
              class="rounded-card border-[1.5px] p-4 text-left"
              :class="form.values.sourceMode === 'token' ? 'border-accent' : 'border-edge'"
              @click="pickSource('token')"
            >
              <div class="text-[14px] font-semibold text-ink">Public repository or token</div>
              <div class="mt-1 text-caption text-ink-2">
                Paste owner/repository. Add a token if it is private.
              </div>
            </button>
          </div>

          <template v-if="form.values.sourceMode === 'github-app'">
            <GitSourcePicker ref="gitSourcePicker" @select="handlePickGitSource" />
            <span v-if="form.errors.value.repository" class="mt-1.5 block text-caption text-failed">
              {{ form.errors.value.repository }}
            </span>
          </template>

          <div v-else class="flex flex-col gap-1.5">
            <Input
              v-model="form.values.repository"
              label="Repository"
              placeholder="owner/repository"
              mono
              boxed
              bare
              :call-error="form.errors.value.repository"
            />
            <Input
              v-model="form.values.token"
              label="Access token"
              password
              mono
              boxed
              bare
              placeholder="Leave blank if the repository is public"
            />
          </div>
        </template>

        <template v-else-if="currentStep === 1">
          <Card rows>
            <Input
              v-model="form.values.name"
              label="Name"
              placeholder="api"
              boxed
              :call-error="form.errors.value.name"
            />
            <Select
              v-model="form.values.projectId"
              label="Project"
              :options="projectOptions"
              placeholder="Choose a project"
              boxed
            />
            <Select
              v-model="form.values.environmentId"
              label="Environment"
              :options="environmentOptions"
              placeholder="Choose an environment"
              boxed
            />
            <Select
              v-model="form.values.serverId"
              label="Server"
              :options="serverOptions"
              placeholder="Choose a server"
              boxed
            />
            <Input v-model="form.values.branch" label="Branch" mono boxed />
            <Input v-model="form.values.dockerfilePath" label="Dockerfile" mono boxed />
            <Input
              v-model="form.values.port"
              label="Port"
              mono
              boxed
              :call-error="form.errors.value.port"
            />

            <div class="flex items-center gap-3.5 px-4.25 py-3">
              <div class="flex-1">
                <div class="text-[13px] text-ink">Auto-deploy on every push</div>
                <div class="text-caption text-ink-3">
                  Webhook comes from the git source. Nothing to configure.
                </div>
              </div>
              <Switch v-model="form.values.autoDeploy" />
            </div>
          </Card>

          <p v-if="!serverOptions.length" class="mt-2 text-caption text-attn-ink">
            Register a server before creating applications.
          </p>
          <p v-if="!projectOptions.length" class="mt-2 text-caption text-attn-ink">
            Create a project before creating applications.
          </p>
        </template>

        <template v-else>
          <div class="rounded-card border border-edge bg-card">
            <div
              v-for="row in reviewRows"
              :key="row.label"
              class="flex items-baseline gap-3.5 border-t border-hairline px-4 py-3 first:border-t-0"
            >
              <div class="w-33 shrink-0 text-[13px] text-ink-2">{{ row.label }}</div>
              <div class="font-mono text-[13.5px] text-ink">{{ row.value }}</div>
            </div>
          </div>
          <p class="mt-3.5 text-caption text-ink-2">
            Creating the application does not deploy it. You will land on the application page with
            a Deploy button.
          </p>
        </template>

        <div class="mt-5 flex items-center gap-2.5">
          <Button theme="secondary" @click="wizBack">Back</Button>
          <Button theme="primary" :disabled="form.loading.value" @click="wizNext">
            <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
            {{ nextLabel }}
          </Button>
          <div v-if="footnote" class="text-caption text-ink-3">{{ footnote }}</div>
        </div>
      </div>
    </div>
  </Content>
</template>
