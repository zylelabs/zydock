<script setup lang="ts">
  import { z } from 'zod';
  import type { Domain, DomainStatus } from '~/composables/use-domains';

  useHead({ title: 'Domínios' });

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
    pending: { label: 'Pendente', variant: 'warning' },
    active: { label: 'Ativo', variant: 'success' },
    error: { label: 'Erro', variant: 'danger' },
  };

  const adding = ref(false);
  const form = useForm(
    z.object({
      applicationId: z.string().min(1, 'Escolha uma aplicação'),
      hostname: z.string().trim().min(1, 'Informe o domínio'),
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
      actionError.value = (error as { message?: string }).message || 'Falha na operação.';
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
      actionError.value = (error as { message?: string }).message || 'Falha ao remover.';
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1>Domínios</h1>
        <p class="mt-1 text-sm text-content-muted">Nomes e HTTPS das suas aplicações.</p>
      </div>
      <UiButton
        v-if="current && canManage && !adding"
        :disabled="!appOptions.length"
        @click="openAdd"
      >
        <Icon name="lucide:plus" class="size-4" />
        Adicionar domínio
      </UiButton>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!current" title="Selecione uma organização">
      <p class="text-sm text-content-muted">Escolha ou crie uma organização na barra lateral.</p>
    </UiCard>

    <template v-else>
      <UiCard v-if="adding" title="Adicionar domínio">
        <form class="flex flex-col gap-4" @submit.prevent="onCreate">
          <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>
          <UiSelect
            v-model="form.values.applicationId"
            label="Aplicação"
            :options="appOptions"
            :error="form.errors.value.applicationId"
          />
          <div class="grid gap-4 sm:grid-cols-2">
            <UiInput
              v-model="form.values.hostname"
              label="Domínio"
              placeholder="app.exemplo.com"
              :error="form.errors.value.hostname"
            />
            <UiInput
              v-model="form.values.pathPrefix"
              label="Prefixo de caminho (opcional)"
              placeholder="/api"
            />
          </div>
          <UiCheckbox v-model="form.values.tls" label="HTTPS automático (Let's Encrypt)" />
          <div class="flex justify-end gap-2">
            <UiButton variant="ghost" type="button" @click="adding = false">Cancelar</UiButton>
            <UiButton type="submit" :loading="form.submitting.value">Adicionar</UiButton>
          </div>
        </form>
      </UiCard>

      <UiCard v-if="!domainList.length" title="Nenhum domínio ainda">
        <p class="text-sm text-content-muted">
          Adicione um domínio a uma aplicação para publicá-la.
        </p>
      </UiCard>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="domain in domainList"
          :key="domain.id"
          class="flex flex-wrap items-center gap-4 rounded-xl border border-surface-border bg-surface-raised p-4"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <Icon v-if="domain.tls" name="lucide:lock" class="size-4 text-success" />
              <span class="truncate font-medium">{{ domain.hostname }}{{ domain.pathPrefix }}</span>
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

          <div v-if="canManage" class="flex items-center gap-2">
            <UiButton
              variant="secondary"
              :loading="busy === `${domain.id}:apply`"
              @click="runAction(domain, 'apply')"
            >
              Aplicar
            </UiButton>
            <UiButton
              v-if="domain.tls"
              variant="ghost"
              :loading="busy === `${domain.id}:renew`"
              @click="runAction(domain, 'renew')"
            >
              Renovar
            </UiButton>
            <button
              type="button"
              title="Remover"
              class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
              @click="toRemove = domain"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <UiConfirm
      :open="Boolean(toRemove)"
      title="Remover domínio"
      :message="`Remover ${toRemove?.hostname}? A rota deixa de responder.`"
      confirm-label="Remover"
      danger
      :loading="removing"
      @confirm="confirmRemove"
      @update:open="value => !value && (toRemove = null)"
    />
  </section>
</template>
