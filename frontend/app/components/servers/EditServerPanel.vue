<script setup lang="ts">
  import { z } from 'zod';
  import { useServers, type Server, type SshCredentials } from '~/composables/services/useServers';

  const props = defineProps<{ server: Server }>();
  const emit = defineEmits<{ updated: [] }>();

  const open = defineModel<boolean>('open', { default: false });

  const toast = useToast();
  const { update } = useServers();

  const editSchema = z
    .object({
      name: z.string().trim().min(1, 'Enter a name'),
      changeSsh: z.boolean(),
      host: z.string(),
      port: z.string(),
      username: z.string(),
      authMethod: z.enum(['password', 'privateKey']),
      password: z.string(),
      privateKey: z.string(),
      passphrase: z.string(),
    })
    .superRefine((value, ctx) => {
      if (!value.changeSsh) {
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
    editSchema,
    {
      name: '',
      changeSsh: false,
      host: '',
      port: '22',
      username: 'root',
      authMethod: 'password' as 'password' | 'privateKey',
      password: '',
      privateKey: '',
      passphrase: '',
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const authOptions = [
    { value: 'password', label: 'Password' },
    { value: 'privateKey', label: 'Private key' },
  ];

  const buildSsh = (values: typeof form.values): SshCredentials => ({
    host: values.host,
    port: Number(values.port),
    username: values.username,
    ...(values.authMethod === 'password'
      ? { password: values.password }
      : { privateKey: values.privateKey, passphrase: values.passphrase || undefined }),
  });

  const handleSave = form.submit(async values => {
    await update(props.server.id, {
      name: values.name,
      ...(values.changeSsh ? { ssh: buildSsh(values) } : {}),
    });

    open.value = false;
    emit('updated');
  });

  watch(open, value => {
    if (!value) {
      return;
    }

    form.reset();
    form.values.name = props.server.name;
    form.values.host = props.server.ssh.host ?? '';
    form.values.username = props.server.ssh.username ?? 'root';
    form.values.port = String(props.server.ssh.port ?? 22);
  });
</script>

<template>
  <Card v-if="open" title="Edit server">
    <form class="flex flex-col gap-4" @submit.prevent="handleSave">
      <Input v-model="form.values.name" label="Name" :call-error="form.errors.value.name" />

      <template v-if="server.type === 'ssh'">
        <Switch v-model="form.values.changeSsh" label="Change SSH credentials" />

        <template v-if="form.values.changeSsh">
          <div class="grid gap-4 sm:grid-cols-2">
            <Input
              v-model="form.values.username"
              label="SSH user"
              :call-error="form.errors.value.username"
            />
            <Select
              v-model="form.values.authMethod"
              label="Authentication"
              :options="authOptions"
            />
            <Input v-model="form.values.host" label="Host" :call-error="form.errors.value.host" />
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
        </template>
      </template>

      <div class="flex items-center justify-end gap-2">
        <Button theme="quiet" type="button" @click="open = false">Cancel</Button>
        <Button theme="primary" type="submit" :disabled="form.loading.value">
          <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
          Save
        </Button>
      </div>
    </form>
  </Card>
</template>
