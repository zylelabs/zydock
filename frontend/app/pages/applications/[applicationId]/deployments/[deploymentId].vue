<script setup lang="ts">
  import {
    useDeployments,
    type DeploymentStatus,
    type DeploymentStep,
    type DeploymentStepName,
  } from '~/composables/services/useDeployments';
  import type { LogEntry, LogLevel } from '~/composables/services/useLogs';

  useHead({ title: 'Deploy' });

  const route = useRoute();
  const session = useSessionStore();

  const deployments = useDeployments();
  const { subscribe, status: socketStatus } = useWebSocket();

  const applicationId = computed(() => String(route.params.applicationId));
  const deploymentId = computed(() => String(route.params.deploymentId));

  const DEPLOY_STATUS: Record<DeploymentStatus, { label: string; color: string }> = {
    queued: { label: 'Queued', color: 'default' },
    running: { label: 'Running', color: 'blue' },
    succeeded: { label: 'Succeeded', color: 'green' },
    failed: { label: 'Failed', color: 'red' },
  };

  const STEP_LABEL: Record<DeploymentStepName, string> = {
    clone: 'Clone',
    build: 'Build',
    container: 'Container',
    proxy: 'Proxy',
    healthcheck: 'Healthcheck',
  };

  const LEVEL_CLASS: Record<LogLevel, string> = {
    error: 'text-danger',
    warn: 'text-warning',
    info: 'text-content',
  };

  const status = ref<DeploymentStatus>('queued');
  const steps = ref<DeploymentStep[]>([]);
  const entries = ref<LogEntry[]>([]);
  const commit = ref<{ sha: string; message?: string; author?: string } | undefined>();
  const durationMs = ref<number | undefined>();
  const errorMessage = ref('');
  const loading = ref(true);

  const finished = computed(() => status.value === 'succeeded' || status.value === 'failed');

  const load = async () => {
    if (!session.organizationId) {
      return;
    }

    loading.value = true;
    errorMessage.value = '';

    try {
      const [{ deployment }, { entries: history }] = await Promise.all([
        deployments.get(deploymentId.value),
        deployments.logs(deploymentId.value, { tail: 1000 }),
      ]);

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
    <NuxtLink
      :to="`/applications/${applicationId}`"
      class="mb-4 inline-flex items-center gap-1 text-sm text-content-muted transition-colors hover:text-content-strong"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Application
    </NuxtLink>

    <Header title="Deploy">
      <template #right>
        <div class="flex flex-wrap items-center gap-3">
          <Tag :color="DEPLOY_STATUS[status].color">{{ DEPLOY_STATUS[status].label }}</Tag>
          <span
            v-if="!finished"
            class="inline-flex items-center gap-1.5 text-xs text-content-muted"
          >
            <Icon name="lucide:radio" class="size-3.5" />
            {{ socketStatus === 'open' ? 'live' : socketStatus }}
          </span>
          <Button theme="ghost" :disabled="downloading" @click="handleDownload">
            <Icon :name="downloading ? 'svg-spinners:tadpole' : 'lucide:download'" class="size-4" />
            Download
          </Button>
        </div>
      </template>
    </Header>

    <div class="flex flex-col gap-4">
      <p v-if="commit" class="text-sm text-content-muted">
        <span class="font-mono">{{ commit.sha.slice(0, 7) }}</span>
        <span v-if="commit.message"> — {{ commit.message }}</span>
        <span v-if="durationMs"> · {{ Math.round(durationMs / 1000) }}s</span>
      </p>

      <Alert v-if="errorMessage" theme="error">{{ errorMessage }}</Alert>

      <div v-if="steps.length" class="flex flex-wrap gap-1.5">
        <span
          v-for="step in steps"
          :key="step.step"
          :title="step.detail"
          class="rounded px-2 py-0.5 text-xs font-medium"
          :class="{
            'bg-success/15 text-success': step.status === 'ok',
            'bg-danger/15 text-danger': step.status === 'failed',
            'bg-surface-sunken text-content-muted': step.status === 'skipped',
          }"
        >
          {{ STEP_LABEL[step.step] }}
          <span v-if="step.durationMs" class="opacity-70">
            · {{ Math.round(step.durationMs / 1000) }}s
          </span>
        </span>
      </div>

      <div
        ref="logBox"
        class="h-[65vh] overflow-auto rounded-xl border border-surface-border bg-surface-raised p-4 font-mono text-xs leading-relaxed"
      >
        <p v-if="loading" class="text-content-muted">Loading…</p>
        <p v-else-if="!entries.length" class="text-content-muted">
          No build output yet{{ finished ? '.' : ' — waiting for the deployment…' }}
        </p>
        <div v-for="(entry, index) in entries" :key="index" class="flex gap-2 whitespace-pre-wrap">
          <span v-if="entry.timestamp" class="shrink-0 text-content-muted">
            {{ entry.timestamp }}
          </span>
          <span :class="LEVEL_CLASS[entry.level]">{{ entry.message }}</span>
        </div>
      </div>
    </div>
  </Content>
</template>
