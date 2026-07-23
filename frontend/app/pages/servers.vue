<script setup lang="ts">
  import { z } from 'zod';
  import type {
    ConnectionProbe,
    ServerStatus,
    SshCredentials,
    Server,
  } from '~/composables/use-servers';

  useHead({ title: 'Servidores' });

  const session = useSessionStore();
  const { current } = useOrganizations();
  const { list, validate, create, provision, remove } = useServers();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const empty = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data, refresh, status } = await useAsyncData(
    'servers',
    () => (session.organizationId ? list() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
  );

  const servers = computed(() => data.value?.items ?? []);

  const STATUS: Record<
    ServerStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    pending: { label: 'Pendente', variant: 'neutral' },
    validating: { label: 'Validando', variant: 'info' },
    provisioning: { label: 'Provisionando', variant: 'info' },
    online: { label: 'Online', variant: 'success' },
    offline: { label: 'Offline', variant: 'warning' },
    failed: { label: 'Falhou', variant: 'danger' },
  };

  const actionError = ref('');

  // --- Adicionar servidor ------------------------------------------------------------------------

  const adding = ref(false);
  const probe = ref<ConnectionProbe | null>(null);

  const schema = z
    .object({
      name: z.string().trim().min(1, 'Informe um nome'),
      host: z.string().trim().min(1, 'Informe o host'),
      port: z.string().regex(/^\d+$/, 'Porta inválida'),
      username: z.string().trim().min(1, 'Informe o usuário'),
      authMethod: z.enum(['password', 'privateKey']),
      password: z.string(),
      privateKey: z.string(),
      passphrase: z.string(),
      agentPort: z.string().regex(/^\d+$/, 'Porta inválida'),
    })
    .superRefine((value, ctx) => {
      if (value.authMethod === 'password' && !value.password) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'Informe a senha' });
      }

      if (value.authMethod === 'privateKey' && !value.privateKey) {
        ctx.addIssue({ code: 'custom', path: ['privateKey'], message: 'Informe a chave privada' });
      }
    });

  const form = useForm(schema, {
    name: '',
    host: '',
    port: '22',
    username: 'root',
    authMethod: 'password' as 'password' | 'privateKey',
    password: '',
    privateKey: '',
    passphrase: '',
    agentPort: '9000',
  });

  const buildSsh = (data: typeof form.values): SshCredentials => ({
    host: data.host,
    port: Number(data.port),
    username: data.username,
    ...(data.authMethod === 'password'
      ? { password: data.password }
      : { privateKey: data.privateKey, passphrase: data.passphrase || undefined }),
  });

  const authOptions = [
    { value: 'password', label: 'Senha' },
    { value: 'privateKey', label: 'Chave privada' },
  ];

  const onTest = form.submit(async values => {
    probe.value = await validate(buildSsh(values));
  });

  const onCreate = form.submit(async values => {
    await create({ name: values.name, ssh: buildSsh(values), agentPort: Number(values.agentPort) });
    await refresh();
    adding.value = false;
    probe.value = null;
    form.reset();
  });

  const openAdd = () => {
    actionError.value = '';
    probe.value = null;
    form.reset();
    adding.value = true;
  };

  // --- Provisionar / remover ---------------------------------------------------------------------

  const provisioning = ref('');

  const runProvision = async (server: Server) => {
    actionError.value = '';
    provisioning.value = server.id;

    try {
      await provision(server.id);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Falha ao provisionar.';
    } finally {
      provisioning.value = '';
    }
  };

  const toRemove = ref<Server | null>(null);
  const removing = ref(false);

  const confirmRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    actionError.value = '';
    removing.value = true;

    try {
      await remove(toRemove.value.id);
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
        <h1>Servidores</h1>
        <p class="mt-1 text-sm text-content-muted">Máquinas onde suas aplicações e bancos rodam.</p>
      </div>

      <UiButton v-if="current && canManage && !adding" @click="openAdd">
        <Icon name="lucide:plus" class="size-4" />
        Adicionar servidor
      </UiButton>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!current" title="Selecione uma organização">
      <p class="text-sm text-content-muted">
        Escolha ou crie uma organização no seletor da barra lateral para gerenciar servidores.
      </p>
    </UiCard>

    <template v-else>
      <UiCard v-if="adding" title="Adicionar servidor" description="Conecte uma máquina via SSH.">
        <form class="flex flex-col gap-4" @submit.prevent="onCreate">
          <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

          <div class="grid gap-4 sm:grid-cols-2">
            <UiInput
              v-model="form.values.name"
              label="Nome"
              placeholder="produção-1"
              :error="form.errors.value.name"
            />
            <UiInput
              v-model="form.values.username"
              label="Usuário SSH"
              placeholder="root"
              :error="form.errors.value.username"
            />
            <UiInput
              v-model="form.values.host"
              label="Host"
              placeholder="203.0.113.10"
              :error="form.errors.value.host"
            />
            <UiInput v-model="form.values.port" label="Porta SSH" :error="form.errors.value.port" />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <UiSelect
              v-model="form.values.authMethod"
              label="Autenticação"
              :options="authOptions"
            />
            <UiInput
              v-model="form.values.agentPort"
              label="Porta do agente"
              :error="form.errors.value.agentPort"
            />
          </div>

          <UiInput
            v-if="form.values.authMethod === 'password'"
            v-model="form.values.password"
            label="Senha"
            type="password"
            :error="form.errors.value.password"
          />

          <template v-else>
            <UiTextarea
              v-model="form.values.privateKey"
              label="Chave privada"
              :rows="5"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              :error="form.errors.value.privateKey"
            />
            <UiInput
              v-model="form.values.passphrase"
              label="Passphrase (opcional)"
              type="password"
            />
          </template>

          <UiAlert v-if="probe && probe.reachable" variant="success">
            Conexão bem-sucedida — {{ probe.osRelease ?? 'host acessível' }},
            {{ probe.cpuCount ?? '?' }} vCPU, {{ probe.memoryMb ?? '?' }} MB de RAM.
          </UiAlert>
          <UiAlert v-else-if="probe" variant="error">
            {{ probe.error ?? 'Não foi possível conectar.' }}
          </UiAlert>

          <div class="flex items-center justify-end gap-2">
            <UiButton variant="ghost" type="button" @click="adding = false">Cancelar</UiButton>
            <UiButton
              variant="secondary"
              type="button"
              :loading="form.submitting.value"
              @click="onTest"
            >
              Testar conexão
            </UiButton>
            <UiButton type="submit" :loading="form.submitting.value">Adicionar</UiButton>
          </div>
        </form>
      </UiCard>

      <UiCard v-if="status === 'pending'" title="Servidores">
        <p class="text-sm text-content-muted">Carregando…</p>
      </UiCard>

      <UiCard v-else-if="!servers.length" title="Nenhum servidor ainda">
        <p class="text-sm text-content-muted">
          Adicione um servidor via SSH para começar a implantar aplicações.
        </p>
      </UiCard>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="server in servers"
          :key="server.id"
          class="flex flex-wrap items-center gap-4 rounded-xl border border-surface-border bg-surface-raised p-4"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="truncate">{{ server.name }}</h3>
              <UiBadge :variant="STATUS[server.status].variant">
                {{ STATUS[server.status].label }}
              </UiBadge>
              <UiBadge v-if="server.online" variant="success">
                <Icon name="lucide:wifi" class="size-3" />
                agente
              </UiBadge>
            </div>
            <p class="mt-1 truncate text-xs text-content-muted">
              {{ server.ssh.username }}@{{ server.ssh.host }}:{{ server.ssh.port }}
              <span v-if="server.resources.osRelease"> · {{ server.resources.osRelease }}</span>
              <span v-if="server.resources.cpuCount">
                · {{ server.resources.cpuCount }} vCPU · {{ server.resources.memoryMb }} MB</span
              >
            </p>
            <p v-if="server.lastError" class="mt-1 truncate text-xs text-danger">
              {{ server.lastError }}
            </p>
          </div>

          <div v-if="canManage" class="flex items-center gap-2">
            <UiButton
              v-if="['pending', 'failed', 'offline'].includes(server.status)"
              variant="secondary"
              :loading="provisioning === server.id"
              @click="runProvision(server)"
            >
              Provisionar
            </UiButton>
            <button
              type="button"
              title="Remover"
              class="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface hover:text-danger"
              @click="toRemove = server"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <UiConfirm
      :open="Boolean(toRemove)"
      title="Remover servidor"
      :message="`Remover “${toRemove?.name}”? As aplicações e bancos precisam ser movidos antes.`"
      confirm-label="Remover"
      danger
      :loading="removing"
      @confirm="confirmRemove"
      @update:open="value => !value && (toRemove = null)"
    />
  </section>
</template>
