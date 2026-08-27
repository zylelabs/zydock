<script setup lang="ts">
  import { formatBytes } from '~/utils';
  import {
    daysSince,
    restoreCommandOf,
    useInstallation,
    STANDBY_STALE_DAYS,
    type DnsChecklistEntry,
    type InstallationSnapshot,
    type InstallationState,
    type RestoreRun,
  } from '~/composables/services/useInstallation';

  const toast = useToast();
  const installationApi = useInstallation();

  const errorMessageOf = (error: unknown, fallback: string) =>
    (error as { message?: string })?.message || fallback;

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({ title: 'Error', message: errorMessageOf(error, fallback) });
  };

  const formatDate = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');

  const formatShortDate = (value?: string) =>
    value ? new Date(value).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : '—';

  // Status
  const emptyStatus: InstallationState = { role: 'active', note: '' };

  const {
    data: statusData,
    refresh: refreshStatus,
    status: statusLoadStatus,
    error: statusLoadError,
  } = useLazyAsyncData('settings-installation-status', () => installationApi.getStatus(), {
    server: false,
    default: () => emptyStatus,
  });

  const isFirstLoad = useFirstLoad(statusLoadStatus);

  const statusErrorMessage = computed(() =>
    errorMessageOf(
      statusLoadError.value,
      statusLoadError.value ? 'Could not load the installation status.' : '',
    ),
  );

  const role = computed(() => statusData.value?.role ?? 'active');
  const dataAge = computed(() => statusData.value?.dataFrom ?? statusData.value?.demotedAt);
  const dataAgeDays = computed(() => daysSince(dataAge.value));
  const isStale = computed(
    () => role.value === 'standby' && dataAgeDays.value >= STANDBY_STALE_DAYS,
  );

  // Snapshots
  const { data: snapshotsData, refresh: refreshSnapshots } = useLazyAsyncData(
    'settings-installation-snapshots',
    () => installationApi.listSnapshots(),
    { server: false, default: () => ({ snapshots: [] as InstallationSnapshot[] }) },
  );

  const snapshots = computed(() => snapshotsData.value?.snapshots ?? []);

  let snapshotsPollHandle: ReturnType<typeof setTimeout> | null = null;

  const snapshotsHavePending = computed(() =>
    snapshots.value.some(snapshot => snapshot.status === 'running'),
  );

  watch(
    snapshotsHavePending,
    pending => {
      if (snapshotsPollHandle) {
        clearTimeout(snapshotsPollHandle);
        snapshotsPollHandle = null;
      }

      if (pending) {
        snapshotsPollHandle = setTimeout(() => refreshSnapshots(), 3000);
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    if (snapshotsPollHandle) {
      clearTimeout(snapshotsPollHandle);
    }
  });

  const createOpen = ref(false);
  const creating = ref(false);
  const passphrase = ref('');
  const includeApplicationData = ref(false);

  const readyCommand = ref<{ fileName: string; command: string } | null>(null);
  const commandCopied = ref(false);

  const openCreate = () => {
    passphrase.value = '';
    includeApplicationData.value = false;
    readyCommand.value = null;
    createOpen.value = true;
  };

  const createSnapshot = async () => {
    creating.value = true;

    try {
      const { snapshot } = await installationApi.createSnapshot({
        passphrase: passphrase.value,
        includeApplicationData: includeApplicationData.value,
      });

      readyCommand.value = {
        fileName: snapshot.fileName,
        command: restoreCommandOf(snapshot.fileName, passphrase.value),
      };
      passphrase.value = '';
      await refreshSnapshots();
    } catch (error) {
      notifyError(error, 'Could not start the snapshot.');
    } finally {
      creating.value = false;
    }
  };

  const copyCommand = async () => {
    if (!readyCommand.value) {
      return;
    }

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(readyCommand.value.command);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = readyCommand.value.command;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }

      commandCopied.value = true;
      setTimeout(() => (commandCopied.value = false), 2000);
    } catch (error) {
      notifyError(error, 'Failed to copy to the clipboard.');
    }
  };

  const busy = ref('');

  const downloadSnapshot = async (snapshot: InstallationSnapshot) => {
    busy.value = `${snapshot.id}:download`;

    try {
      const blob = await installationApi.downloadSnapshot(snapshot.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = snapshot.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notifyError(error, 'Failed to download the snapshot.');
    } finally {
      busy.value = '';
    }
  };

  const toRemove = ref<InstallationSnapshot | null>(null);
  const confirmRemoveOpen = ref(false);
  const removing = ref(false);

  const openRemove = (snapshot: InstallationSnapshot) => {
    toRemove.value = snapshot;
    confirmRemoveOpen.value = true;
  };

  const removeSnapshot = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;

    try {
      await installationApi.removeSnapshot(toRemove.value.id);
      await refreshSnapshots();
      confirmRemoveOpen.value = false;
      toRemove.value = null;
    } catch (error) {
      notifyError(error, 'Failed to remove the snapshot.');
    } finally {
      removing.value = false;
    }
  };

  const snapshotTag = (snapshot: InstallationSnapshot) => {
    if (snapshot.status === 'completed') {
      return { color: 'live', label: 'Completed' };
    }

    if (snapshot.status === 'failed') {
      return { color: 'failed', label: 'Failed' };
    }

    return { color: 'attn', label: 'Running' };
  };

  // Restore from a bundle already on this host
  const restoreBundlePath = ref('');
  const restorePassphrase = ref('');
  const starting = ref(false);
  const confirmRestoreOpen = ref(false);

  const activeRestoreRun = ref<RestoreRun | null>(null);
  const restorePolling = ref(false);
  let restorePollGeneration = 0;
  let restorePollHandle: ReturnType<typeof setTimeout> | null = null;

  const RESTORE_POLL_INTERVAL_MS = 3000;

  const stopRestorePolling = () => {
    restorePollGeneration += 1;

    if (restorePollHandle) {
      clearTimeout(restorePollHandle);
      restorePollHandle = null;
    }

    restorePolling.value = false;
  };

  const startRestorePolling = () => {
    restorePollGeneration += 1;

    const generation = restorePollGeneration;

    restorePolling.value = true;

    const tick = async () => {
      if (generation !== restorePollGeneration) {
        return;
      }

      try {
        const latest = await installationApi.getRestoreRun();

        if (generation !== restorePollGeneration) {
          return;
        }

        activeRestoreRun.value = latest;

        if (latest.status === 'running') {
          restorePollHandle = setTimeout(tick, RESTORE_POLL_INTERVAL_MS);
        } else {
          restorePolling.value = false;
          restorePollHandle = null;
        }
      } catch {
        if (generation !== restorePollGeneration) {
          return;
        }

        restorePollHandle = setTimeout(tick, RESTORE_POLL_INTERVAL_MS);
      }
    };

    tick();
  };

  onMounted(async () => {
    try {
      const run = await installationApi.getRestoreRun();

      activeRestoreRun.value = run;

      if (run.status === 'running') {
        startRestorePolling();
      }
    } catch {
      // No restore has run on this installation yet.
    }
  });

  onBeforeUnmount(() => {
    stopRestorePolling();
  });

  const startRestore = async () => {
    starting.value = true;

    try {
      const run = await installationApi.startRestore({
        bundlePath: restoreBundlePath.value,
        passphrase: restorePassphrase.value,
      });

      activeRestoreRun.value = run;
      restorePassphrase.value = '';
      confirmRestoreOpen.value = false;
      startRestorePolling();
    } catch (error) {
      notifyError(error, 'Could not start the restore.');
    } finally {
      starting.value = false;
    }
  };

  const restoreLogLines = computed(() =>
    (activeRestoreRun.value?.log ?? '').split('\n').filter(line => line !== ''),
  );

  // Demote / promote
  const confirmDemoteOpen = ref(false);
  const confirmPromoteOpen = ref(false);
  const demoting = ref(false);
  const promoting = ref(false);
  const promoteForce = ref(false);

  const applyRoleChange = async (
    action: (force?: boolean) => Promise<InstallationState>,
    force: boolean,
    fallback: string,
    busyRef: typeof demoting,
  ) => {
    busyRef.value = true;

    try {
      await action(force);
      await Promise.all([refreshStatus(), refreshDnsChecklist()]);
      confirmDemoteOpen.value = false;
      confirmPromoteOpen.value = false;
    } catch (error) {
      notifyError(error, fallback);
    } finally {
      busyRef.value = false;
    }
  };

  const demoteNow = () =>
    applyRoleChange(
      () => installationApi.demote(),
      false,
      'Could not put the installation in standby.',
      demoting,
    );

  const promoteNow = () =>
    applyRoleChange(
      force => installationApi.promote({ force }),
      promoteForce.value,
      'Could not promote the installation.',
      promoting,
    );

  const openPromote = () => {
    promoteForce.value = false;
    confirmPromoteOpen.value = true;
  };

  // DNS checklist
  const { data: dnsData, refresh: refreshDnsChecklist } = useLazyAsyncData(
    'settings-installation-dns-checklist',
    () => installationApi.dnsChecklist(),
    { server: false, default: () => ({ domains: [] as DnsChecklistEntry[] }) },
  );

  const dnsDomains = computed(() => dnsData.value?.domains ?? []);
  const dnsMismatches = computed(
    () => dnsDomains.value.filter(domain => domain.pointsToOldIp).length,
  );

  const lastSnapshot = computed(
    () => snapshots.value.find(snapshot => snapshot.status === 'completed') ?? null,
  );

  const lastSnapshotSize = computed(() =>
    lastSnapshot.value?.sizeBytes ? formatBytes(lastSnapshot.value.sizeBytes) : '',
  );

  const dnsNote = computed(() =>
    dnsDomains.value.length ? `of ${dnsDomains.value.length} domain(s)` : 'no domains configured',
  );

  const originHost = computed(
    () => statusData.value?.replicaOf?.host || statusData.value?.replicaOf?.publicIp || '',
  );
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <template v-if="isFirstLoad">
      <SkeletonCard :rows="2" />
      <SkeletonCard :rows="3" />
    </template>

    <Alert v-else-if="statusErrorMessage" theme="error">{{ statusErrorMessage }}</Alert>

    <template v-else>
      <div class="grid gap-3.5 sm:grid-cols-3">
        <Metric label="State">
          <StatusDot :status="role === 'standby' ? 'attn' : 'live'" class="self-center" />
          <span class="text-metric-sm text-ink uppercase">{{ role }}</span>
        </Metric>

        <Metric
          label="Latest snapshot"
          :value="formatShortDate(lastSnapshot?.createdAt)"
          :note="lastSnapshotSize"
          sm
        />

        <Metric
          label="DNS pointing at old IP"
          :value="dnsMismatches ? String(dnsMismatches) : 'None'"
          :note="dnsNote"
          sm
        />
      </div>

      <Card
        title="Generate snapshot"
        description="An encrypted bundle of this installation, ready to copy to the new VPS."
        rows
      >
        <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
          <div class="w-33 shrink-0 text-caption text-ink-2">Contents</div>
          <div class="min-w-0 flex-1 text-caption text-ink">
            Panel database, secrets and the SSH credentials of every managed server
          </div>
        </Row>

        <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
          <div class="w-33 shrink-0 text-caption text-ink-2">Destination</div>
          <div class="min-w-0 flex-1 text-caption text-ink">
            Stored on this panel, then downloaded by you
          </div>
        </Row>

        <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
          <div class="w-33 shrink-0 text-caption text-ink-2">Last run</div>
          <div v-if="lastSnapshot" class="min-w-0 flex-1 font-mono text-caption text-ink">
            {{ lastSnapshot.fileName }}
          </div>
          <div v-else class="min-w-0 flex-1 text-caption text-ink-2">Never</div>
          <div v-if="lastSnapshot" class="shrink-0 text-caption text-ink-2">
            {{ formatDate(lastSnapshot.createdAt) }}
            <span v-if="lastSnapshotSize">· {{ lastSnapshotSize }}</span>
          </div>
        </Row>

        <template #footer>
          <div class="flex w-full flex-wrap items-center gap-3">
            <p class="min-w-0 flex-1 text-caption text-ink-2">
              Services keep running. Put this installation in standby first if you need a byte-exact
              copy.
            </p>
            <Button theme="primary" size="sm" @click="openCreate">Generate snapshot</Button>
          </div>
        </template>
      </Card>

      <Card
        v-if="snapshots.length"
        title="Snapshot history"
        description="Bundles generated on this installation."
        content-class="p-0"
      >
        <div
          v-for="snapshot in snapshots"
          :key="snapshot.id"
          class="flex items-center gap-3 border-t border-hairline px-4.25 py-3.25 first:border-t-0"
        >
          <div class="min-w-0 flex-1">
            <div class="font-mono text-caption text-ink">{{ snapshot.fileName }}</div>
            <div class="text-caption text-ink-2">
              {{ formatDate(snapshot.createdAt) }} ·
              {{ snapshot.sizeBytes ? formatBytes(snapshot.sizeBytes) : '—' }}
              <span v-if="snapshot.includesApplicationData">· includes application data</span>
            </div>
            <Alert v-if="snapshot.status === 'failed'" theme="error" class="mt-1.5">
              {{ snapshot.error }}
            </Alert>
          </div>
          <Tag :color="snapshotTag(snapshot).color">{{ snapshotTag(snapshot).label }}</Tag>
          <Button
            v-if="snapshot.status === 'completed'"
            theme="secondary"
            size="sm"
            :disabled="busy === `${snapshot.id}:download`"
            @click="downloadSnapshot(snapshot)"
          >
            <Icon v-if="busy === `${snapshot.id}:download`" name="svg-spinners:tadpole" size="16" />
            Download
          </Button>
          <button
            type="button"
            title="Remove snapshot"
            class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
            @click="openRemove(snapshot)"
          >
            <Icon name="lucide:trash-2" class="size-3.5" />
          </button>
        </div>
      </Card>

      <Card
        title="Restore a bundle"
        description="For a fresh, empty install that already has the encrypted bundle on disk."
        rows
      >
        <Input
          v-model="restoreBundlePath"
          label="Bundle path"
          mono
          boxed
          placeholder="/root/snapshot.zsnap"
        />

        <Input
          v-model="restorePassphrase"
          type="password"
          label="Passphrase"
          boxed
          bare
          placeholder="The one shown when the snapshot was made"
        />

        <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
          <div class="w-33 shrink-0 text-caption text-ink-2">Effect</div>
          <div class="min-w-0 flex-1 text-caption text-ink">
            Replaces the apps, volumes and databases on this host with the bundle’s.
          </div>
        </Row>

        <Row v-if="activeRestoreRun" as="div" class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <Tag
              :color="
                activeRestoreRun.status === 'success'
                  ? 'live'
                  : activeRestoreRun.status === 'failed' || activeRestoreRun.status === 'unknown'
                    ? 'failed'
                    : 'attn'
              "
            >
              {{ restorePolling ? 'running' : activeRestoreRun.status }}
            </Tag>
            <span class="text-caption text-ink-2"
              >Started {{ formatDate(activeRestoreRun.startedAt) }}</span
            >
          </div>
          <Alert v-if="activeRestoreRun.error" theme="error">{{ activeRestoreRun.error }}</Alert>
          <div
            v-if="restoreLogLines.length"
            class="max-h-60 overflow-auto rounded-card bg-terminal p-4 font-mono text-[12.5px] leading-[1.8] whitespace-pre-wrap text-terminal-ink"
          >
            <AnsiText
              v-for="(line, index) in restoreLogLines"
              :key="index"
              :text="line"
              class="block"
            />
          </div>
        </Row>

        <template #footer>
          <div class="flex w-full flex-wrap items-center gap-3">
            <p class="min-w-0 flex-1 text-caption text-ink-2">
              Run this on the destination VPS, not here.
            </p>
            <Button
              theme="primary"
              size="sm"
              :disabled="!restoreBundlePath || !restorePassphrase || restorePolling"
              @click="confirmRestoreOpen = true"
            >
              Start restore
            </Button>
          </div>
        </template>
      </Card>

      <Card
        v-if="dnsDomains.length"
        title="DNS checklist"
        description="Domains that still resolve to the old IP after a promotion."
        rows
      >
        <template #right>
          <Tag :color="dnsMismatches ? 'attn' : 'live'">
            {{ dnsMismatches ? `${dnsMismatches} pending` : 'All clear' }}
          </Tag>
        </template>

        <Row
          v-for="entry in dnsDomains"
          :key="entry.domain"
          as="div"
          class="flex items-center gap-2"
        >
          <div class="min-w-0 flex-1 font-mono text-caption text-ink">{{ entry.domain }}</div>
          <Tag :color="entry.pointsToOldIp ? 'attn' : 'live'">
            {{ entry.pointsToOldIp ? 'Old IP' : 'OK' }}
          </Tag>
        </Row>
      </Card>

      <div
        class="flex flex-wrap items-center gap-4 rounded-card border border-attn/40 bg-attn/5 px-4.25 py-3.25"
      >
        <div class="min-w-50 flex-1">
          <template v-if="role === 'active'">
            <div class="text-caption font-semibold text-attn-ink">Put in standby</div>
            <div class="mt-0.75 text-caption text-ink-2">
              Stops every service so the copy is consistent. Traffic drops until you resume or
              promote the new VPS.
            </div>
          </template>

          <template v-else>
            <div class="text-caption font-semibold text-attn-ink">Promote this installation</div>
            <div class="mt-0.75 text-caption text-ink-2">
              Data as of {{ formatDate(dataAge) }} · {{ dataAgeDays }} day(s) old<span
                v-if="originHost"
                >, copied from <span class="font-mono">{{ originHost }}</span></span
              >. Promoting makes this host the active panel again.
            </div>
          </template>
        </div>

        <Button v-if="role === 'active'" theme="attn" size="sm" @click="confirmDemoteOpen = true">
          Put in standby
        </Button>
        <Button v-else theme="primary" size="sm" @click="openPromote">Promote</Button>
      </div>

      <Alert v-if="isStale" theme="warning">
        This installation has been in standby for {{ dataAgeDays }} days. It still holds the
        encryption key, JWT secret and SSH credentials of every managed server — if the new
        installation is confirmed working, it is time to destroy this VPS.
      </Alert>
    </template>

    <Modal :open="createOpen" @on-close-modal="createOpen = false">
      <Card
        title="Generate snapshot"
        class="w-[32rem] max-w-full"
        close-button
        @on-close="createOpen = false"
      >
        <template v-if="readyCommand">
          <Alert theme="success">Snapshot started. It will finish in the background.</Alert>
          <p class="mt-3 text-caption text-ink-2">
            Download the bundle, copy it to the new VPS, then run this on it — the passphrase is not
            stored anywhere and cannot be recovered, so save it now:
          </p>
          <div class="mt-2 flex items-start gap-2">
            <code
              class="min-w-0 flex-1 overflow-x-auto rounded-control bg-inset px-2.5 py-1.5 text-caption"
            >
              {{ readyCommand.command }}
            </code>
            <button
              type="button"
              title="Copy command"
              class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-ink"
              @click="copyCommand"
            >
              <Icon :name="commandCopied ? 'lucide:check' : 'lucide:copy'" class="size-3.5" />
            </button>
          </div>
        </template>

        <template v-else>
          <p class="text-caption text-ink-2">
            The bundle carries every secret this installation has — the encryption key, JWT secret,
            the database password and the SSH credentials of every managed server. Choose a
            passphrase you will not lose: it is never stored and cannot be recovered.
          </p>
          <Input
            v-model="passphrase"
            type="password"
            label="Passphrase (min. 12 characters)"
            boxed
            bare
            class="mt-3"
          />
          <label class="mt-3 flex items-center gap-2 text-caption text-ink-2">
            <Switch v-model="includeApplicationData" aria-label="Include application data" />
            Include application and database volumes
          </label>
        </template>

        <template #footer>
          <div class="ml-auto flex items-center gap-2">
            <Button theme="quiet" @click="createOpen = false">Close</Button>
            <Button
              v-if="!readyCommand"
              theme="primary"
              :disabled="creating || passphrase.length < 12"
              @click="createSnapshot"
            >
              <Icon v-if="creating" name="svg-spinners:tadpole" size="16" />
              Generate
            </Button>
          </div>
        </template>
      </Card>
    </Modal>

    <Confirm
      v-model:open="confirmDemoteOpen"
      title="Put this installation in standby"
      message="This stops the queue, notifications and every mutation on this panel, and freezes its managed containers with a 'no' restart policy. Nothing is removed — the installation stays on disk as a rollback. Idempotent, but the panel becomes read-only until promoted again."
      confirm-label="Put in standby"
      danger
      :loading="demoting"
      @confirm="demoteNow"
    />

    <Confirm
      v-model:open="confirmPromoteOpen"
      title="Promote this installation"
      confirm-label="Promote"
      :loading="promoting"
      :message="
        statusData?.replicaOf?.host || statusData?.replicaOf?.publicIp
          ? 'This makes this installation the active one: it forces its public IP, reconciles missing database containers and reprovisions the managed SSH servers. It is blocked while the origin still answers as active.'
          : 'This makes this installation the active one and starts its queue, notifications and mutations again.'
      "
      @confirm="promoteNow"
    >
      <label
        v-if="statusData?.replicaOf?.host || statusData?.replicaOf?.publicIp"
        class="mt-3 flex items-center gap-2 text-caption text-ink-2"
      >
        <Switch v-model="promoteForce" aria-label="Force promotion" />
        Force — the origin could not be reached
      </label>
    </Confirm>

    <Confirm
      v-model:open="confirmRestoreOpen"
      title="Start restore"
      message="This tears down and rebuilds the stack on this host from the bundle, then leaves it in standby. It runs outside this panel — the API will go away in the middle, which is expected, not a failure."
      confirm-label="Start restore"
      danger
      :loading="starting"
      @confirm="startRestore"
    />

    <Confirm
      v-model:open="confirmRemoveOpen"
      title="Remove snapshot"
      :message="`Remove “${toRemove?.fileName}”? This cannot be undone.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="removeSnapshot"
    />
  </div>
</template>
