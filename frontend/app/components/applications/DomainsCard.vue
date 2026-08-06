<script setup lang="ts">
  import { z } from 'zod';
  import {
    useDomains,
    type Domain,
    type DomainCertificate,
    type DomainStatus,
  } from '~/composables/services/useDomains';

  const props = defineProps<{ applicationId: string; canManage: boolean }>();

  const session = useSessionStore();
  const domainsApi = useDomains();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const emptyDomains = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data, refresh: refreshDomains } = await useAsyncData(
    () => `application-${props.applicationId}-domains`,
    () =>
      session.organizationId
        ? domainsApi.list({ applicationId: props.applicationId })
        : Promise.resolve(emptyDomains),
    {
      server: false,
      watch: [() => session.organizationId, () => props.applicationId],
      default: () => emptyDomains,
    },
  );

  const domainList = computed(() => data.value?.items ?? []);

  const DOMAIN_STATUS: Record<DomainStatus, { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'attn' },
    active: { label: 'Active', color: 'live' },
    error: { label: 'Error', color: 'failed' },
  };

  const actionError = ref('');

  const addingDomain = ref(false);
  const domainBusy = ref('');

  const domainForm = useSchemaForm(
    z.object({
      hostname: z.string().trim().min(1, 'Enter the domain'),
      pathPrefix: z.string().trim(),
      tls: z.boolean(),
    }),
    { hostname: '', pathPrefix: '', tls: true },
  );

  const openAddDomain = () => {
    domainForm.reset();
    addingDomain.value = true;
  };

  const handleCreateDomain = domainForm.submit(async values => {
    await domainsApi.create({
      applicationId: props.applicationId,
      hostname: values.hostname,
      pathPrefix: values.pathPrefix || undefined,
      tls: values.tls,
    });

    addingDomain.value = false;
    await refreshDomains();
  });

  const runDomainAction = async (domain: Domain, action: 'apply' | 'renew') => {
    actionError.value = '';
    domainBusy.value = `${domain.id}:${action}`;

    try {
      await domainsApi[action](domain.id);
      await refreshDomains();
    } catch (error) {
      actionError.value = messageOf(error, 'The operation failed.');
    } finally {
      domainBusy.value = '';
    }
  };

  const domainToRemove = ref<Domain | null>(null);
  const removingDomain = ref(false);

  const removeDomainOpen = computed({
    get: () => Boolean(domainToRemove.value),
    set: value => {
      if (!value) {
        domainToRemove.value = null;
      }
    },
  });

  const confirmRemoveDomain = async () => {
    if (!domainToRemove.value) {
      return;
    }

    actionError.value = '';
    removingDomain.value = true;

    try {
      await domainsApi.remove(domainToRemove.value.id);
      await refreshDomains();
      domainToRemove.value = null;
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to remove.');
    } finally {
      removingDomain.value = false;
    }
  };

  const editingDomain = ref('');
  const editDomainPathPrefix = ref('');
  const editDomainTls = ref(true);
  const editDomainError = ref('');
  const editDomainBusy = ref(false);

  const startEditDomain = (domain: Domain) => {
    editDomainError.value = '';
    editingDomain.value = domain.id;
    editDomainPathPrefix.value = domain.pathPrefix ?? '';
    editDomainTls.value = domain.tls;
  };

  const saveEditDomain = async () => {
    editDomainError.value = '';
    editDomainBusy.value = true;

    try {
      await domainsApi.update(editingDomain.value, {
        pathPrefix: editDomainPathPrefix.value.trim() || null,
        tls: editDomainTls.value,
      });

      editingDomain.value = '';
      await refreshDomains();
    } catch (error) {
      editDomainError.value = messageOf(error, 'Failed to save the domain.');
    } finally {
      editDomainBusy.value = false;
    }
  };

  const domainCertificates = ref<Record<string, DomainCertificate>>({});
  const domainCertificateFailed = ref<Record<string, boolean>>({});
  const domainCertificateOpen = ref('');
  const domainCertificateLoading = ref(false);

  const toggleDomainCertificate = async (domain: Domain) => {
    if (domainCertificateOpen.value === domain.id) {
      domainCertificateOpen.value = '';
      return;
    }

    domainCertificateOpen.value = domain.id;

    if (domainCertificates.value[domain.id] || domainCertificateFailed.value[domain.id]) {
      return;
    }

    domainCertificateLoading.value = true;

    try {
      domainCertificates.value[domain.id] = await domainsApi.certificate(domain.id);
    } catch {
      domainCertificateFailed.value[domain.id] = true;
    } finally {
      domainCertificateLoading.value = false;
    }
  };

  const domainDaysRemaining = (expiresAt?: string) =>
    expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : undefined;
</script>

<template>
  <Card title="Domains" content-class="p-0">
    <template v-if="canManage" #right>
      <Button v-if="!addingDomain" theme="secondary" size="xs" @click="openAddDomain">
        <Icon name="proicons:add" size="16" />
        Add
      </Button>
    </template>

    <Alert v-if="actionError" theme="error" class="m-4.25 mb-0">{{ actionError }}</Alert>

    <form
      v-if="addingDomain"
      class="flex flex-col gap-1.5 p-4.25"
      @submit.prevent="handleCreateDomain"
    >
      <Alert v-if="domainForm.formError.value" theme="error">{{
        domainForm.formError.value
      }}</Alert>

      <Input
        v-model="domainForm.values.hostname"
        label="Domain"
        placeholder="app.example.com"
        :call-error="domainForm.errors.value.hostname"
      />
      <Input
        v-model="domainForm.values.pathPrefix"
        label="Path prefix"
        placeholder="Optional, e.g. /api"
      />

      <div class="flex items-center gap-3 py-3.5">
        <Switch v-model="domainForm.values.tls" label="Automatic HTTPS (Let's Encrypt)" />
      </div>

      <div class="flex justify-end gap-2">
        <Button theme="quiet" type="button" @click="addingDomain = false">Cancel</Button>
        <Button theme="primary" size="sm" type="submit" :disabled="domainForm.loading.value">
          <Icon v-if="domainForm.loading.value" name="svg-spinners:tadpole" size="16" />
          Add
        </Button>
      </div>
    </form>

    <EmptyState
      v-if="!domainList.length"
      variant="prompt"
      description="No domains yet. Add one to publish this application on its own address."
      class="m-2.5"
    />

    <div v-for="domain in domainList" :key="domain.id" class="border-t border-hairline p-4.25">
      <div class="flex flex-wrap items-center gap-3">
        <Icon v-if="domain.tls" name="lucide:lock" class="size-3.5 shrink-0 text-live" />
        <span class="truncate font-mono text-[13.5px] text-ink">
          {{ domain.hostname }}{{ domain.pathPrefix }}
        </span>
        <Tag :color="DOMAIN_STATUS[domain.status].color">{{
          DOMAIN_STATUS[domain.status].label
        }}</Tag>
        <div class="flex-1" />
        <Button
          theme="secondary"
          size="xs"
          :disabled="domainBusy === `${domain.id}:apply`"
          @click="runDomainAction(domain, 'apply')"
        >
          <Icon v-if="domainBusy === `${domain.id}:apply`" name="svg-spinners:tadpole" size="14" />
          Apply
        </Button>
        <Button
          v-if="domain.tls"
          theme="quiet"
          size="xs"
          :disabled="domainBusy === `${domain.id}:renew`"
          @click="runDomainAction(domain, 'renew')"
        >
          Renew
        </Button>
        <Button theme="quiet" size="xs" @click="toggleDomainCertificate(domain)"
          >Certificate</Button
        >
        <Button theme="quiet" size="xs" @click="startEditDomain(domain)">Edit</Button>
        <button
          type="button"
          title="Remove"
          class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
          @click="domainToRemove = domain"
        >
          <Icon name="lucide:trash-2" class="size-3.5" />
        </button>
      </div>

      <p v-if="domain.lastError" class="mt-1.5 truncate text-caption text-failed">
        {{ domain.lastError }}
      </p>

      <form
        v-if="editingDomain === domain.id"
        class="mt-3 flex flex-col gap-3 border-t border-hairline pt-3"
        @submit.prevent="saveEditDomain"
      >
        <Alert v-if="editDomainError" theme="error">{{ editDomainError }}</Alert>

        <div class="flex flex-wrap items-center gap-4">
          <Input
            v-model="editDomainPathPrefix"
            label="Path prefix"
            placeholder="/api"
            class="flex-1"
          />
          <Switch v-model="editDomainTls" label="Automatic HTTPS" />
        </div>

        <div class="flex justify-end gap-2">
          <Button theme="quiet" type="button" @click="editingDomain = ''">Cancel</Button>
          <Button theme="primary" size="sm" type="submit" :disabled="editDomainBusy">
            <Icon v-if="editDomainBusy" name="svg-spinners:tadpole" size="16" />
            Save
          </Button>
        </div>
      </form>

      <div
        v-if="domainCertificateOpen === domain.id"
        class="mt-3 border-t border-hairline pt-3 text-[13px]"
      >
        <p v-if="domainCertificateLoading" class="text-ink-2">Loading…</p>
        <p v-else-if="domainCertificateFailed[domain.id]" class="text-failed">
          Failed to load the certificate.
        </p>
        <template v-else-if="domainCertificates[domain.id]">
          <div class="flex flex-wrap items-center gap-3">
            <Tag :color="domainCertificates[domain.id]!.valid ? 'live' : 'failed'">
              {{ domainCertificates[domain.id]!.valid ? 'Valid' : 'Invalid' }}
            </Tag>
            <span v-if="domainCertificates[domain.id]!.issuer" class="text-ink-2">
              Issued by {{ domainCertificates[domain.id]!.issuer }}
            </span>
          </div>
          <p v-if="domainCertificates[domain.id]!.expiresAt" class="mt-1 text-ink-2">
            Expires
            {{ new Date(domainCertificates[domain.id]!.expiresAt!).toLocaleDateString('en-US') }}
            <span
              v-if="domainDaysRemaining(domainCertificates[domain.id]!.expiresAt) !== undefined"
            >
              ({{ domainDaysRemaining(domainCertificates[domain.id]!.expiresAt) }} days remaining)
            </span>
          </p>
        </template>
      </div>
    </div>

    <Confirm
      v-model:open="removeDomainOpen"
      title="Remove domain"
      :message="`Remove ${domainToRemove?.hostname}? The route stops responding.`"
      confirm-label="Remove"
      danger
      :loading="removingDomain"
      @confirm="confirmRemoveDomain"
    />
  </Card>
</template>
