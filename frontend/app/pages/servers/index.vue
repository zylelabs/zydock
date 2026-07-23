<script setup lang="ts">
  import { z } from 'zod';
  import type {
    ConnectionProbe,
    ServerStatus,
    ServerType,
    SshCredentials,
    Server,
  } from '~/composables/use-servers';

  useHead({ title: 'Servers' });

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
    pending: { label: 'Pending', variant: 'neutral' },
    validating: { label: 'Validating', variant: 'info' },
    provisioning: { label: 'Provisioning', variant: 'info' },
    online: { label: 'Online', variant: 'success' },
    offline: { label: 'Offline', variant: 'warning' },
    failed: { label: 'Failed', variant: 'danger' },
  };

  const actionError = ref('');

  // --- Add server --------------------------------------------------------------------------------

  const adding = ref(false);
  const probe = ref<ConnectionProbe | null>(null);

  const schema = z
    .object({
      type: z.enum(['ssh', 'local']),
      name: z.string().trim().min(1, 'Enter a name'),
      host: z.string(),
      port: z.string(),
      username: z.string(),
      authMethod: z.enum(['password', 'privateKey']),
      password: z.string(),
      privateKey: z.string(),
      passphrase: z.string(),
      agentHost: z.string(),
      agentPort: z.string().regex(/^\d+$/, 'Invalid port'),
    })
    .superRefine((value, ctx) => {
      if (value.type === 'local') {
        if (!value.agentHost.trim()) {
          ctx.addIssue({
            code: 'custom',
            path: ['agentHost'],
            message: 'Enter the agent host',
          });
        }

        return;
      }

      if (!value.host.trim()) {
        ctx.addIssue({ code: 'custom', path: ['host'], message: 'Enter the host' });
      }

      if (!/^\d+$/.test(value.port)) {
        ctx.addIssue({ code: 'custom', path: ['port'], message: 'Invalid port' });
      }

      if (!value.username.trim()) {
        ctx.addIssue({ code: 'custom', path: ['username'], message: 'Enter the user' });
      }

      if (value.authMethod === 'password' && !value.password) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'Enter the password' });
      }

      if (value.authMethod === 'privateKey' && !value.privateKey) {
        ctx.addIssue({ code: 'custom', path: ['privateKey'], message: 'Enter the private key' });
      }
    });

  const form = useForm(schema, {
    type: 'ssh' as ServerType,
    name: '',
    host: '',
    port: '22',
    username: 'root',
    authMethod: 'password' as 'password' | 'privateKey',
    password: '',
    privateKey: '',
    passphrase: '',
    agentHost: 'localhost',
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

  const typeOptions = [
    { value: 'ssh', label: 'Remote server (SSH)' },
    { value: 'local', label: 'Local machine' },
  ];

  const authOptions = [
    { value: 'password', label: 'Password' },
    { value: 'privateKey', label: 'Private key' },
  ];

  const onTest = form.submit(async values => {
    probe.value = await validate(buildSsh(values));
  });

  const onCreate = form.submit(async values => {
    if (values.type === 'local') {
      const result = await create({
        type: 'local',
        name: values.name,
        agentHost: values.agentHost,
        agentPort: Number(values.agentPort),
      });

      created.value = {
        server: result.server,
        token: result.agentToken ?? '',
        port: values.agentPort,
      };
    } else {
      await create({
        name: values.name,
        ssh: buildSsh(values),
        agentPort: Number(values.agentPort),
      });
    }

    await refresh();
    adding.value = false;
    probe.value = null;
    form.reset();
  });

  const openAdd = () => {
    actionError.value = '';
    probe.value = null;
    created.value = null;
    form.reset();
    adding.value = true;
  };

  // --- Local machine connection instructions -----------------------------------------------------

  const created = ref<{ server: Server; token: string; port: string } | null>(null);

  // The plaintext token is shown only here, once — the backend stores it encrypted afterwards.
  const envText = computed(() => {
    if (!created.value) {
      return '';
    }

    const { server, token, port } = created.value;

    return [
      `PORT="${port}"`,
      'MODE="prod"',
      'LOG_LEVEL="info"',
      `SERVER_ID="${server.id}"`,
      `AGENT_TOKEN="${token}"`,
      'BACKEND_URL="http://localhost:8000"',
      'WORKSPACE_PATH="/var/lib/zydock/builds"',
    ].join('\n');
  });

  const copied = ref(false);

  const copyEnv = async () => {
    await navigator.clipboard.writeText(envText.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  };

  // --- Provision / remove ------------------------------------------------------------------------

  const provisioning = ref('');

  const runProvision = async (server: Server) => {
    actionError.value = '';
    provisioning.value = server.id;

    try {
      await provision(server.id);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to provision.';
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
      actionError.value = (error as { message?: string }).message || 'Failed to remove.';
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1>Servers</h1>
        <p class="mt-1 text-sm text-content-muted">
          Machines where your applications and databases run.
        </p>
      </div>

      <UiButton v-if="current && canManage && !adding" @click="openAdd">
        <Icon name="lucide:plus" class="size-4" />
        Add server
      </UiButton>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">
        Choose or create an organization in the sidebar selector to manage servers.
      </p>
    </UiCard>

    <template v-else>
      <UiCard
        v-if="created"
        title="Connect the agent to your machine"
        description="Save the token now — it will not be shown again."
      >
        <div class="flex flex-col gap-4">
          <p class="text-sm text-content-muted">
            Create a <code>node/agent.env</code> file with the content below and start the agent.
            Set <code>BACKEND_URL</code> to the address of this backend reachable from the machine
            where the agent runs.
          </p>

          <div class="relative">
            <pre
              class="overflow-x-auto rounded-xl border border-surface-border bg-surface p-4 text-xs leading-relaxed"
            ><code>{{ envText }}</code></pre>
            <UiButton
              variant="secondary"
              class="absolute right-2 top-2"
              type="button"
              @click="copyEnv"
            >
              <Icon :name="copied ? 'lucide:check' : 'lucide:copy'" class="size-4" />
              {{ copied ? 'Copied' : 'Copy' }}
            </UiButton>
          </div>

          <div>
            <p class="text-sm font-medium">Then, at the repository root:</p>
            <pre
              class="mt-2 overflow-x-auto rounded-xl border border-surface-border bg-surface p-4 text-xs leading-relaxed"
            ><code>cd node
bun install
bun --env-file=agent.env run start</code></pre>
          </div>

          <UiAlert variant="info">
            Requires Docker installed on this machine. If the backend runs via Docker Compose, use
            <code>host.docker.internal</code> as the agent host so the backend can reach it.
          </UiAlert>

          <div class="flex justify-end">
            <UiButton variant="ghost" type="button" @click="created = null">Got it</UiButton>
          </div>
        </div>
      </UiCard>

      <UiCard v-if="adding" title="Add server" description="Connect a machine to Zydock.">
        <form class="flex flex-col gap-4" @submit.prevent="onCreate">
          <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

          <UiSelect v-model="form.values.type" label="Type" :options="typeOptions" />

          <div class="grid gap-4 sm:grid-cols-2">
            <UiInput
              v-model="form.values.name"
              label="Name"
              placeholder="production-1"
              :error="form.errors.value.name"
            />
            <UiInput
              v-model="form.values.agentPort"
              label="Agent port"
              :error="form.errors.value.agentPort"
            />
          </div>

          <!-- Local machine: no SSH, the agent is started by hand. -->
          <template v-if="form.values.type === 'local'">
            <UiInput
              v-model="form.values.agentHost"
              label="Agent host"
              placeholder="localhost or host.docker.internal"
              :error="form.errors.value.agentHost"
            />
            <UiAlert variant="info">
              The backend installs nothing here: it generates the token and shows the command for
              you to run the agent on this machine (Docker must be installed).
            </UiAlert>
          </template>

          <!-- Remote server: connection and provisioning via SSH. -->
          <template v-else>
            <div class="grid gap-4 sm:grid-cols-2">
              <UiInput
                v-model="form.values.username"
                label="SSH user"
                placeholder="root"
                :error="form.errors.value.username"
              />
              <UiSelect
                v-model="form.values.authMethod"
                label="Authentication"
                :options="authOptions"
              />
              <UiInput
                v-model="form.values.host"
                label="Host"
                placeholder="203.0.113.10"
                :error="form.errors.value.host"
              />
              <UiInput
                v-model="form.values.port"
                label="SSH port"
                :error="form.errors.value.port"
              />
            </div>

            <UiInput
              v-if="form.values.authMethod === 'password'"
              v-model="form.values.password"
              label="Password"
              type="password"
              :error="form.errors.value.password"
            />

            <template v-else>
              <UiTextarea
                v-model="form.values.privateKey"
                label="Private key"
                :rows="5"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                :error="form.errors.value.privateKey"
              />
              <UiInput
                v-model="form.values.passphrase"
                label="Passphrase (optional)"
                type="password"
              />
            </template>

            <UiAlert v-if="probe && probe.reachable" variant="success">
              Connection succeeded — {{ probe.osRelease ?? 'host reachable' }},
              {{ probe.cpuCount ?? '?' }} vCPU, {{ probe.memoryMb ?? '?' }} MB of RAM.
            </UiAlert>
            <UiAlert v-else-if="probe" variant="error">
              {{ probe.error ?? 'Could not connect.' }}
            </UiAlert>
          </template>

          <div class="flex items-center justify-end gap-2">
            <UiButton variant="ghost" type="button" @click="adding = false">Cancel</UiButton>
            <UiButton
              v-if="form.values.type === 'ssh'"
              variant="secondary"
              type="button"
              :loading="form.submitting.value"
              @click="onTest"
            >
              Test connection
            </UiButton>
            <UiButton type="submit" :loading="form.submitting.value">Add</UiButton>
          </div>
        </form>
      </UiCard>

      <UiCard v-if="status === 'pending'" title="Servers">
        <p class="text-sm text-content-muted">Loading…</p>
      </UiCard>

      <UiCard v-else-if="!servers.length" title="No servers yet">
        <p class="text-sm text-content-muted">
          Add a server via SSH or register your local machine to start deploying applications.
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
              <UiBadge v-if="server.type === 'local'" variant="neutral">local</UiBadge>
              <UiBadge v-if="server.online" variant="success">
                <Icon name="lucide:wifi" class="size-3" />
                agent
              </UiBadge>
            </div>
            <p v-if="server.type === 'local'" class="mt-1 truncate text-xs text-content-muted">
              Local machine · agent at {{ server.agent.host }}:{{ server.agent.port }}
            </p>
            <p v-else class="mt-1 truncate text-xs text-content-muted">
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

          <div class="flex items-center gap-2">
            <NuxtLink
              :to="`/servers/${server.id}`"
              class="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-sm text-content-muted transition-colors hover:text-content"
            >
              <Icon name="lucide:layout-grid" class="size-4" />
              Resources
            </NuxtLink>
            <UiButton
              v-if="
                canManage &&
                server.type === 'ssh' &&
                ['pending', 'failed', 'offline'].includes(server.status)
              "
              variant="secondary"
              :loading="provisioning === server.id"
              @click="runProvision(server)"
            >
              Provision
            </UiButton>
            <button
              v-if="canManage"
              type="button"
              title="Remove"
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
      title="Remove server"
      :message="`Remove “${toRemove?.name}”? Applications and databases must be moved first.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="confirmRemove"
      @update:open="value => !value && (toRemove = null)"
    />
  </section>
</template>
