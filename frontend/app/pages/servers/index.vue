<script setup lang="ts">
  import { z } from 'zod';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import {
    useServers,
    type ConnectionProbe,
    type Server,
    type ServerStatus,
    type ServerType,
    type SshCredentials,
  } from '~/composables/services/useServers';

  useHead({ title: 'Servers' });

  const toast = useToast();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const { list, validate, create, provision, remove } = useServers();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({
      title: 'Error',
      message: (error as { message?: string }).message || fallback,
    });
  };

  const empty = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data, refresh, status } = await useAsyncData(
    'servers',
    () => (session.organizationId ? list() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
  );

  const servers = computed(() => data.value?.items ?? []);

  const SERVER_STATUS: Record<ServerStatus, { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'default' },
    validating: { label: 'Validating', color: 'blue' },
    provisioning: { label: 'Provisioning', color: 'blue' },
    online: { label: 'Online', color: 'green' },
    offline: { label: 'Offline', color: 'yellow' },
    failed: { label: 'Failed', color: 'red' },
  };

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
          ctx.addIssue({ code: 'custom', path: ['agentHost'], message: 'Enter the agent host' });
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

  const form = useSchemaForm(
    schema,
    {
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
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const buildSsh = (values: typeof form.values): SshCredentials => ({
    host: values.host,
    port: Number(values.port),
    username: values.username,
    ...(values.authMethod === 'password'
      ? { password: values.password }
      : { privateKey: values.privateKey, passphrase: values.passphrase || undefined }),
  });

  const typeOptions = [
    { value: 'ssh', label: 'Remote server (SSH)' },
    { value: 'local', label: 'Local machine' },
  ];

  const authOptions = [
    { value: 'password', label: 'Password' },
    { value: 'privateKey', label: 'Private key' },
  ];

  const created = ref<{ server: Server; token: string; port: string } | null>(null);

  const handleTest = form.submit(async values => {
    probe.value = await validate(buildSsh(values));
  });

  const handleCreate = form.submit(async values => {
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
    probe.value = null;
    created.value = null;
    form.reset();
    adding.value = true;
  };

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

  const handleCopyEnv = async () => {
    await navigator.clipboard.writeText(envText.value);

    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  };

  const provisioning = ref('');

  const handleProvision = async (server: Server) => {
    provisioning.value = server.id;

    try {
      await provision(server.id);
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to provision the server.');
    } finally {
      provisioning.value = '';
    }
  };

  const toRemove = ref<Server | null>(null);
  const confirmRemoveOpen = ref(false);
  const removing = ref(false);

  const openRemove = (server: Server) => {
    toRemove.value = server;
    confirmRemoveOpen.value = true;
  };

  const handleRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;

    try {
      await remove(toRemove.value.id);
      await refresh();
      confirmRemoveOpen.value = false;
      toRemove.value = null;
    } catch (error) {
      notifyError(error, 'Failed to remove the server.');
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <Content>
    <Header title="Servers" description="Machines where your applications and databases run.">
      <template #right>
        <Button
          v-if="current && canManage && !adding"
          theme="primary"
          class="my-auto"
          @click="openAdd"
        >
          <Icon name="proicons:add" size="18" />
          Add server
        </Button>
      </template>
    </Header>

    <Card v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">
        Choose or create an organization in the sidebar selector to manage servers.
      </p>
    </Card>

    <div v-else class="flex flex-col gap-6">
      <Card
        v-if="created"
        title="Connect the agent to your machine"
        description="Save the token now — it will not be shown again."
      >
        <div class="flex flex-col gap-4">
          <p class="text-sm text-content-muted">
            Create an <code>agent/agent.env</code> file with the content below and start the agent.
            Set <code>BACKEND_URL</code> to the address of this backend reachable from the machine
            where the agent runs.
          </p>

          <div class="relative">
            <pre
              class="overflow-x-auto rounded-xl border border-surface-border bg-surface-sunken p-4 text-xs leading-relaxed"
            ><code>{{ envText }}</code></pre>
            <Button
              theme="secondary"
              class="absolute top-2 right-2"
              type="button"
              @click="handleCopyEnv"
            >
              <Icon :name="copied ? 'lucide:check' : 'lucide:copy'" class="size-4" />
              {{ copied ? 'Copied' : 'Copy' }}
            </Button>
          </div>

          <div>
            <p class="text-sm font-medium text-content-strong">Then, at the repository root:</p>
            <pre
              class="mt-2 overflow-x-auto rounded-xl border border-surface-border bg-surface-sunken p-4 text-xs leading-relaxed"
            ><code>cd agent
bun install
bun --env-file=agent.env run start</code></pre>
          </div>

          <Alert theme="info">
            Requires Docker installed on this machine. If the backend runs via Docker Compose, use
            <code>host.docker.internal</code> as the agent host so the backend can reach it.
          </Alert>

          <div class="flex justify-end">
            <Button theme="ghost" type="button" @click="created = null">Got it</Button>
          </div>
        </div>
      </Card>

      <Card v-if="adding" title="Add server" description="Connect a machine to Zydock.">
        <form class="flex flex-col gap-4" @submit.prevent="handleCreate">
          <Select v-model="form.values.type" label="Type" :options="typeOptions" />

          <div class="grid gap-4 sm:grid-cols-2">
            <Input
              v-model="form.values.name"
              label="Name"
              placeholder="production-1"
              :call-error="form.errors.value.name"
            />
            <Input
              v-model="form.values.agentPort"
              label="Agent port"
              :call-error="form.errors.value.agentPort"
            />
          </div>

          <template v-if="form.values.type === 'local'">
            <Input
              v-model="form.values.agentHost"
              label="Agent host"
              placeholder="localhost or host.docker.internal"
              :call-error="form.errors.value.agentHost"
            />
            <Alert theme="info">
              The backend installs nothing here: it generates the token and shows the command for
              you to run the agent on this machine (Docker must be installed).
            </Alert>
          </template>

          <template v-else>
            <div class="grid gap-4 sm:grid-cols-2">
              <Input
                v-model="form.values.username"
                label="SSH user"
                placeholder="root"
                :call-error="form.errors.value.username"
              />
              <Select
                v-model="form.values.authMethod"
                label="Authentication"
                :options="authOptions"
              />
              <Input
                v-model="form.values.host"
                label="Host"
                placeholder="203.0.113.10"
                :call-error="form.errors.value.host"
              />
              <Input
                v-model="form.values.port"
                label="SSH port"
                :call-error="form.errors.value.port"
              />
            </div>

            <Input
              v-if="form.values.authMethod === 'password'"
              v-model="form.values.password"
              label="Password"
              password
              :call-error="form.errors.value.password"
            />

            <template v-else>
              <Input
                v-model="form.values.privateKey"
                label="Private key"
                type="textarea"
                :rows="5"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                :call-error="form.errors.value.privateKey"
              />
              <Input v-model="form.values.passphrase" label="Passphrase (optional)" password />
            </template>

            <Alert v-if="probe && probe.reachable" theme="success">
              Connection succeeded — {{ probe.osRelease ?? 'host reachable' }},
              {{ probe.cpuCount ?? '?' }} vCPU, {{ probe.memoryMb ?? '?' }} MB of RAM.
            </Alert>
            <Alert v-else-if="probe" theme="error">
              {{ probe.error ?? 'Could not connect.' }}
            </Alert>
          </template>

          <div class="flex items-center justify-end gap-2">
            <Button theme="ghost" type="button" @click="adding = false">Cancel</Button>
            <Button
              v-if="form.values.type === 'ssh'"
              theme="secondary"
              type="button"
              :disabled="form.loading.value"
              @click="handleTest"
            >
              <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
              Test connection
            </Button>
            <Button theme="primary" type="submit" :disabled="form.loading.value">
              <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
              Add
            </Button>
          </div>
        </form>
      </Card>

      <Card v-if="status === 'pending'" title="Servers">
        <p class="text-sm text-content-muted">Loading…</p>
      </Card>

      <div
        v-else-if="!servers.length"
        class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-field-border bg-surface-sunken px-6 py-12 text-center"
      >
        <Icon name="lucide:server" class="size-8 text-content-dim" />
        <div>
          <h3 class="text-content-strong">No servers yet</h3>
          <p class="mt-1 text-sm text-content-muted">
            Add a server via SSH or register your local machine to start deploying applications.
          </p>
        </div>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="server in servers"
          :key="server.id"
          class="flex flex-wrap items-center gap-4 rounded-xl border border-surface-border bg-surface-raised p-4 shadow-soft backdrop-blur-sm"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="truncate text-content-strong">{{ server.name }}</h3>
              <Tag :color="SERVER_STATUS[server.status].color">
                {{ SERVER_STATUS[server.status].label }}
              </Tag>
              <Tag v-if="server.type === 'local'">local</Tag>
              <Tag v-if="server.online" color="green">agent</Tag>
            </div>

            <p v-if="server.type === 'local'" class="mt-1 truncate text-xs text-content-muted">
              Local machine · agent at {{ server.agent.host }}:{{ server.agent.port }}
            </p>
            <p v-else class="mt-1 truncate text-xs text-content-muted">
              {{ server.ssh.username }}@{{ server.ssh.host }}:{{ server.ssh.port }}
              <span v-if="server.resources.osRelease"> · {{ server.resources.osRelease }}</span>
              <span v-if="server.resources.cpuCount">
                · {{ server.resources.cpuCount }} vCPU · {{ server.resources.memoryMb }} MB
              </span>
            </p>
            <p v-if="server.lastError" class="mt-1 truncate text-xs text-danger">
              {{ server.lastError }}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <Button theme="secondary" :to="`/servers/${server.id}`">
              <Icon name="lucide:layout-grid" class="size-4" />
              Resources
            </Button>
            <Button
              v-if="
                canManage &&
                server.type === 'ssh' &&
                ['pending', 'failed', 'offline'].includes(server.status)
              "
              theme="secondary"
              :disabled="provisioning === server.id"
              @click="handleProvision(server)"
            >
              <Icon v-if="provisioning === server.id" name="svg-spinners:tadpole" size="16" />
              Provision
            </Button>
            <button
              v-if="canManage"
              type="button"
              title="Remove server"
              class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
              @click="openRemove(server)"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <Confirm
      v-model:open="confirmRemoveOpen"
      title="Remove server"
      :message="`Remove “${toRemove?.name}”? Applications and databases must be moved first.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="handleRemove"
    />
  </Content>
</template>
