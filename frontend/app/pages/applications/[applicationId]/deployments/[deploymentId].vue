<script setup lang="ts">
  import { useApplications } from '~/composables/services/useApplications';
  import {
    useDeployments,
    type DeploymentStatus,
    type DeploymentStep,
    type DeploymentStepName,
  } from '~/composables/services/useDeployments';
  import type { LogEntry, LogLevel } from '~/composables/services/useLogs';

  const route = useRoute();
  const session = useSessionStore();

  const applications = useApplications();
  const deployments = useDeployments();
  const { subscribe, status: socketStatus } = useWebSocket();

  const applicationId = computed(() => String(route.params.applicationId));
  const deploymentId = computed(() => String(route.params.deploymentId));

  const STEP_LABEL: Record<DeploymentStepName, string> = {
    clone: 'Clone',
    build: 'Build',
    container: 'Container',
    proxy: 'Proxy',
    healthcheck: 'Healthcheck',
  };

  const STEP_COLOR: Record<DeploymentStep['status'], string> = {
    ok: 'bg-live-bg text-live-ink',
    failed: 'bg-failed/10 text-failed',
    skipped: 'bg-hairline text-ink-2',
  };

  const LEVEL_CLASS: Record<LogLevel, string> = {
    error: 'text-failed',
    warn: 'text-attn',
    info: 'text-white/85',
  };

  const applicationName = ref('');
  const status = ref<DeploymentStatus>('queued');
  const steps = ref<DeploymentStep[]>([]);
  const entries = ref<LogEntry[]>([]);
  const commit = ref<{ sha: string; message?: string; author?: string } | undefined>();
  const durationMs = ref<number | undefined>();
  const errorMessage = ref('');
  const loading = ref(true);

  const finished = computed(() => status.value === 'succeeded' || status.value === 'failed');

  useHead(() => ({ title: `Deploy · ${applicationName.value || 'Application'}` }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({ title: 'Deploy', context: applicationName.value });
  });

  const load = async () => {
    if (!session.organizationId) {
      return;
    }

    loading.value = true;
    errorMessage.value = '';

    try {
      const [{ application }, { deployment }, { entries: history }] = await Promise.all([
        applications.get(applicationId.value),
        deployments.get(deploymentId.value),
        deployments.logs(deploymentId.value, { tail: 1000 }),
      ]);

      applicationName.value = application.name;
      status.value = deployment.status;
      steps.value = deployment.steps;
      commit.value = deployment.commit;
      durationMs.value = deployment.durationMs;
      entries.value = history;
    } catch (failure) {
      errorMessage.value =
        (failure as { message?: string }).message || 'Failed to load the deployment.';
    } finally {
      loading.value = false;
    }
  };

  const logBox = ref<HTMLElement | null>(null);

  const scrollToEnd = () => {
    const box = logBox.value;

    if (!box) {
      return;
    }

    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

    if (atBottom) {
      nextTick(() => (box.scrollTop = box.scrollHeight));
    }
  };

  const onLog = (lines: string[]) => {
    for (const line of lines) {
      entries.value.push({ message: line, level: 'info' });
    }

    if (entries.value.length > 5000) {
      entries.value.splice(0, entries.value.length - 5000);
    }

    scrollToEnd();
  };

  const onStep = (incoming: DeploymentStep) => {
    const index = steps.value.findIndex(step => step.step === incoming.step);

    if (index === -1) {
      steps.value.push(incoming);
      return;
    }

    steps.value[index] = incoming;
  };

  const downloading = ref(false);

  const handleDownload = async () => {
    downloading.value = true;

    try {
      const text = await deployments.downloadLogs(deploymentId.value, { tail: 1000 });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `deploy-${deploymentId.value}.log`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      downloading.value = false;
    }
  };

  onMounted(async () => {
    await load();

    subscribe(deployments.topic(deploymentId.value), message => {
      const payload = message.data as {
        status?: DeploymentStatus;
        lines?: string[];
        step?: DeploymentStepName;
      };

      if (message.event === 'log' && payload.lines) {
        onLog(payload.lines);
        return;
      }

      if (message.event === 'step' && payload.step) {
        onStep(payload as unknown as DeploymentStep);
        return;
      }

      if (message.event === 'status' && payload.status) {
        status.value = payload.status;
      }
    });
  });
</script>

<template>
  <Content>
    <div class="mx-auto flex w-full max-w-180 flex-col gap-5">
      <div class="flex flex-wrap items-center gap-3">
        <Icon
          v-if="!finished"
          name="svg-spinners:ring-resize"
          class="size-6 shrink-0 text-accent"
        />
        <Icon
          v-else-if="status === 'succeeded'"
          name="lucide:check-circle-2"
          class="size-6 shrink-0 text-live"
        />
        <Icon v-else name="lucide:circle-x" class="size-6 shrink-0 text-failed" />

        <div class="min-w-0 flex-1">
          <div class="text-heading text-ink">
            {{
              finished
                ? status === 'succeeded'
                  ? `${applicationName || 'Application'} is live`
                  : `${applicationName || 'Application'} failed to deploy`
                : `Deploying ${applicationName || 'application'}`
            }}
          </div>
          <div v-if="commit" class="font-mono text-caption text-ink-2">
            {{ commit.sha.slice(0, 7) }}<span v-if="commit.message"> · {{ commit.message }}</span
            ><span v-if="durationMs"> · {{ Math.round(durationMs / 1000) }}s</span>
          </div>
        </div>

        <div
          v-if="!finished"
          class="flex items-center gap-1.5 rounded-full border border-edge bg-card px-2.75 py-1 text-caption text-ink-2"
        >
          <StatusDot status="attn" />
          {{ socketStatus === 'open' ? 'live' : socketStatus }}
        </div>

        <Button theme="secondary" size="sm" :disabled="downloading" @click="handleDownload">
          <Icon v-if="downloading" name="svg-spinners:tadpole" class="size-4" />
          Download
        </Button>
      </div>

      <Alert v-if="errorMessage" theme="error">{{ errorMessage }}</Alert>

      <div v-if="steps.length" class="flex flex-wrap gap-1.5">
        <span
          v-for="step in steps"
          :key="step.step"
          :title="step.detail"
          class="rounded-full px-3 py-1.5 text-[12.5px]"
          :class="STEP_COLOR[step.status]"
        >
          {{ STEP_LABEL[step.step] }}
          <span v-if="step.durationMs" class="font-mono opacity-70">
            · {{ Math.round(step.durationMs / 1000) }}s
          </span>
        </span>
      </div>

      <div
        ref="logBox"
        class="max-h-100 overflow-auto rounded-card bg-terminal p-4 font-mono text-[12.5px] leading-[1.8]"
      >
        <p v-if="loading" class="text-white/50">Loading…</p>
        <p v-else-if="!entries.length" class="text-white/50">
          No build output yet{{ finished ? '.' : ' — waiting for the deployment…' }}
        </p>
        <div v-for="(entry, index) in entries" :key="index" class="flex gap-2 whitespace-pre-wrap">
          <span v-if="entry.timestamp" class="shrink-0 text-white/50">{{ entry.timestamp }}</span>
          <span :class="LEVEL_CLASS[entry.level]">{{ entry.message }}</span>
        </div>
      </div>

      <div
        v-if="finished && status === 'succeeded'"
        class="flex items-center gap-4 rounded-card border border-edge bg-card p-4"
      >
        <div class="min-w-0 flex-1">
          <div class="text-[15px] font-semibold text-ink">
            {{ applicationName || 'Application' }} is live
          </div>
          <div class="text-caption text-ink-2">Health check passing.</div>
        </div>
        <Button theme="primary" size="sm" :to="`/applications/${applicationId}`">
          Back to application
        </Button>
      </div>

      <div
        v-else-if="finished"
        class="flex items-center gap-4 rounded-card border border-edge bg-card p-4"
      >
        <div class="min-w-0 flex-1">
          <div class="text-[15px] font-semibold text-ink">
            {{ applicationName || 'Application' }} failed to deploy
          </div>
          <div class="text-caption text-ink-2">Check the log above for what went wrong.</div>
        </div>
        <Button theme="secondary" size="sm" :to="`/applications/${applicationId}`">
          Back to application
        </Button>
      </div>
    </div>
  </Content>
</template>
