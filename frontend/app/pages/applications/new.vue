<script setup lang="ts">
  import { z } from 'zod';
  import type { GitSourceSelection } from '~/components/git/GitSourcePicker.vue';
  import { useApplications } from '~/composables/services/useApplications';
  import { useHealth } from '~/composables/services/useHealth';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects, type Environment, type Project } from '~/composables/services/useProjects';
  import { useServers, type Server } from '~/composables/services/useServers';
  import {
    mergeVersionOptions,
    preferredVersionOf,
    templateVersionSelectOptions,
    useTemplates,
    type Template,
    type TemplateVersionsListing,
  } from '~/composables/services/useTemplates';
  import { slugify } from '~/utils';
  import ResourcesStep from './.ResourcesStep.vue';

  useHead({ title: 'New application' });

  const route = useRoute();
  const toast = useToast();
  const session = useSessionStore();
  const { current } = useOrganizations();
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const { list: listProjects, listEnvironments } = useProjects();
  const { list: listServers } = useServers();
  const { create } = useApplications();
  const { deploy: deployTemplate, listVersions: listTemplateVersions } = useTemplates();
  const { get: getHealth } = useHealth();

  const { data: health } = useLazyAsyncData('platform-health', () => getHealth(), {
    server: false,
    default: () => null,
  });

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const { data, status: wizardContextStatus } = useLazyAsyncData(
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

  const wizardContextPending = useFirstLoad(wizardContextStatus);

  const projects = computed(() => data.value?.projects ?? []);
  const servers = computed(() => data.value?.servers ?? []);
  const environments = ref<Environment[]>([]);

  const baseWizardSchema = z.object({
    sourceMode: z.enum(['github-app', 'token', 'resources']),
    resourceMode: z.enum(['template', 'compose']),
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
    templateId: z.string().trim(),
    composeContent: z.string().trim(),
    composeService: z.string().trim(),
    composePort: z.string(),
  });

  const wizardSchema = baseWizardSchema.superRefine((value, ctx) => {
    if (value.sourceMode === 'resources') {
      if (value.resourceMode === 'template') {
        if (!value.templateId) {
          ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'Choose a template' });
        }
        return;
      }

      if (!value.composeContent) {
        ctx.addIssue({ code: 'custom', path: ['composeContent'], message: 'Paste a compose file' });
      }

      return;
    }

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
      sourceMode: 'github-app' as 'github-app' | 'token' | 'resources',
      resourceMode: 'template' as 'template' | 'compose',
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
      templateId: '',
      composeContent: '',
      composeService: '',
      composePort: '',
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const selectedTemplate = ref<Template | null>(null);
  const templateInputValues = reactive<Record<string, string>>({});
  const templateVersion = ref('');

  const templateVersionsListing = ref<TemplateVersionsListing | null>(null);
  const templateVersionsError = ref('');

  const isRegistryBackedVersion = computed(() =>
    Boolean(selectedTemplate.value?.versions?.registry),
  );

  const templateVersionEntries = computed(() =>
    mergeVersionOptions(
      templateVersionsListing.value,
      selectedTemplate.value?.versions?.available ?? [],
      templateVersion.value,
    ),
  );

  const templateVersionOptions = computed(() =>
    templateVersionSelectOptions(templateVersionEntries.value),
  );

  const templateVersionDegradedReason = computed(
    () => templateVersionsListing.value?.degraded?.reason ?? templateVersionsError.value,
  );

  const loadTemplateVersions = async (search?: string) => {
    const templateId = selectedTemplate.value?.id;

    if (!templateId || !isRegistryBackedVersion.value) {
      return;
    }

    templateVersionsError.value = '';

    try {
      templateVersionsListing.value = await listTemplateVersions(templateId, search);

      if (!templateVersion.value) {
        templateVersion.value = preferredVersionOf(templateVersionEntries.value);
      }
    } catch (error) {
      templateVersionsError.value = messageOf(error, 'Could not reach the registry.');
    }
  };

  const handleSelectTemplate = (template: Template) => {
    selectedTemplate.value = template;
    form.values.templateId = template.id;
    form.values.resourceMode = 'template';
    templateVersion.value = template.versions?.default ?? '';
    templateVersionsListing.value = null;
    templateVersionsError.value = '';

    for (const key of Object.keys(templateInputValues)) {
      Reflect.deleteProperty(templateInputValues, key);
    }

    for (const input of template.inputs) {
      templateInputValues[input.key] = input.default != null ? String(input.default) : '';
    }

    loadTemplateVersions();
  };

  const handleSelectCompose = () => {
    selectedTemplate.value = null;
    form.values.templateId = '';
    form.values.resourceMode = 'compose';
  };

  const templateInputError = (key: string) =>
    (form.errors.value as Record<string, string | undefined>)[`input.${key}`];

  const composeCapableServers = computed(() =>
    servers.value.filter(server => server.resources.composeVersion),
  );

  const anyServerHasCompose = computed(() => composeCapableServers.value.length > 0);

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
    (form.values.sourceMode === 'resources' ? composeCapableServers.value : servers.value).map(
      server => ({ value: server.id, label: server.name }),
    ),
  );

  watch(serverOptions, options => {
    if (!options.some(option => option.value === form.values.serverId)) {
      form.values.serverId = options[0]?.value ?? '';
    }
  });

  const projectName = computed(
    () => projects.value.find(project => project.id === form.values.projectId)?.name ?? '—',
  );
  const environmentName = computed(
    () =>
      environments.value.find(environment => environment.id === form.values.environmentId)?.name ??
      '—',
  );
  const selectedServer = computed(() =>
    servers.value.find(server => server.id === form.values.serverId),
  );
  const serverName = computed(() => selectedServer.value?.name ?? '—');

  const autoDomainPreview = computed(() => {
    if (!health.value?.autoDomain.enabled || !selectedServer.value?.publicIp) {
      return null;
    }

    const slug = slugify(form.values.name) || 'app';
    const ipLabel = selectedServer.value.publicIp.replace(/[.:]/g, '-');

    return `${slug}.${ipLabel}.${health.value.autoDomain.suffix}`;
  });

  const gitSourcePicker = ref<{ reset: () => void } | null>(null);

  const handlePickGitSource = (selection: GitSourceSelection | null) => {
    form.values.gitSourceId = selection?.gitSourceId ?? '';
    form.values.installationId = selection?.installationId ?? '';
    form.values.repository = selection?.repository ?? '';

    if (selection?.defaultBranch) {
      form.values.branch = selection.defaultBranch;
    }
  };

  const pickSource = (mode: 'github-app' | 'token' | 'resources') => {
    if (mode === 'resources' && !anyServerHasCompose.value) {
      return;
    }

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
      return form.values.sourceMode === 'resources'
        ? 'Templates arrive with image, ports and volumes already set.'
        : 'Branch and build settings are filled in from the repository.';
    }

    if (currentStep.value === 1) {
      return 'Everything here is editable after creation.';
    }

    return '';
  });

  const nextLabel = computed(() => {
    if (currentStep.value !== 2) {
      return 'Continue';
    }

    return form.values.sourceMode === 'resources' && form.values.resourceMode === 'template'
      ? 'Deploy'
      : 'Create application';
  });

  const nextDisabled = computed(() => {
    if (form.loading.value) {
      return true;
    }

    if (currentStep.value !== 0 || form.values.sourceMode !== 'resources') {
      return false;
    }

    return form.values.resourceMode === 'template'
      ? !form.values.templateId
      : !form.values.composeContent.trim();
  });

  const validateSource = () => {
    if (form.values.sourceMode === 'resources') {
      if (form.values.resourceMode === 'template') {
        if (!form.values.templateId) {
          toast.error({ title: 'Error', message: 'Choose a template.' });
          return false;
        }

        return true;
      }

      if (!form.values.composeContent.trim()) {
        toast.error({ title: 'Error', message: 'Paste a compose file.' });
        return false;
      }

      return true;
    }

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

  const gitConfigureSlice = baseWizardSchema.pick({
    name: true,
    projectId: true,
    environmentId: true,
    serverId: true,
    dockerfilePath: true,
    port: true,
  });

  const resourcesConfigureSlice = baseWizardSchema.pick({
    name: true,
    projectId: true,
    environmentId: true,
    serverId: true,
  });

  const validateConfigure = () => {
    const isResources = form.values.sourceMode === 'resources';
    const slice = isResources ? resourcesConfigureSlice : gitConfigureSlice;
    const result = slice.safeParse(form.values);

    const fieldErrors: Record<string, string> = {};

    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = issue.path[0] as string | undefined;

        if (key && !fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
    }

    if (isResources && form.values.resourceMode === 'template' && selectedTemplate.value) {
      for (const input of selectedTemplate.value.inputs) {
        if (input.required && !templateInputValues[input.key]?.trim()) {
          fieldErrors[`input.${input.key}`] = `Enter ${input.label.toLowerCase()}`;
        }
      }
    }

    if (isResources && form.values.resourceMode === 'compose') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(form.values.composeService)) {
        fieldErrors.composeService = 'Enter the service name to expose';
      }

      if (!/^\d+$/.test(form.values.composePort)) {
        fieldErrors.composePort = 'Invalid port';
      }
    }

    if (Object.keys(fieldErrors).length) {
      form.errors.value = { ...form.errors.value, ...fieldErrors };

      const messages = Object.values(fieldErrors);
      toast.error({
        title: 'Error',
        message: messages[messages.length - 1] ?? 'Check the fields above.',
      });

      return false;
    }

    return true;
  };

  const handleCreate = form.submit(async values => {
    if (values.sourceMode === 'resources' && values.resourceMode === 'template') {
      const { application } = await deployTemplate(values.templateId, {
        organizationId: session.organizationId!,
        name: values.name,
        environmentId: values.environmentId,
        serverId: values.serverId,
        inputs: Object.fromEntries(
          Object.entries(templateInputValues).filter(([, value]) => value.trim()),
        ),
        version: templateVersion.value || undefined,
        deployNow: true,
      });

      await navigateTo(`/applications/${application.id}`);
      return;
    }

    if (values.sourceMode === 'resources') {
      const { application } = await create({
        source: 'compose',
        name: values.name,
        environmentId: values.environmentId,
        serverId: values.serverId,
        compose: {
          content: values.composeContent,
          expose: { service: values.composeService, port: Number(values.composePort) },
        },
      });

      await navigateTo(`/applications/${application.id}`);
      return;
    }

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

  const reviewRows = computed(() => {
    if (form.values.sourceMode === 'resources' && form.values.resourceMode === 'template') {
      const template = selectedTemplate.value;

      const versionLabel = template?.versions
        ? (templateVersionEntries.value.find(entry => entry.value === templateVersion.value)
            ?.label ?? templateVersion.value)
        : null;

      return [
        { label: 'Source', value: 'Marketplace template' },
        { label: 'Template', value: template?.name ?? '—' },
        { label: 'Category', value: template?.category ?? '—' },
        ...(versionLabel ? [{ label: 'Version', value: versionLabel }] : []),
        {
          label: 'Services',
          value:
            [template?.expose.service, ...(template?.databases.map(db => db.service) ?? [])]
              .filter(Boolean)
              .join(', ') || '—',
        },
        { label: 'Domain', value: template?.expose.domain ? 'automatic' : 'none' },
        { label: 'Volumes', value: 'defined in the template’s compose file' },
        { label: 'Project', value: `${projectName.value} · ${environmentName.value}` },
        { label: 'Server', value: serverName.value },
      ];
    }

    if (form.values.sourceMode === 'resources') {
      return [
        { label: 'Source', value: 'Pasted compose file' },
        { label: 'Exposed service', value: form.values.composeService || '—' },
        { label: 'Exposed port', value: form.values.composePort || '—' },
        { label: 'Volumes', value: 'defined in the compose file' },
        { label: 'Project', value: `${projectName.value} · ${environmentName.value}` },
        { label: 'Server', value: serverName.value },
      ];
    }

    return [
      {
        label: 'Source',
        value:
          form.values.sourceMode === 'github-app' ? 'GitHub App' : 'Public repository or token',
      },
      { label: 'Repository', value: form.values.repository || '—' },
      { label: 'Branch', value: form.values.branch || '—' },
      { label: 'Project', value: `${projectName.value} · ${environmentName.value}` },
      { label: 'Server', value: serverName.value },
      { label: 'Auto-deploy', value: form.values.autoDeploy ? 'on' : 'off' },
    ];
  });

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'New application',
      context: `Projects · ${projectName.value}`,
      back: form.values.projectId ? `/projects/${form.values.projectId}` : '/applications',
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
          <div class="mb-5 grid grid-cols-3 gap-3">
            <button
              type="button"
              class="rounded-card border-[1.5px] p-4 text-left"
              :class="form.values.sourceMode === 'github-app' ? 'border-accent' : 'border-edge'"
              @click="pickSource('github-app')"
            >
              <div class="text-body font-semibold text-ink">GitHub App</div>
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
              <div class="text-body font-semibold text-ink">Public repository or token</div>
              <div class="mt-1 text-caption text-ink-2">
                Paste owner/repository. Add a token if it is private.
              </div>
            </button>
            <button
              type="button"
              class="rounded-card border-[1.5px] p-4 text-left"
              :class="[
                form.values.sourceMode === 'resources' ? 'border-accent' : 'border-edge',
                !anyServerHasCompose && 'cursor-not-allowed opacity-50',
              ]"
              @click="pickSource('resources')"
            >
              <div class="text-body font-semibold text-ink">Resources</div>
              <div class="mt-1 text-caption text-ink-2">
                Templates from the marketplace, published by other projects.
              </div>
            </button>
          </div>

          <p v-if="!anyServerHasCompose" class="mb-5 text-caption text-attn-ink">
            No connected server has the Docker Compose plugin yet — install it on a server and wait
            for the next heartbeat to use templates or a compose file.
          </p>

          <template v-if="form.values.sourceMode === 'github-app'">
            <GitSourcePicker ref="gitSourcePicker" @select="handlePickGitSource" />
            <span v-if="form.errors.value.repository" class="mt-1.5 block text-caption text-failed">
              {{ form.errors.value.repository }}
            </span>
          </template>

          <div v-else-if="form.values.sourceMode === 'token'" class="flex flex-col gap-1.5">
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

          <template v-else>
            <ResourcesStep
              :selected-template-id="form.values.templateId"
              :compose-mode="form.values.resourceMode === 'compose'"
              @select-template="handleSelectTemplate"
              @select-compose="handleSelectCompose"
            />

            <div v-if="form.values.resourceMode === 'compose'" class="mt-3.5 flex flex-col gap-1.5">
              <Input
                v-model="form.values.composeContent"
                label="docker-compose.yml"
                type="textarea"
                :rows="10"
                mono
                boxed
                stacked
                :call-error="form.errors.value.composeContent"
              />
            </div>
          </template>
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
            <div v-if="wizardContextPending" class="flex items-center gap-1.75 px-4.25 py-1.5">
              <label class="w-33 shrink-0 text-caption text-ink-2">Project</label>
              <Skeleton class="h-7 flex-1" />
            </div>
            <Select
              v-else
              v-model="form.values.projectId"
              label="Project"
              :options="projectOptions"
              placeholder="Choose a project"
              boxed
            />

            <div v-if="wizardContextPending" class="flex items-center gap-1.75 px-4.25 py-1.5">
              <label class="w-33 shrink-0 text-caption text-ink-2">Environment</label>
              <Skeleton class="h-7 flex-1" />
            </div>
            <Select
              v-else
              v-model="form.values.environmentId"
              label="Environment"
              :options="environmentOptions"
              placeholder="Choose an environment"
              boxed
            />

            <div v-if="wizardContextPending" class="flex items-center gap-1.75 px-4.25 py-1.5">
              <label class="w-33 shrink-0 text-caption text-ink-2">Server</label>
              <Skeleton class="h-7 flex-1" />
            </div>
            <Select
              v-else
              v-model="form.values.serverId"
              label="Server"
              :options="serverOptions"
              placeholder="Choose a server"
              boxed
            />

            <template v-if="form.values.sourceMode === 'resources'">
              <template v-if="form.values.resourceMode === 'template'">
                <template v-if="selectedTemplate?.versions">
                  <Select
                    v-model="templateVersion"
                    label="Version"
                    :options="templateVersionOptions"
                    :searchable="isRegistryBackedVersion"
                    :remote-search="isRegistryBackedVersion"
                    boxed
                    @search="loadTemplateVersions"
                  />
                  <p
                    v-if="templateVersionDegradedReason"
                    class="flex items-center gap-1.5 text-caption text-ink-3"
                  >
                    Could not reach the registry — showing catalog versions.
                    <button
                      type="button"
                      class="text-accent underline"
                      @click="loadTemplateVersions()"
                    >
                      Try again
                    </button>
                  </p>
                </template>

                <TemplateInputFields
                  :inputs="selectedTemplate?.inputs ?? []"
                  :values="templateInputValues"
                  :errors="templateInputError"
                  @update:value="(key, value) => (templateInputValues[key] = value)"
                />
              </template>

              <template v-else>
                <Input
                  v-model="form.values.composeService"
                  label="Exposed service"
                  placeholder="app"
                  mono
                  boxed
                  :call-error="form.errors.value.composeService"
                />
                <Input
                  v-model="form.values.composePort"
                  label="Exposed port"
                  mono
                  boxed
                  :call-error="form.errors.value.composePort"
                />
              </template>
            </template>

            <template v-else>
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
                  <div class="text-caption text-ink">Auto-deploy on every push</div>
                  <div class="text-caption text-ink-3">
                    Webhook comes from the git source. Nothing to configure.
                  </div>
                </div>
                <Switch v-model="form.values.autoDeploy" />
              </div>
            </template>
          </Card>

          <p v-if="!serverOptions.length" class="mt-2 text-caption text-attn-ink">
            Register a server before creating applications.
          </p>
          <p v-if="!projectOptions.length" class="mt-2 text-caption text-attn-ink">
            Create a project before creating applications.
          </p>
        </template>

        <template v-else>
          <div
            v-if="autoDomainPreview"
            class="mb-3.5 flex items-center gap-2 rounded-card border border-edge bg-inset px-4 py-3 text-caption"
          >
            <Icon name="lucide:globe" class="size-4 shrink-0 text-ink-2" />
            <span class="text-ink-2">Your application will be reachable at</span>
            <span class="truncate font-mono text-ink">{{ autoDomainPreview }}</span>
          </div>
          <p
            v-else-if="health?.autoDomain.enabled && form.values.serverId"
            class="mb-3.5 text-caption text-ink-3"
          >
            No automatic URL — the selected server has no public IP configured.
          </p>

          <div class="rounded-card border border-edge bg-card">
            <div
              v-for="row in reviewRows"
              :key="row.label"
              class="flex items-baseline gap-3.5 border-t border-hairline px-4 py-3 first:border-t-0"
            >
              <div class="w-33 shrink-0 text-caption text-ink-2">{{ row.label }}</div>
              <div class="font-mono text-caption text-ink">{{ row.value }}</div>
            </div>
          </div>
          <p class="mt-3.5 text-caption text-ink-2">
            {{
              form.values.sourceMode === 'resources' && form.values.resourceMode === 'template'
                ? 'Deploying starts right away — you will land on the application page and can follow it live.'
                : 'Creating the application does not deploy it. You will land on the application page with a Deploy button.'
            }}
          </p>
        </template>

        <div class="mt-5 flex items-center gap-2.5">
          <Button theme="secondary" @click="wizBack">Back</Button>
          <Button theme="primary" :disabled="nextDisabled" @click="wizNext">
            <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
            {{ nextLabel }}
          </Button>
          <div v-if="footnote" class="text-caption text-ink-3">{{ footnote }}</div>
        </div>
      </div>
    </div>
  </Content>
</template>
