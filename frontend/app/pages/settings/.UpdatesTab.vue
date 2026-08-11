<script setup lang="ts">
  import {
    isChannelDowngrade,
    updateRunPhase,
    useUpdates,
    type UpdateChannel,
    type UpdateFrequency,
    type UpdateRun,
    type UpdateSettingsPatch,
    type UpdateStatus,
  } from '~/composables/services/useUpdates';

  const FREQUENCY_OPTIONS: { label: string; value: UpdateFrequency }[] = [
    { label: 'Hourly', value: 'hourly' },
    { label: 'Daily', value: 'daily' },
    { label: 'Weekly', value: 'weekly' },
  ];

  const CHANNELS: { value: UpdateChannel; title: string; description: string }[] = [
    {
      value: 'stable',
      title: 'Stable',
      description: 'Tagged releases. Recommended for production hosts.',
    },
    {
      value: 'nightly',
      title: 'Nightly',
      description: 'Built from main every night. Occasional regressions.',
    },
    { value: 'dev', title: 'Dev', description: 'Every merged commit. Expect breakage.' },
    { value: 'branch', title: 'Specific branch', description: 'Track a branch of the repository.' },
  ];

  const toast = useToast();
  const { getStatus, updateSettings, check, run: runUpdate, getRun } = useUpdates();

  const emptyStatus: UpdateStatus = {
    channel: 'stable',
    branch: '',
    auto: false,
    frequency: 'daily',
    installed: { version: '', commit: '', channel: '' },
    remote: { ref: '', version: '', commit: '' },
    updateAvailable: false,
  };

  const {
    data: statusData,
    refresh: refreshStatus,
    status: statusLoadStatus,
    error: statusLoadError,
  } = useLazyAsyncData('settings-updates-status', () => getStatus(), {
    server: false,
    default: () => emptyStatus,
  });

  const hasLoadedOnce = ref(false);

  watch(statusLoadStatus, value => {
    if (value === 'success' || value === 'error') {
      hasLoadedOnce.value = true;
    }
  });

  const statusErrorMessage = computed(
    () =>
      (statusLoadError.value as { message?: string } | null)?.message ||
      (statusLoadError.value ? 'Could not load the update status.' : ''),
  );

  const errorMessageOf = (error: unknown, fallback: string) =>
    (error as { message?: string })?.message || fallback;

  const savedChannel = computed<UpdateChannel>(() => statusData.value?.channel ?? 'stable');

  const saving = ref(false);

  const patchSettings = async (patch: UpdateSettingsPatch, fallback: string) => {
    saving.value = true;

    try {
      await updateSettings(patch);
      await refreshStatus();
    } catch (error) {
      toast.error({ title: 'Error', message: errorMessageOf(error, fallback) });
    } finally {
      saving.value = false;
    }
  };

  const autoEnabled = computed({
    get: () => statusData.value?.auto ?? false,
    set: value => patchSettings({ auto: value }, 'Could not change automatic updates.'),
  });

  const frequency = computed({
    get: () => statusData.value?.frequency ?? 'daily',
    set: (value: UpdateFrequency) =>
      patchSettings({ frequency: value }, 'Could not change the frequency.'),
  });

  const uiChannel = ref<UpdateChannel>('stable');

  watch(savedChannel, value => (uiChannel.value = value), { immediate: true });

  const branchDraft = ref('');

  watch(
    () => statusData.value?.branch,
    value => {
      if (value) {
        branchDraft.value = value;
      }
    },
    { immediate: true },
  );

  const pendingChannel = ref<UpdateChannel | null>(null);
  const pendingBranch = ref('');
  const confirmChannelOpen = ref(false);

  const openChannelConfirm = (channel: UpdateChannel, branch = '') => {
    pendingChannel.value = channel;
    pendingBranch.value = branch;
    confirmChannelOpen.value = true;
  };

  watch(uiChannel, value => {
    if (value === 'branch' || value === savedChannel.value) {
      return;
    }

    openChannelConfirm(value);
  });

  watch(confirmChannelOpen, open => {
    if (!open) {
      uiChannel.value = savedChannel.value;
      pendingChannel.value = null;
      pendingBranch.value = '';
    }
  });

  const applyBranch = () => {
    const branch = branchDraft.value.trim();

    if (!branch) {
      return;
    }

    openChannelConfirm('branch', branch);
  };

  const channelDowngrade = computed(
    () =>
      pendingChannel.value !== null && isChannelDowngrade(savedChannel.value, pendingChannel.value),
  );

  const confirmChannelMessage = computed(() => {
    if (!pendingChannel.value) {
      return '';
    }

    const label =
      pendingChannel.value === 'branch' ? `branch “${pendingBranch.value}”` : pendingChannel.value;

    if (channelDowngrade.value) {
      return (
        `Switch the update channel to ${label}? Its head can be older than what is installed now ` +
        '— the installation may look like it went backwards.'
      );
    }

    return `Switch the update channel to ${label}? The next check compares against its head instead.`;
  });

  const confirmChannelApply = async () => {
    if (!pendingChannel.value) {
      return;
    }

    await patchSettings(
      pendingChannel.value === 'branch'
        ? { channel: 'branch', branch: pendingBranch.value }
        : { channel: pendingChannel.value },
      'Could not change the update channel.',
    );
    confirmChannelOpen.value = false;
  };

  const channelVersion = (channel: UpdateChannel) => {
    if (channel !== savedChannel.value) {
      return '—';
    }

    return (
      statusData.value?.remote.version || (statusData.value?.remote.commit ?? '').slice(0, 7) || '—'
    );
  };

  const installedLabel = computed(() => {
    const installed = statusData.value?.installed;

    return installed?.version || (installed?.commit ?? '').slice(0, 7) || '—';
  });

  const statusTag = computed(() => {
    if (!statusData.value?.lastCheckedAt) {
      return { color: 'default', label: 'Not checked yet' };
    }

    return statusData.value.updateAvailable
      ? { color: 'attn', label: 'Update available' }
      : { color: 'live', label: 'Up to date' };
  });

  const formatDate = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');

  const activeRun = ref<UpdateRun | null>(null);
  const polling = ref(false);
  const pollOffline = ref(false);
  let pollGeneration = 0;
  let pollHandle: ReturnType<typeof setTimeout> | null = null;

  const POLL_INTERVAL_MS = 3000;

  const phase = computed(() => updateRunPhase(activeRun.value, polling.value));

  const startPolling = (runId: string) => {
    pollGeneration += 1;

    const generation = pollGeneration;

    if (pollHandle) {
      clearTimeout(pollHandle);
    }

    polling.value = true;

    const tick = async () => {
      if (generation !== pollGeneration) {
        return;
      }

      try {
        const latest = await getRun(runId);

        if (generation !== pollGeneration) {
          return;
        }

        activeRun.value = latest;
        pollOffline.value = false;

        if (latest.status === 'running') {
          pollHandle = setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          polling.value = false;
          pollHandle = null;
          refreshStatus();
        }
      } catch {
        if (generation !== pollGeneration) {
          return;
        }

        pollOffline.value = true;
        pollHandle = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    tick();
  };

  onBeforeUnmount(() => {
    pollGeneration += 1;

    if (pollHandle) {
      clearTimeout(pollHandle);
    }
  });

  watch(
    () => statusData.value?.lastRunId,
    async (runId, previous) => {
      if (!runId || runId === previous || activeRun.value?.id === runId) {
        return;
      }

      try {
        const existing = await getRun(runId);

        activeRun.value = existing;

        if (existing.status === 'running') {
          startPolling(runId);
        }
      } catch {
        // The agent could not be reached while resuming a past run; "Check for updates" retries.
      }
    },
    { immediate: true },
  );

  const checking = ref(false);

  const checkForUpdates = async () => {
    checking.value = true;

    try {
      await check();
      await refreshStatus();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: errorMessageOf(error, 'Could not check for updates.'),
      });
    } finally {
      checking.value = false;
    }
  };

  const confirmForceOpen = ref(false);
  const forcing = ref(false);

  const forceUpdate = async () => {
    forcing.value = true;

    try {
      const dispatched = await runUpdate(true);

      activeRun.value = dispatched;
      confirmForceOpen.value = false;
      startPolling(dispatched.id);
      await refreshStatus();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: errorMessageOf(error, 'Could not start the update.'),
      });
    } finally {
      forcing.value = false;
    }
  };

  const logLines = computed(() =>
    (activeRun.value?.log ?? '').split('\n').filter(line => line !== ''),
  );

  const logBox = ref<HTMLElement | null>(null);

  watch(logLines, () => {
    const box = logBox.value;

    if (!box) {
      return;
    }

    nextTick(() => (box.scrollTop = box.scrollHeight));
  });
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <template v-if="statusLoadStatus === 'pending' && !hasLoadedOnce">
      <SkeletonCard :rows="2" />
      <SkeletonCard :rows="4" />
      <SkeletonCard :rows="2" />
    </template>

    <Alert v-else-if="statusErrorMessage" theme="error">{{ statusErrorMessage }}</Alert>

    <template v-else>
      <Card title="Automatic updates" rows>
        <template #right>
          <Switch v-model="autoEnabled" aria-label="Automatic updates" :disabled="saving" />
        </template>

        <Row
          as="div"
          :class="
            autoEnabled
              ? 'flex flex-wrap items-center gap-y-1.5'
              : 'flex flex-wrap items-center gap-y-1.5 pointer-events-none opacity-50'
          "
        >
          <div class="w-33 shrink-0 text-[13px] text-ink-2">Frequency</div>
          <Segmented v-model="frequency" :options="FREQUENCY_OPTIONS" size="sm" />
        </Row>
        <Row
          as="div"
          :class="
            autoEnabled
              ? 'flex flex-wrap items-center gap-y-1.5'
              : 'flex flex-wrap items-center gap-y-1.5 opacity-50'
          "
        >
          <div class="w-33 shrink-0 text-[13px] text-ink-2">Next check</div>
          <div class="min-w-0 flex-1 text-[13px] text-ink wrap-break-word">
            {{ formatDate(statusData?.nextCheckAt) }}
          </div>
        </Row>
        <Row v-if="autoEnabled && savedChannel !== 'stable'" as="div" class="flex items-start">
          <p class="text-caption text-ink-2">
            Automatic updates only apply themselves on the stable channel. On
            {{ savedChannel }} they check and notify — start the update from below.
          </p>
        </Row>
      </Card>

      <Card
        title="Update channel"
        description="Where releases are pulled from."
        content-class="p-0"
      >
        <div
          v-for="channel in CHANNELS"
          :key="channel.value"
          class="border-t border-hairline first:border-t-0"
        >
          <div
            class="flex cursor-pointer items-start gap-3.5 px-4.25 py-3.25"
            :class="uiChannel === channel.value && 'bg-row-hover'"
            @click="uiChannel = channel.value"
          >
            <Radio
              :id="`channel-${channel.value}`"
              v-model="uiChannel"
              name="update-channel"
              :value="channel.value"
              :disabled="saving"
              class="mt-0.5"
            />
            <div class="min-w-0 flex-1">
              <label
                :for="`channel-${channel.value}`"
                class="cursor-pointer text-[13.5px] font-medium text-ink"
              >
                {{ channel.title }}
              </label>
              <p class="text-caption text-ink-2">
                {{
                  channel.value === 'branch' && savedChannel === 'branch'
                    ? `Tracking “${statusData?.branch}”.`
                    : channel.description
                }}
              </p>
            </div>
            <div class="shrink-0 self-center font-mono text-[13px] text-ink-2">
              {{ channelVersion(channel.value) }}
            </div>
          </div>

          <div
            v-if="channel.value === 'branch' && uiChannel === 'branch'"
            class="flex items-center gap-2.5 px-4.25 pb-3.25"
          >
            <Input
              v-model="branchDraft"
              mono
              boxed
              bare
              placeholder="feature/queue-rewrite"
              class="flex-1"
            />
            <Button theme="secondary" size="sm" :disabled="saving" @click="applyBranch">
              Use branch
            </Button>
          </div>
        </div>
      </Card>

      <Card rows>
        <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
          <div class="w-33 shrink-0 text-[13px] text-ink-2">Installed</div>
          <div class="min-w-0 flex-1 font-mono text-[13px] text-ink">
            {{ installedLabel }} · {{ statusData?.installed.channel || savedChannel }}
          </div>
          <Tag :color="statusTag.color">{{ statusTag.label }}</Tag>
        </Row>
        <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
          <div class="w-33 shrink-0 text-[13px] text-ink-2">Last checked</div>
          <div class="min-w-0 flex-1 text-[13px] text-ink">
            {{ formatDate(statusData?.lastCheckedAt) }}
            <span v-if="statusData?.lastCheckSource" class="text-ink-2">
              · {{ statusData.lastCheckSource }}
            </span>
          </div>
        </Row>

        <Row v-if="statusData?.lastCheckError" as="div" class="flex items-start">
          <Alert theme="error" class="w-full">{{ statusData.lastCheckError }}</Alert>
        </Row>

        <template #footer>
          <div class="flex flex-1 flex-wrap items-center justify-between gap-3">
            <p class="text-caption text-ink-2">
              {{
                statusData?.updateAvailable
                  ? `${channelVersion(savedChannel)} is ready on the ${savedChannel} channel.`
                  : 'Forcing an update reinstalls the current channel head, even if nothing changed.'
              }}
            </p>
            <div class="flex gap-2">
              <Button theme="secondary" size="sm" :disabled="checking" @click="checkForUpdates">
                <Icon v-if="checking" name="svg-spinners:tadpole" size="16" />
                Check for updates
              </Button>
              <Button
                theme="primary"
                size="sm"
                :disabled="phase === 'updating'"
                @click="confirmForceOpen = true"
              >
                Force update now
              </Button>
            </div>
          </div>
        </template>
      </Card>

      <Card
        v-if="phase !== 'idle'"
        :title="`Update run · ${activeRun?.channel ?? savedChannel}`"
        rows
      >
        <template #right>
          <Tag
            :color="
              phase === 'succeeded'
                ? 'live'
                : phase === 'failed' || phase === 'unknown'
                  ? 'failed'
                  : 'attn'
            "
          >
            {{ phase }}
          </Tag>
        </template>

        <Row v-if="pollOffline" as="div" class="flex items-start">
          <Alert theme="warning" class="w-full">
            Lost the connection to the backend — that is expected while it restarts. Still watching
            for it to come back.
          </Alert>
        </Row>

        <Row v-if="phase === 'unknown'" as="div" class="flex items-start">
          <Alert theme="warning" class="w-full">
            The updater container is gone and never wrote its outcome. Check the installation before
            trusting it.
          </Alert>
        </Row>

        <Row v-if="activeRun?.error" as="div" class="flex items-start">
          <Alert theme="error" class="w-full">{{ activeRun.error }}</Alert>
        </Row>

        <Row
          v-if="activeRun?.rollbackCommand && phase !== 'updating'"
          as="div"
          class="flex items-start"
        >
          <div class="min-w-0 flex-1">
            <div class="text-[13px] text-ink-2">Roll back by running this on the host:</div>
            <code
              class="mt-1 block overflow-x-auto rounded-control bg-inset px-2.5 py-1.5 text-[12.5px]"
            >
              {{ activeRun.rollbackCommand }}
            </code>
          </div>
        </Row>

        <div
          ref="logBox"
          class="max-h-80 overflow-auto rounded-card bg-terminal p-4 font-mono text-[12.5px] leading-[1.8] whitespace-pre-wrap text-white/80"
        >
          <p v-if="!logLines.length" class="text-white/50">Waiting for output…</p>
          <div v-for="(line, index) in logLines" :key="index">{{ line }}</div>
        </div>
      </Card>
    </template>

    <Confirm
      v-model:open="confirmChannelOpen"
      title="Switch update channel"
      :message="confirmChannelMessage"
      confirm-label="Switch channel"
      :danger="channelDowngrade"
      :loading="saving"
      @confirm="confirmChannelApply"
    />

    <Confirm
      v-model:open="confirmForceOpen"
      title="Force update now"
      :message="`This reinstalls the ${savedChannel} channel head and restarts the stack. The dashboard will lose connection during the restart — that is expected, not a failure.`"
      confirm-label="Update now"
      :loading="forcing"
      @confirm="forceUpdate"
    />
  </div>
</template>
