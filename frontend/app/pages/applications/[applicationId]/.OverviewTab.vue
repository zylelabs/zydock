<script setup lang="ts">
  import { z } from 'zod';
  import { useApplications, type Application } from '~/composables/services/useApplications';
  import {
    deploymentStatusDot,
    useDeployments,
    type Deployment,
  } from '~/composables/services/useDeployments';
  import { useMetrics } from '~/composables/services/useMetrics';
  import { formatDuration } from '~/utils';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const session = useSessionStore();
  const applicationsApi = useApplications();
  const { list: listDeployments } = useDeployments();
  const metricsApi = useMetrics();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const emptyDeployments = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data, status: deploymentsStatus } = useLazyAsyncData(
    () => `application-${props.application.id}-deployments`,
    () =>
      session.organizationId
        ? listDeployments({ applicationId: props.application.id })
        : Promise.resolve(emptyDeployments),
    {
      server: false,
      watch: [() => session.organizationId, () => props.application.id],
      default: () => emptyDeployments,
    },
  );

  const deploymentsLoadedOnce = ref(false);

  watch(
    deploymentsStatus,
    value => {
      if (value !== 'pending') {
        deploymentsLoadedOnce.value = true;
      }
    },
    { immediate: true },
  );

  const deploymentList = computed(() => data.value?.items ?? []);
  const runningDeployment = computed(() =>
    deploymentList.value.find(
      deployment => deployment.status === 'queued' || deployment.status === 'running',
    ),
  );

  const { data: metricsData, status: metricsStatus } = useLazyAsyncData(
    () => `application-${props.application.id}-metrics`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [metrics, deployMetrics] = await Promise.all([
        metricsApi.applicationMetrics(props.application.id).catch(() => null),
        metricsApi.applicationDeploymentMetrics(props.application.id).catch(() => null),
      ]);

      return { metrics, deployMetrics };
    },
    {
      server: false,
      watch: [() => session.organizationId, () => props.application.id],
      default: () => null,
    },
  );

  const metricsLoadedOnce = ref(false);

  watch(
    metricsStatus,
    value => {
      if (value !== 'pending') {
        metricsLoadedOnce.value = true;
      }
    },
    { immediate: true },
  );

  const metrics = computed(() => metricsData.value?.metrics ?? null);
  const deployMetrics = computed(() => metricsData.value?.deployMetrics ?? null);

  const stats = computed(() => {
    const rows: { label: string; value: string; note?: string }[] = [];

    if (metrics.value) {
      rows.push({ label: 'CPU', value: `${Math.round(metrics.value.cpuPercent)}%` });
      rows.push({
        label: 'Memory',
        value: `${metrics.value.memoryUsedMb} MB`,
        note: `of ${metrics.value.memoryLimitMb} MB`,
      });
    }

    if (deployMetrics.value?.window) {
      rows.push({
        label: 'Deploy success rate',
        value: `${deployMetrics.value.successRate ?? 0}%`,
        note: `avg ${formatDuration(deployMetrics.value.averageDurationMs ?? undefined)}`,
      });
    }

    return rows;
  });

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');

  const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no'] as const;
  const restartOptions = RESTART_POLICIES.map(value => ({ value, label: value }));

  const autoDeployOptions = [
    { value: 'on', label: 'on every push to main' },
    { value: 'off', label: 'off' },
  ];

  const editingConfig = ref(false);

  const configForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      repository: z
        .string()
        .trim()
        .regex(/^[^/\s]+\/[^/\s]+$/, 'Use the owner/repository format'),
      branch: z.string().trim().min(1, 'Enter the branch'),
      dockerfilePath: z.string().trim().min(1, 'Enter the Dockerfile'),
      buildContext: z.string().trim().min(1, 'Enter the build context'),
      port: z.string().regex(/^\d+$/, 'Invalid port'),
      autoDeploy: z.enum(['on', 'off']),
      restartPolicy: z.string().trim().min(1, 'Choose a restart policy'),
    }),
    {
      name: '',
      repository: '',
      branch: 'main',
      dockerfilePath: 'Dockerfile',
      buildContext: '.',
      port: '3000',
      autoDeploy: 'on',
      restartPolicy: 'unless-stopped',
    },
  );

  const startEditConfig = () => {
    const app = props.application;

    configForm.values.name = app.name;
    configForm.values.repository = app.git.repository;
    configForm.values.branch = app.git.branch;
    configForm.values.dockerfilePath = app.git.dockerfilePath;
    configForm.values.buildContext = app.git.buildContext;
    configForm.values.port = String(app.port);
    configForm.values.autoDeploy = app.git.autoDeploy ? 'on' : 'off';
    configForm.values.restartPolicy = app.restartPolicy;
    editingConfig.value = true;
  };

  const handleSaveConfig = configForm.submit(async values => {
    await applicationsApi.update(props.application.id, {
      name: values.name,
      port: Number(values.port),
      restartPolicy: values.restartPolicy,
      git: {
        repository: values.repository,
        branch: values.branch,
        dockerfilePath: values.dockerfilePath,
        buildContext: values.buildContext,
        autoDeploy: values.autoDeploy === 'on',
      },
    });

    editingConfig.value = false;
    emit('refresh');
  });

  const rollbackTarget = ref<Deployment | null>(null);
  const rollingBack = ref(false);
  const rollbackError = ref('');

  const rollbackOpen = computed({
    get: () => Boolean(rollbackTarget.value),
    set: value => {
      if (!value) {
        rollbackTarget.value = null;
      }
    },
  });

  const rollbackMessage = computed(
    () =>
      `Roll back to deployment ${rollbackTarget.value?.commit?.sha?.slice(0, 7) ?? ''} (${rollbackTarget.value?.commit?.message ?? 'no commit'})? Recreates the container with that deployment's image, without a rebuild.`,
  );

  const confirmRollback = async () => {
    if (!rollbackTarget.value) {
      return;
    }

    rollbackError.value = '';
    rollingBack.value = true;

    try {
      const { deployment } = await applicationsApi.rollback(
        props.application.id,
        rollbackTarget.value.id,
      );

      rollbackTarget.value = null;
      await navigateTo(`/applications/${props.application.id}/deployments/${deployment.id}`);
    } catch (error) {
      rollbackError.value = messageOf(error, 'Failed to roll back.');
    } finally {
      rollingBack.value = false;
    }
  };
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <NuxtLink
      v-if="runningDeployment"
      :to="`/applications/${application.id}/deployments/${runningDeployment.id}`"
      class="flex items-center gap-2 rounded-card border border-accent/30 bg-accent-soft/15 px-4 py-3 text-[13.5px] text-accent transition-colors hover:bg-accent-soft/25"
    >
      <Icon name="lucide:loader" class="size-4 animate-spin" />
      Deployment in progress — view live logs
    </NuxtLink>

    <div class="grid gap-4.5 lg:grid-cols-[1.4fr_1fr]">
      <div class="flex flex-col gap-4.5">
        <div
          v-if="metricsStatus === 'pending' && !metricsLoadedOnce"
          class="grid gap-3.5 sm:grid-cols-3"
        >
          <SkeletonChart v-for="index in 3" :key="index" />
        </div>
        <div v-else-if="stats.length" class="grid gap-3.5 sm:grid-cols-3">
          <Metric
            v-for="stat in stats"
            :key="stat.label"
            :label="stat.label"
            :value="stat.value"
            :note="stat.note"
            sm
          />
        </div>

        <Card title="Deployments" content-class="p-0">
          <template v-if="deploymentsStatus === 'pending' && !deploymentsLoadedOnce">
            <SkeletonRow v-for="index in 3" :key="index" />
          </template>

          <p
            v-else-if="!deploymentList.length"
            class="px-4.25 py-6 text-center text-caption text-ink-2"
          >
            No deployments yet.
          </p>

          <Row
            v-for="deployment in deploymentList"
            :key="deployment.id"
            :to="`/applications/${application.id}/deployments/${deployment.id}`"
            class="grid-cols-[auto_1fr_auto_auto_auto]"
          >
            <StatusDot :status="deploymentStatusDot(deployment.status)" />
            <div class="min-w-0">
              <div class="truncate text-[13.5px] text-ink">
                {{ deployment.commit?.message || deployment.branch || 'deploy' }}
              </div>
              <div class="truncate text-caption text-ink-2">
                {{ deployment.trigger }} ·
                {{ formatWhen(deployment.startedAt ?? deployment.createdAt) }}
              </div>
            </div>
            <div v-if="deployment.commit" class="font-mono text-caption text-ink-2">
              {{ deployment.commit.sha.slice(0, 7) }}
            </div>
            <div class="text-caption text-ink-2">{{ formatDuration(deployment.durationMs) }}</div>
            <button
              v-if="canManage && deployment.status === 'succeeded'"
              type="button"
              title="Roll back to this deployment"
              class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-ink"
              @click.stop.prevent="rollbackTarget = deployment"
            >
              <Icon name="lucide:rotate-ccw" class="size-4" />
            </button>
          </Row>
        </Card>
      </div>

      <Card title="Configuration" rows>
        <template v-if="canManage" #right>
          <Button v-if="!editingConfig" theme="secondary" size="xs" @click="startEditConfig">
            Edit
          </Button>
        </template>

        <template v-if="!editingConfig">
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Name</div>
            <div class="truncate font-mono text-[13px] text-ink">
              {{ application.name }}
            </div>
          </Row>
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Repository</div>
            <div class="truncate font-mono text-[13px] text-ink">
              {{ application.git.repository }}
            </div>
          </Row>
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Branch</div>
            <div class="font-mono text-[13px] text-ink">{{ application.git.branch }}</div>
          </Row>
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Dockerfile</div>
            <div class="truncate font-mono text-[13px] text-ink">
              {{ application.git.dockerfilePath }}
            </div>
          </Row>
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Build context</div>
            <div class="truncate font-mono text-[13px] text-ink">
              {{ application.git.buildContext }}
            </div>
          </Row>
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Port</div>
            <div class="font-mono text-[13px] text-ink">{{ application.port }}</div>
          </Row>
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Auto-deploy</div>
            <div class="font-mono text-[13px] text-ink">
              {{ application.git.autoDeploy ? 'on every push to main' : 'off' }}
            </div>
          </Row>
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Restart policy</div>
            <div class="font-mono text-[13px] text-ink">{{ application.restartPolicy }}</div>
          </Row>
        </template>

        <form v-else class="flex flex-col" @submit.prevent="handleSaveConfig">
          <Alert v-if="configForm.formError.value" theme="error" class="mx-4.25 mt-3">
            {{ configForm.formError.value }}
          </Alert>

          <Input
            v-model="configForm.values.name"
            label="Name"
            mono
            boxed
            :call-error="configForm.errors.value.name"
          />
          <Input
            v-model="configForm.values.repository"
            label="Repository"
            placeholder="owner/repository"
            mono
            boxed
            :call-error="configForm.errors.value.repository"
          />
          <Input
            v-model="configForm.values.branch"
            label="Branch"
            mono
            boxed
            :call-error="configForm.errors.value.branch"
          />
          <Input
            v-model="configForm.values.dockerfilePath"
            label="Dockerfile"
            mono
            boxed
            :call-error="configForm.errors.value.dockerfilePath"
          />
          <Input
            v-model="configForm.values.buildContext"
            label="Build context"
            mono
            boxed
            :call-error="configForm.errors.value.buildContext"
          />
          <Input
            v-model="configForm.values.port"
            label="Port"
            mono
            boxed
            :call-error="configForm.errors.value.port"
          />
          <Select
            v-model="configForm.values.autoDeploy"
            label="Auto-deploy"
            :options="autoDeployOptions"
            boxed
          />
          <Select
            v-model="configForm.values.restartPolicy"
            label="Restart policy"
            :options="restartOptions"
            boxed
          />

          <div class="flex flex-wrap items-center gap-2 px-4.25 py-3.25">
            <p class="text-caption text-ink-3">Changes take effect on the next deploy.</p>

            <div class="ml-auto flex items-center gap-2">
              <Button theme="quiet" size="sm" type="button" @click="editingConfig = false">
                Cancel
              </Button>
              <Button theme="primary" size="sm" type="submit" :disabled="configForm.loading.value">
                <Icon v-if="configForm.loading.value" name="svg-spinners:tadpole" size="16" />
                Save
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>

    <Confirm
      v-model:open="rollbackOpen"
      title="Roll back deploy"
      :message="rollbackMessage"
      confirm-label="Roll back"
      :loading="rollingBack"
      @confirm="confirmRollback"
    />
    <Alert v-if="rollbackError" theme="error">{{ rollbackError }}</Alert>
  </div>
</template>
