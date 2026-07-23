<script setup lang="ts">
  import { z } from 'zod';
  import type { Domain, DomainCertificate, DomainStatus } from '~/composables/use-domains';

  useHead({ title: 'Domains' });

  const session = useSessionStore();
  const { current } = useOrganizations();
  const domains = useDomains();
  const applications = useApplications();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');
  const busy = ref('');

  const { data, refresh } = await useAsyncData(
    'domains',
    async () => {
      if (!session.organizationId) {
        return { domains: [], applications: [] };
      }

      const [domainList, appList] = await Promise.all([domains.list(), applications.list()]);

      return { domains: domainList.items, applications: appList.items };
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => ({ domains: [], applications: [] }),
    },
  );

  const domainList = computed(() => data.value?.domains ?? []);
  const appOptions = computed(() =>
    (data.value?.applications ?? []).map(app => ({
      value: app.id,
      label: `${app.name} (${app.slug})`,
    })),
  );
  const appName = (id: string) =>
    (data.value?.applications ?? []).find(app => app.id === id)?.name ?? id;

  const STATUS: Record<
    DomainStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    pending: { label: 'Pending', variant: 'warning' },
    active: { label: 'Active', variant: 'success' },
    error: { label: 'Error', variant: 'danger' },
  };

  const adding = ref(false);
  const form = useForm(
    z.object({
      applicationId: z.string().min(1, 'Choose an application'),
      hostname: z.string().trim().min(1, 'Enter the domain'),
      pathPrefix: z.string().trim().optional(),
      tls: z.boolean(),
    }),
    { applicationId: '', hostname: '', pathPrefix: '', tls: true },
  );

  const openAdd = () => {
    form.reset();
    form.values.applicationId = data.value?.applications[0]?.id ?? '';
    adding.value = true;
  };

  const onCreate = form.submit(async values => {
    await domains.create({
      applicationId: values.applicationId,
      hostname: values.hostname,
      pathPrefix: values.pathPrefix || undefined,
      tls: values.tls,
    });
    adding.value = false;
    await refresh();
  });

  const runAction = async (domain: Domain, action: 'apply' | 'renew') => {
    actionError.value = '';
    busy.value = `${domain.id}:${action}`;

    try {
      await domains[action](domain.id);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'The operation failed.';
    } finally {
      busy.value = '';
    }
  };

  const toRemove = ref<Domain | null>(null);
  const removing = ref(false);

  const confirmRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;
    actionError.value = '';

    try {
      await domains.remove(toRemove.value.id);
      await refresh();
      toRemove.value = null;
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to remove.';
    } finally {
      removing.value = false;
    }
  };

  const editingDomain = ref('');
  const editPathPrefix = ref('');
  const editTls = ref(true);
  const editError = ref('');
  const editBusy = ref(false);

  const startEdit = (domain: Domain) => {
    actionError.value = '';
    editError.value = '';
    editingDomain.value = domain.id;
    editPathPrefix.value = domain.pathPrefix ?? '';
    editTls.value = domain.tls;
  };

  const saveEdit = async () => {
    editError.value = '';
    editBusy.value = true;

    try {
      await domains.update(editingDomain.value, {
        pathPrefix: editPathPrefix.value.trim() || null,
        tls: editTls.value,
      });
      editingDomain.value = '';
      await refresh();
    } catch (error) {
      editError.value = (error as { message?: string }).message || 'Failed to save the domain.';
    } finally {
      editBusy.value = false;
    }
  };

  const certificates = ref<Record<string, DomainCertificate>>({});
  const certificateFailed = ref<Record<string, boolean>>({});
  const certificateOpen = ref('');
  const certificateLoading = ref(false);

  const toggleCertificate = async (domain: Domain) => {
    if (certificateOpen.value === domain.id) {
      certificateOpen.value = '';
      return;
    }

    certificateOpen.value = domain.id;

    if (certificates.value[domain.id] || certificateFailed.value[domain.id]) {
      return;
    }

    certificateLoading.value = true;

    try {
      certificates.value[domain.id] = await domains.certificate(domain.id);
    } catch {
      certificateFailed.value[domain.id] = true;
    } finally {
      certificateLoading.value = false;
    }
  };

  const daysRemaining = (expiresAt?: string) =>
    expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : undefined;
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1>Domains</h1>
        <p class="mt-1 text-sm text-content-muted">Names and HTTPS for your applications.</p>
      </div>
      <UiButton
        v-if="current && canManage && !adding"
        :disabled="!appOptions.length"
        @click="openAdd"
      >
        <Icon name="lucide:plus" class="size-4" />
        Add domain
      </UiButton>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">Choose or create an organization in the sidebar.</p>
    </UiCard>

    <template v-else>
      <UiCard v-if="adding" title="Add domain">
        <form class="flex flex-col gap-4" @submit.prevent="onCreate">
          <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>
          <UiSelect
            v-model="form.values.applicationId"
            label="Application"
            :options="appOptions"
            :error="form.errors.value.applicationId"
          />
          <div class="grid gap-4 sm:grid-cols-2">
            <UiInput
              v-model="form.values.hostname"
              label="Domain"
              placeholder="app.example.com"
              :error="form.errors.value.hostname"
            />
            <UiInput
              v-model="form.values.pathPrefix"
              label="Path prefix (optional)"
              placeholder="/api"
            />
          </div>
          <UiCheckbox v-model="form.values.tls" label="Automatic HTTPS (Let's Encrypt)" />
          <div class="flex justify-end gap-2">
            <UiButton variant="ghost" type="button" @click="adding = false">Cancel</UiButton>
            <UiButton type="submit" :loading="form.submitting.value">Add</UiButton>
          </div>
        </form>
      </UiCard>

      <UiCard v-if="!domainList.length" title="No domains yet">
        <p class="text-sm text-content-muted">Add a domain to an application to publish it.</p>
      </UiCard>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="domain in domainList"
          :key="domain.id"
          class="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-4"
        >
          <div class="flex flex-wrap items-center gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <Icon v-if="domain.tls" name="lucide:lock" class="size-4 text-success" />
                <span class="truncate font-medium"
                  >{{ domain.hostname }}{{ domain.pathPrefix }}</span
                >
                <UiBadge :variant="STATUS[domain.status].variant">
                  {{ STATUS[domain.status].label }}
                </UiBadge>
              </div>
              <p class="mt-1 truncate text-xs text-content-muted">
                {{ appName(domain.applicationId) }}
              </p>
              <p v-if="domain.lastError" class="mt-1 truncate text-xs text-danger">
                {{ domain.lastError }}
              </p>
            </div>

            <div v-if="canManage" class="flex flex-wrap items-center gap-2">
              <UiButton
                variant="secondary"
                :loading="busy === `${domain.id}:apply`"
                @click="runAction(domain, 'apply')"
              >
                Apply
              </UiButton>
              <UiButton
                v-if="domain.tls"
                variant="ghost"
                :loading="busy === `${domain.id}:renew`"
                @click="runAction(domain, 'renew')"
              >
                Renew
              </UiButton>
              <UiButton variant="ghost" @click="toggleCertificate(domain)">Certificate</UiButton>
              <UiButton variant="ghost" @click="startEdit(domain)">Edit</UiButton>
              <button
                type="button"
                title="Remove"
                class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
                @click="toRemove = domain"
              >
                <Icon name="lucide:trash-2" class="size-4" />
              </button>
            </div>
          </div>

          <form
            v-if="editingDomain === domain.id"
            class="flex flex-col gap-3 border-t border-surface-border pt-3"
            @submit.prevent="saveEdit"
          >
            <UiAlert v-if="editError" variant="error">{{ editError }}</UiAlert>

            <div class="grid gap-4 sm:grid-cols-2">
              <UiInput v-model="editPathPrefix" label="Path prefix" placeholder="/api" />
              <div class="flex items-end pb-2">
                <UiCheckbox v-model="editTls" label="Automatic HTTPS (Let's Encrypt)" />
              </div>
            </div>

            <p class="text-xs text-content-muted">
              To change the hostname or the linked application, remove this domain and add it again.
            </p>

            <div class="flex justify-end gap-2">
              <UiButton variant="ghost" type="button" @click="editingDomain = ''">Cancel</UiButton>
              <UiButton type="submit" :loading="editBusy">Save</UiButton>
            </div>
          </form>

          <div
            v-if="certificateOpen === domain.id"
            class="border-t border-surface-border pt-3 text-sm"
          >
            <p v-if="certificateLoading" class="text-content-muted">Loading…</p>
            <p v-else-if="certificateFailed[domain.id]" class="text-danger">
              Failed to load the certificate.
            </p>
            <template v-else-if="certificates[domain.id]">
              <div class="flex flex-wrap items-center gap-3">
                <UiBadge :variant="certificates[domain.id]!.valid ? 'success' : 'danger'">
                  {{ certificates[domain.id]!.valid ? 'Valid' : 'Invalid' }}
                </UiBadge>
                <span v-if="certificates[domain.id]!.issuer" class="text-content-muted">
                  Issued by {{ certificates[domain.id]!.issuer }}
                </span>
              </div>
              <p v-if="certificates[domain.id]!.expiresAt" class="mt-1 text-content-muted">
                Expires
                {{ new Date(certificates[domain.id]!.expiresAt!).toLocaleDateString('en-US') }}
                <span v-if="daysRemaining(certificates[domain.id]!.expiresAt) !== undefined">
                  ({{ daysRemaining(certificates[domain.id]!.expiresAt) }} days remaining)
                </span>
              </p>
            </template>
          </div>
        </div>
      </div>
    </template>

    <UiConfirm
      :open="Boolean(toRemove)"
      title="Remove domain"
      :message="`Remove ${toRemove?.hostname}? The route stops responding.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="confirmRemove"
      @update:open="value => !value && (toRemove = null)"
    />
  </section>
</template>
