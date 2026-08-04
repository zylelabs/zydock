<script setup lang="ts">
  import { z } from 'zod';
  import { useApiKeys } from '~/composables/services/useApiKeys';
  import { useSessions } from '~/composables/services/useSessions';
  import { useUsers } from '~/composables/services/useUsers';

  useHead({ title: 'Account' });

  const toast = useToast();
  const session = useSessionStore();

  const usersApi = useUsers();
  const apiKeysApi = useApiKeys();
  const sessionsApi = useSessions();

  const { data: profileData, refresh: refreshProfile } = await useAsyncData(
    'account-profile',
    () => usersApi.me(),
    { server: false },
  );

  const user = computed(() => profileData.value?.user ?? null);

  const profileForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      avatar: z.string().trim().max(2048),
    }),
    { name: '', avatar: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  watch(
    user,
    value => {
      if (value) {
        profileForm.values.name = value.name;
        profileForm.values.avatar = value.avatar ?? '';
      }
    },
    { immediate: true },
  );

  const onSaveProfile = profileForm.submit(async values => {
    const { user: updated } = await usersApi.updateMe({
      name: values.name,
      avatar: values.avatar || undefined,
    });

    session.updateUser({ name: updated.name, avatar: updated.avatar });
    toast.success({ title: 'Success', message: 'Profile saved.' });
    await refreshProfile();
  });

  const passwordForm = useSchemaForm(
    z
      .object({
        currentPassword: z.string().min(1, 'Enter your current password'),
        newPassword: z.string().min(8, 'At least 8 characters'),
        confirmPassword: z.string(),
      })
      .superRefine((value, ctx) => {
        if (value.newPassword !== value.confirmPassword) {
          ctx.addIssue({
            code: 'custom',
            path: ['confirmPassword'],
            message: 'Passwords do not match',
          });
        }
      }),
    { currentPassword: '', newPassword: '', confirmPassword: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const onChangePassword = passwordForm.submit(async values => {
    await usersApi.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });

    toast.success({
      title: 'Success',
      message: 'Password changed. Other sessions were signed out.',
    });
    passwordForm.reset();
    await refreshSessions();
  });

  const { data: keysData, refresh: refreshKeys } = await useAsyncData(
    'account-api-keys',
    () => apiKeysApi.list(),
    { server: false, default: () => ({ items: [], total: 0, page: 1, size: 0, pages: 0 }) },
  );

  const apiKeys = computed(() => keysData.value?.items ?? []);

  const creatingKey = ref(false);
  const keyForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      expiresInDays: z.string().regex(/^\d*$/, 'Invalid number of days'),
    }),
    { name: '', expiresInDays: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const createdToken = ref('');

  const onCreateKey = keyForm.submit(async values => {
    const result = await apiKeysApi.create({
      name: values.name,
      expiresInDays: values.expiresInDays ? Number(values.expiresInDays) : undefined,
    });

    createdToken.value = result.token;
    creatingKey.value = false;
    keyForm.reset();
    await refreshKeys();
  });

  const revokingKey = ref('');

  const revokeKey = async (id: string) => {
    revokingKey.value = id;

    try {
      await apiKeysApi.revoke(id);
      await refreshKeys();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to revoke the key.',
      });
    } finally {
      revokingKey.value = '';
    }
  };

  const { data: sessionsData, refresh: refreshSessions } = await useAsyncData(
    'account-sessions',
    () => sessionsApi.list(),
    { server: false, default: () => ({ items: [], total: 0, page: 1, size: 0, pages: 0 }) },
  );

  const sessions = computed(() => sessionsData.value?.items ?? []);

  const revokingSession = ref('');

  const revokeSession = async (id: string) => {
    revokingSession.value = id;

    try {
      await sessionsApi.revoke(id);
      await refreshSessions();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to revoke the session.',
      });
    } finally {
      revokingSession.value = '';
    }
  };

  const revokingAll = ref(false);

  const revokeAllSessions = async () => {
    revokingAll.value = true;

    try {
      await sessionsApi.revokeAll();
      await refreshSessions();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to revoke sessions.',
      });
    } finally {
      revokingAll.value = false;
    }
  };

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');
</script>

<template>
  <Content>
    <Header title="Account" description="Your profile, password, API keys and sessions." />

    <div class="mx-auto flex max-w-2xl flex-col gap-6">
      <Card title="Profile">
        <form class="flex flex-col gap-4" @submit.prevent="onSaveProfile">
          <div>
            <p class="text-sm font-medium text-content-strong">Email</p>
            <p class="mt-1.5 text-sm text-content-muted">{{ user?.email }}</p>
          </div>
          <Input
            v-model="profileForm.values.name"
            label="Name"
            :call-error="profileForm.errors.value.name"
          />
          <Input
            v-model="profileForm.values.avatar"
            label="Avatar URL (optional)"
            placeholder="https://…/avatar.png"
          />

          <Tag v-if="user?.superuser" color="blue" class="w-fit">Superuser</Tag>

          <div class="flex justify-end">
            <Button theme="primary" type="submit" :disabled="profileForm.loading.value">
              <Icon v-if="profileForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Password">
        <form class="flex flex-col gap-4" @submit.prevent="onChangePassword">
          <Input
            v-model="passwordForm.values.currentPassword"
            label="Current password"
            password
            :call-error="passwordForm.errors.value.currentPassword"
          />
          <Input
            v-model="passwordForm.values.newPassword"
            label="New password"
            password
            :call-error="passwordForm.errors.value.newPassword"
          />
          <Input
            v-model="passwordForm.values.confirmPassword"
            label="Confirm new password"
            password
            :call-error="passwordForm.errors.value.confirmPassword"
          />

          <div class="flex justify-end">
            <Button theme="primary" type="submit" :disabled="passwordForm.loading.value">
              <Icon v-if="passwordForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card title="API keys" description="Tokens for scripts and integrations to call the API.">
        <template #right>
          <Button v-if="!creatingKey" theme="secondary" @click="creatingKey = true">
            <Icon name="lucide:plus" size="16" />
            New key
          </Button>
        </template>

        <Alert v-if="createdToken" theme="success" class="mb-4">
          <p>Copy this token now — it will not be shown again.</p>
          <pre class="mt-2 overflow-x-auto rounded-lg bg-surface p-2 text-xs">{{
            createdToken
          }}</pre>
        </Alert>

        <form v-if="creatingKey" class="mb-4 flex flex-col gap-4" @submit.prevent="onCreateKey">
          <div class="grid gap-4 sm:grid-cols-2">
            <Input
              v-model="keyForm.values.name"
              label="Name"
              placeholder="ci-deploy"
              :call-error="keyForm.errors.value.name"
            />
            <Input
              v-model="keyForm.values.expiresInDays"
              label="Expires in days (optional)"
              placeholder="90"
              :call-error="keyForm.errors.value.expiresInDays"
            />
          </div>

          <div class="flex justify-end gap-2">
            <Button theme="ghost" type="button" @click="creatingKey = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="keyForm.loading.value">
              <Icon v-if="keyForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Create
            </Button>
          </div>
        </form>

        <p v-if="!apiKeys.length" class="text-sm text-content-muted">No API keys yet.</p>

        <ul v-else class="flex flex-col divide-y divide-surface-line">
          <li v-for="key in apiKeys" :key="key.id" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-content-strong">{{ key.name }}</p>
              <p class="truncate text-xs text-content-muted">
                {{ key.prefix }}••• · last used {{ formatWhen(key.lastUsedAt) }}
                <span v-if="key.expiresAt"> · expires {{ formatWhen(key.expiresAt) }}</span>
              </p>
            </div>
            <button
              type="button"
              title="Revoke"
              :disabled="revokingKey === key.id"
              class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger disabled:opacity-60"
              @click="revokeKey(key.id)"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </li>
        </ul>
      </Card>

      <Card title="Active sessions">
        <template #right>
          <Button
            v-if="sessions.length > 1"
            theme="ghost"
            :disabled="revokingAll"
            @click="revokeAllSessions"
          >
            <Icon v-if="revokingAll" name="svg-spinners:tadpole" size="16" />
            Sign out other sessions
          </Button>
        </template>

        <ul class="flex flex-col divide-y divide-surface-line">
          <li v-for="item in sessions" :key="item.id" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-content-strong">
                {{ item.userAgent || 'Unknown device' }}
                <span v-if="item.current" class="text-xs text-content-muted">(this device)</span>
              </p>
              <p class="truncate text-xs text-content-muted">
                {{ item.ip || 'unknown IP' }} · last used {{ formatWhen(item.lastUsedAt) }}
              </p>
            </div>
            <button
              type="button"
              title="Revoke"
              :disabled="revokingSession === item.id"
              class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger disabled:opacity-60"
              @click="revokeSession(item.id)"
            >
              <Icon name="lucide:log-out" class="size-4" />
            </button>
          </li>
        </ul>
      </Card>

      <NuxtLink
        v-if="user?.superuser"
        to="/admin/users"
        class="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised p-4 text-sm transition-colors hover:text-primary"
      >
        <span>Manage all users (superuser)</span>
        <Icon name="lucide:chevron-right" class="size-4" />
      </NuxtLink>
    </div>
  </Content>
</template>
