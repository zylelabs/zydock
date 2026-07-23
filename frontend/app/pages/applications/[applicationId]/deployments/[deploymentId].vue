<script setup lang="ts">
  import type { LogEntry, LogLevel } from '~/composables/use-logs';
  import type {
    DeploymentStatus,
    DeploymentStep,
    DeploymentStepName,
  } from '~/composables/use-deployments';

  const route = useRoute();
  const session = useSessionStore();
  const applicationId = computed(() => String(route.params.applicationId));
  const deploymentId = computed(() => String(route.params.deploymentId));

  const deployments = useDeployments();
  const { subscribe, status: socketStatus } = useWebSocket();

  useHead({ title: 'Deploy' });

  const DEPLOY_STATUS: Record<
    DeploymentStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    queued: { label: 'Na fila', variant: 'neutral' },
    running: { label: 'Rodando', variant: 'info' },
    succeeded: { label: 'Concluído', variant: 'success' },
    failed: { label: 'Falhou', variant: 'danger' },
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
        (failure as { message?: string }).message || 'Falha ao carregar o deploy.';
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
    } else {
      steps.value[index] = incoming;
    }
  };

  const downloading = ref(false);

  const onDownload = async () => {
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
      const data = message.data as {
        status?: DeploymentStatus;
        lines?: string[];
        step?: DeploymentStepName;
      };

      if (message.event === 'log' && data.lines) {
        onLog(data.lines);
      } else if (message.event === 'step' && data.step) {
        onStep(data as unknown as DeploymentStep);
      } else if (message.event === 'status' && data.status) {
        status.value = data.status;
      }
    });
  });
</script>

<template>
  <section class="mx-auto flex h-full max-w-5xl flex-col gap-4">
    <NuxtLink
      :to="`/applications/${applicationId}`"
      class="flex items-center gap-1 text-sm text-content-muted hover:text-content"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Aplicação
    </NuxtLink>

    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <h1>Deploy</h1>
        <UiBadge :variant="DEPLOY_STATUS[status].variant">{{
          DEPLOY_STATUS[status].label
        }}</UiBadge>
        <span v-if="!finished" class="inline-flex items-center gap-1.5 text-xs text-content-muted">
          <Icon name="lucide:radio" class="size-3.5" />
          {{ socketStatus === 'open' ? 'ao vivo' : socketStatus }}
        </span>
      </div>

      <UiButton variant="ghost" :loading="downloading" @click="onDownload">
        <Icon name="lucide:download" class="size-4" />
        Baixar
      </UiButton>
    </header>

    <p v-if="commit" class="text-sm text-content-muted">
      <span class="font-mono">{{ commit.sha.slice(0, 7) }}</span>
      <span v-if="commit.message"> — {{ commit.message }}</span>
      <span v-if="durationMs"> · {{ Math.round(durationMs / 1000) }}s</span>
    </p>

    <UiAlert v-if="errorMessage" variant="error">{{ errorMessage }}</UiAlert>

    <!-- Etapas do pipeline -->
    <div v-if="steps.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="step in steps"
        :key="step.step"
        :title="step.detail"
        class="rounded px-2 py-0.5 text-xs font-medium"
        :class="{
          'bg-success/15 text-success': step.status === 'ok',
          'bg-danger/15 text-danger': step.status === 'failed',
          'bg-surface text-content-muted': step.status === 'skipped',
        }"
      >
        {{ STEP_LABEL[step.step] }}
        <span v-if="step.durationMs" class="opacity-70">
          · {{ Math.round(step.durationMs / 1000) }}s</span
        >
      </span>
    </div>

    <div
      ref="logBox"
      class="flex-1 overflow-auto rounded-xl border border-surface-border bg-surface-raised p-4 font-mono text-xs leading-relaxed"
    >
      <p v-if="loading" class="text-content-muted">Carregando…</p>
      <p v-else-if="!entries.length" class="text-content-muted">
        Sem saída de build ainda{{ finished ? '.' : ' — aguardando o deploy…' }}
      </p>
      <div v-for="(entry, index) in entries" :key="index" class="flex gap-2 whitespace-pre-wrap">
        <span v-if="entry.timestamp" class="shrink-0 text-content-muted">{{
          entry.timestamp
        }}</span>
        <span :class="LEVEL_CLASS[entry.level]">{{ entry.message }}</span>
      </div>
    </div>
  </section>
</template>
