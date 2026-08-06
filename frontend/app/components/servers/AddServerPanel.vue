<script setup lang="ts">
  import { z } from 'zod';
  import { useServers, type ConnectionProbe } from '~/composables/services/useServers';

  const emit = defineEmits<{ created: [] }>();

  const open = defineModel<boolean>('open', { default: false });

  const toast = useToast();
  const { validate, create } = useServers();

  const probe = ref<ConnectionProbe | null>(null);

  const schema = z
    .object({
      name: z.string().trim().min(1, 'Enter a name'),
      host: z.string(),
      port: z.string(),
      username: z.string(),
      authMethod: z.enum(['password', 'privateKey']),
      password: z.string(),
      privateKey: z.string(),
      passphrase: z.string(),
      agentPort: z.string().regex(/^\d+$/, 'Invalid port'),
    })
    .superRefine((value, ctx) => {
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
      name: '',
      host: '',
      port: '22',
      username: 'root',
      authMethod: 'password' as 'password' | 'privateKey',
      password: '',
      privateKey: '',
      passphrase: '',
      agentPort: '9000',
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const buildSsh = (values: typeof form.values) => ({
    host: values.host,
    port: Number(values.port),
    username: values.username,
    ...(values.authMethod === 'password'
      ? { password: values.password }
      : { privateKey: values.privateKey, passphrase: values.passphrase || undefined }),
  });

  const authOptions = [
    { value: 'password', label: 'Password' },
    { value: 'privateKey', label: 'Private key' },
  ];

  const handleTest = form.submit(async values => {
    probe.value = await validate(buildSsh(values));
  });

  const handleCreate = form.submit(async values => {
    await create({
      name: values.name,
      ssh: buildSsh(values),
      agentPort: Number(values.agentPort),
    });

    open.value = false;
    probe.value = null;
    form.reset();
    emit('created');
  });

  watch(open, value => {
    if (value) {
      probe.value = null;
      form.reset();
    }
  });
</script>

<template>
  <Card v-if="open" title="Add server" class="max-w-155">
    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <p class="text-caption text-ink-2">
          Provisioning installs Docker, the proxy and the agent. Nothing else.
        </p>
        <div class="flex shrink-0 items-center gap-2">
          <Button theme="quiet" size="sm" @click="open = false">Cancel</Button>
          <Button theme="secondary" size="sm" :disabled="form.loading.value" @click="handleTest">
            <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
            Test connection
          </Button>
          <Button theme="primary" size="sm" :disabled="form.loading.value" @click="handleCreate">
            <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
            Add
          </Button>
        </div>
      </div>
    </template>

    <div class="grid gap-1.5 sm:grid-cols-2">
      <Input
        v-model="form.values.name"
        label="Name"
        placeholder="hetzner-02"
        :call-error="form.errors.value.name"
      />
      <Input
        v-model="form.values.agentPort"
        label="Agent port"
        :call-error="form.errors.value.agentPort"
      />
      <Input
        v-model="form.values.host"
        label="Host"
        placeholder="5.161.44.91"
        :call-error="form.errors.value.host"
      />
      <Input v-model="form.values.port" label="SSH port" :call-error="form.errors.value.port" />
      <Input
        v-model="form.values.username"
        label="SSH user"
        placeholder="root"
        :call-error="form.errors.value.username"
      />
      <Select v-model="form.values.authMethod" label="Authentication" :options="authOptions" />
    </div>

    <Input
      v-if="form.values.authMethod === 'password'"
      v-model="form.values.password"
      label="Password"
      password
      class="mt-1.5"
      :call-error="form.errors.value.password"
    />
    <template v-else>
      <Input
        v-model="form.values.privateKey"
        label="Private key"
        type="textarea"
        :rows="5"
        class="mt-1.5"
        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
        :call-error="form.errors.value.privateKey"
      />
      <Input v-model="form.values.passphrase" label="Passphrase (optional)" password />
    </template>

    <Alert v-if="probe && probe.reachable" theme="success" class="mt-3">
      Connection succeeded — {{ probe.osRelease ?? 'host reachable' }},
      {{ probe.cpuCount ?? '?' }} vCPU, {{ probe.memoryMb ?? '?' }} MB of RAM.
    </Alert>
    <Alert v-else-if="probe" theme="error" class="mt-3">
      {{ probe.error ?? 'Could not connect.' }}
    </Alert>
  </Card>
</template>
