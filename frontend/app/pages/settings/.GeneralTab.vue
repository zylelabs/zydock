<script setup lang="ts">
  import { z } from 'zod';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import type { Organization } from '~/stores/organization.store';
  import {
    useDashboardSettings,
    type DashboardSettings,
    type DashboardStatus,
  } from '~/composables/services/useDashboardSettings';

  const props = defineProps<{
    organization: Organization;
    canManage: boolean;
    memberCount: number;
    memberCountLoading: boolean;
  }>();

  const toast = useToast();
  const { update } = useOrganizations();
  const session = useSessionStore();

  const isSuperuser = computed(() => Boolean(session.user?.superuser));

  const editing = ref(false);

  const form = useSchemaForm(
    z.object({ name: z.string().trim().min(1, 'Enter a name') }),
    { name: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const startEdit = () => {
    form.values.name = props.organization.name;
    editing.value = true;
  };

  const handleSave = form.submit(async values => {
    await update(props.organization.id, { name: values.name });
    editing.value = false;
  });

  const formatDate = (value: string) => new Date(value).toLocaleDateString('en-US');

  const errorMessageOf = (error: unknown, fallback: string) =>
    (error as { message?: string })?.message || fallback;

  const { get, save, remove, check } = useDashboardSettings();

  const emptyDashboardSettings: DashboardSettings = {
    domain: '',
    name: 'Zydock',
    status: 'disabled',
    publicIp: '',
    ipUrl: '',
    requestHost: '',
    dnsMismatch: false,
  };

  const {
    data: dashboardSettings,
    refresh: refreshDashboardSettings,
    status: dashboardLoadStatus,
    error: dashboardLoadError,
  } = useLazyAsyncData(
    'settings-panel-domain',
    () => (isSuperuser.value ? get() : Promise.resolve(emptyDashboardSettings)),
    { server: false, watch: [isSuperuser], default: () => emptyDashboardSettings },
  );

  const isDashboardFirstLoad = useFirstLoad(dashboardLoadStatus);

  const dashboardLoadErrorMessage = computed(
    () =>
      (dashboardLoadError.value as { message?: string } | null)?.message ||
      (dashboardLoadError.value ? 'Could not load the panel domain settings.' : ''),
  );

  const DASHBOARD_STATUS_TAG: Record<DashboardStatus, { label: string; color: string }> = {
    disabled: { label: 'Disabled', color: 'default' },
    pending: { label: 'Pending', color: 'attn' },
    active: { label: 'Active', color: 'live' },
    error: { label: 'Error', color: 'failed' },
  };

  const hostnameSchema = z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
      'Enter a valid domain, e.g. panel.example.com',
    );

  const { panelName } = usePanelName();

  const domainForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name').max(60),
      domain: hostnameSchema,
    }),
    { name: '', domain: '' },
    {
      onError: (message, error) => {
        console.error('Failed to save the panel settings:', error);
        toast.error({ title: 'Error', message });
      },
    },
  );

  watch(
    () => dashboardSettings.value?.domain,
    value => {
      domainForm.values.domain = value ?? '';
    },
    { immediate: true },
  );

  watch(
    () => dashboardSettings.value?.name,
    value => {
      domainForm.values.name = value ?? '';
    },
    { immediate: true },
  );

  const editingDomain = ref(false);

  const startEditDomain = () => {
    domainForm.values.name = dashboardSettings.value?.name ?? '';
    domainForm.values.domain = dashboardSettings.value?.domain ?? '';
    editingDomain.value = true;
  };

  const cancelEditDomain = () => {
    domainForm.reset();
    domainForm.values.name = dashboardSettings.value?.name ?? '';
    domainForm.values.domain = dashboardSettings.value?.domain ?? '';
    editingDomain.value = false;
  };

  const handleSaveDomain = domainForm.submit(async values => {
    const domainChanged = values.domain !== (dashboardSettings.value?.domain ?? '');

    await save({ name: values.name, domain: domainChanged ? values.domain : undefined });
    await refreshDashboardSettings();
    panelName.value = values.name;
    editingDomain.value = false;
    toast.success({ title: 'Saved', message: 'The panel settings were saved.' });
  });

  const checkingDomain = ref(false);

  const checkDomainAgain = async () => {
    checkingDomain.value = true;

    try {
      await check();
      await refreshDashboardSettings();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: errorMessageOf(error, 'Could not re-check the domain.'),
      });
    } finally {
      checkingDomain.value = false;
    }
  };

  const showDomainCheck = computed(
    () =>
      !editingDomain.value &&
      (dashboardSettings.value?.status === 'pending' ||
        dashboardSettings.value?.status === 'error'),
  );

  const removeDomainOpen = ref(false);
  const removingDomain = ref(false);

  const confirmRemoveDomain = async () => {
    removingDomain.value = true;

    try {
      await remove();
      domainForm.values.domain = '';
      removeDomainOpen.value = false;
      editingDomain.value = false;
      await refreshDashboardSettings();
      toast.success({ title: 'Removed', message: 'The panel now answers only on the IP.' });
    } catch (error) {
      toast.error({
        title: 'Error',
        message: errorMessageOf(error, 'Could not remove the domain.'),
      });
    } finally {
      removingDomain.value = false;
    }
  };

  const formatCertificateDate = (value?: string) =>
    value ? new Date(value).toLocaleDateString('en-US') : '—';

  const panelUrlDescription = computed(() =>
    dashboardSettings.value?.publicIp
      ? `Reach the dashboard by domain instead of the server IP. Point an A record at ${dashboardSettings.value.publicIp} first.`
      : "Reach the dashboard by domain instead of the server IP. Point an A record at this server's public IP first.",
  );

  /**
   * The proxy always terminates TLS for the panel domain, so this line reports where the
   * certificate is rather than offering a switch that controls nothing.
   */
  const httpsLine = computed(() => {
    const settings = dashboardSettings.value;

    if (!settings?.domain) {
      return "A Let's Encrypt certificate is issued once the domain is saved, and plain HTTP redirects to it.";
    }

    if (settings.status === 'active') {
      return settings.certificateIssuer
        ? `Certificate issued by ${settings.certificateIssuer} · expires ${formatCertificateDate(settings.certificateExpiresAt)}. Plain HTTP redirects to it.`
        : 'Certificate active. Plain HTTP redirects to it.';
    }

    if (settings.status === 'error') {
      return 'The certificate could not be issued. Fix the DNS record and check again.';
    }

    return "Issuing a Let's Encrypt certificate — it lands once the A record resolves to this server.";
  });
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <Card title="General" rows>
      <template v-if="canManage" #right>
        <Button v-if="!editing" theme="secondary" size="xs" @click="startEdit">Edit</Button>
      </template>

      <template v-if="!editing">
        <Row as="div" class="flex items-center">
          <div class="w-33 shrink-0 text-caption text-ink-2">Name</div>
          <div class="truncate text-caption text-ink">{{ organization.name }}</div>
        </Row>
        <Row as="div" class="flex items-center">
          <div class="w-33 shrink-0 text-caption text-ink-2">Slug</div>
          <div class="truncate font-mono text-caption text-ink">{{ organization.slug }}</div>
        </Row>
        <Row as="div" class="flex items-center">
          <div class="w-33 shrink-0 text-caption text-ink-2">Created</div>
          <div class="text-caption text-ink">{{ formatDate(organization.createdAt) }}</div>
        </Row>
        <Row as="div" class="flex items-center">
          <div class="w-33 shrink-0 text-caption text-ink-2">Your role</div>
          <Tag class="capitalize">{{ organization.role }}</Tag>
        </Row>
        <Row as="div" class="flex items-center">
          <div class="w-33 shrink-0 text-caption text-ink-2">Members</div>
          <SkeletonText v-if="memberCountLoading" :lines="1" class="w-8" />
          <div v-else class="text-caption text-ink">{{ memberCount }}</div>
        </Row>
      </template>

      <form v-else class="flex flex-col" @submit.prevent="handleSave">
        <Input v-model="form.values.name" label="Name" boxed :call-error="form.errors.value.name" />

        <div class="flex justify-end gap-2 px-4.25 py-3.25">
          <Button theme="quiet" size="sm" type="button" @click="editing = false">Cancel</Button>
          <Button theme="primary" size="sm" type="submit" :disabled="form.loading.value">
            <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
            Save
          </Button>
        </div>
      </form>
    </Card>

    <template v-if="isSuperuser">
      <SkeletonCard v-if="isDashboardFirstLoad" :rows="3" />

      <Alert v-else-if="dashboardLoadErrorMessage" theme="error">{{
        dashboardLoadErrorMessage
      }}</Alert>

      <Card v-else title="Panel" :description="panelUrlDescription" rows>
        <template #right>
          <div class="flex items-center justify-end gap-2">
            <Tag
              v-if="dashboardSettings?.domain"
              :color="DASHBOARD_STATUS_TAG[dashboardSettings.status].color"
            >
              {{ DASHBOARD_STATUS_TAG[dashboardSettings.status].label }}
            </Tag>
            <Button v-if="!editingDomain" theme="secondary" size="xs" @click="startEditDomain">
              Edit
            </Button>
          </div>
        </template>

        <template v-if="!editingDomain">
          <Row v-if="dashboardSettings?.lastError" as="div" class="flex items-start">
            <Alert theme="error" class="w-full">{{ dashboardSettings.lastError }}</Alert>
          </Row>

          <Row v-if="dashboardSettings?.dnsMismatch" as="div" class="flex items-start">
            <Alert theme="warning" class="w-full">
              The A record of this hostname does not point to this server's IP yet. The proxy keeps
              retrying automatically once DNS propagates.
            </Alert>
          </Row>

          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-caption text-ink-2">Name</div>
            <div class="truncate text-caption text-ink">{{ dashboardSettings?.name }}</div>
          </Row>

          <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
            <div class="w-33 shrink-0 text-caption text-ink-2">URL</div>
            <div
              v-if="dashboardSettings?.domain"
              class="min-w-0 flex-1 font-mono text-caption text-ink wrap-break-word"
            >
              {{ dashboardSettings.domain }}
            </div>
            <div v-else class="min-w-0 flex-1 text-caption text-ink-2">
              Not set — the panel answers on the IP only.
            </div>
            <a
              v-if="dashboardSettings?.status === 'active' && dashboardSettings?.domain"
              :href="`https://${dashboardSettings.domain}`"
              target="_blank"
              rel="noopener noreferrer"
              class="shrink-0 text-caption text-accent hover:underline"
            >
              Open
            </a>
          </Row>

          <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
            <div class="w-33 shrink-0 text-caption text-ink-2">HTTPS</div>
            <div class="min-w-0 flex-1 text-caption text-ink wrap-break-word">
              {{ httpsLine }}
            </div>
          </Row>

          <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
            <div class="w-33 shrink-0 text-caption text-ink-2">Fallback access</div>
            <div class="min-w-0 flex-1 font-mono text-caption text-ink wrap-break-word">
              {{ dashboardSettings?.publicIp || dashboardSettings?.ipUrl || '—' }}
            </div>
            <span class="shrink-0 text-caption text-ink-2">stays available</span>
          </Row>

          <Row v-if="dashboardSettings?.domain" as="div" class="flex items-start">
            <p class="text-caption text-ink-2">
              Signing in again is required when the panel is opened from the new domain — sessions
              don't move between origins. Existing GitHub App git sources keep pointing their
              callback URL at the old address; update it manually on GitHub, from Settings → Git
              sources.
            </p>
          </Row>
        </template>

        <form v-else class="flex flex-col" @submit.prevent="handleSaveDomain">
          <Input
            v-model="domainForm.values.name"
            label="Name"
            boxed
            :disabled="domainForm.loading.value"
            :call-error="domainForm.errors.value.name"
          />

          <Input
            v-model="domainForm.values.domain"
            label="URL"
            mono
            boxed
            placeholder="panel.example.com"
            :disabled="domainForm.loading.value"
            :call-error="domainForm.errors.value.domain"
          />

          <div class="flex flex-wrap items-center justify-end gap-2 px-4.25 py-3.25">
            <Button
              v-if="dashboardSettings?.domain"
              theme="quiet"
              size="sm"
              type="button"
              class="mr-auto"
              @click="removeDomainOpen = true"
            >
              Remove domain
            </Button>
            <Button theme="quiet" size="sm" type="button" @click="cancelEditDomain">Cancel</Button>
            <Button theme="primary" size="sm" type="submit" :disabled="domainForm.loading.value">
              <Icon v-if="domainForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </form>

        <template v-if="showDomainCheck" #footer>
          <div class="flex flex-1 flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 flex-1 basis-70 text-caption text-ink-2">
              The certificate is picked up on the next check — DNS can take a few minutes to
              propagate.
            </p>
            <Button
              theme="secondary"
              size="sm"
              type="button"
              class="shrink-0"
              :disabled="checkingDomain"
              @click="checkDomainAgain"
            >
              <Icon v-if="checkingDomain" name="svg-spinners:tadpole" size="16" />
              Check again
            </Button>
          </div>
        </template>
      </Card>
    </template>

    <Confirm
      v-model:open="removeDomainOpen"
      title="Remove domain"
      message="The panel goes back to answering only on the IP. This can't be undone automatically — you would need to set the domain again."
      confirm-label="Remove"
      danger
      :loading="removingDomain"
      @confirm="confirmRemoveDomain"
    />
  </div>
</template>
