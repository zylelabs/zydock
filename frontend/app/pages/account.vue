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

  const {
    data: profileData,
    status: profileStatus,
    refresh: refreshProfile,
  } = useLazyAsyncData('account-profile', () => usersApi.me(), {
    server: false,
    default: () => null,
  });

  const profileLoadedOnce = ref(false);

  watch(
    profileStatus,
    value => {
      if (value !== 'pending') {
        profileLoadedOnce.value = true;
      }
    },
    { immediate: true },
  );

  const user = computed(() => profileData.value?.user ?? null);

  const editingProfile = ref(false);

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

  const startEditProfile = () => {
    profileForm.values.name = user.value?.name ?? '';
    profileForm.values.avatar = user.value?.avatar ?? '';
    editingProfile.value = true;
  };

  const onSaveProfile = profileForm.submit(async values => {
    const { user: updated } = await usersApi.updateMe({
      name: values.name,
      avatar: values.avatar || undefined,
    });

    session.updateUser({ name: updated.name, avatar: updated.avatar });
    editingProfile.value = false;
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

  const {
    data: keysData,
    status: keysStatus,
    refresh: refreshKeys,
  } = useLazyAsyncData('account-api-keys', () => apiKeysApi.list(), {
    server: false,
    default: () => ({ items: [], total: 0, page: 1, size: 0, pages: 0 }),
  });

  const keysLoadedOnce = ref(false);

  watch(
    keysStatus,
    value => {
      if (value !== 'pending') {
        keysLoadedOnce.value = true;
      }
    },
    { immediate: true },
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

  const {
    data: sessionsData,
    status: sessionsStatus,
    refresh: refreshSessions,
  } = useLazyAsyncData('account-sessions', () => sessionsApi.list(), {
    server: false,
    default: () => ({ items: [], total: 0, page: 1, size: 0, pages: 0 }),
  });

  const sessionsLoadedOnce = ref(false);

  watch(
    sessionsStatus,
    value => {
      if (value !== 'pending') {
        sessionsLoadedOnce.value = true;
      }
    },
    { immediate: true },
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

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({ title: 'Account' });
  });
</script>

<template>
  <Content>
    <div class="mx-auto flex max-w-205 flex-col gap-4.5">
      <Card title="Profile" rows>
        <template #right>
          <Button v-if="!editingProfile" theme="secondary" size="xs" @click="startEditProfile">
            Edit
          </Button>
        </template>

        <template v-if="profileStatus === 'pending' && !profileLoadedOnce">
          <SkeletonRow v-for="index in 2" :key="index" />
        </template>

        <template v-else-if="!editingProfile">
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Email</div>
            <div class="truncate text-[13px] text-ink">{{ user?.email }}</div>
          </Row>
          <Row as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Name</div>
            <div class="truncate text-[13px] text-ink">{{ user?.name }}</div>
          </Row>
          <Row v-if="user?.superuser" as="div" class="flex items-center">
            <div class="w-33 shrink-0 text-[13px] text-ink-2">Role</div>
            <Tag color="live">Superuser</Tag>
          </Row>
        </template>

        <form v-else class="flex flex-col" @submit.prevent="onSaveProfile">
          <Input :model-value="user?.email" label="Email" boxed disabled />
          <Input
            v-model="profileForm.values.name"
            label="Name"
            boxed
            :call-error="profileForm.errors.value.name"
          />
          <Input
            v-model="profileForm.values.avatar"
            label="Avatar URL"
            placeholder="https://…/avatar.png"
            mono
            boxed
          />

          <div class="flex justify-end gap-2 px-4.25 py-3.25">
            <Button theme="quiet" size="sm" type="button" @click="editingProfile = false">
              Cancel
            </Button>
            <Button theme="primary" size="sm" type="submit" :disabled="profileForm.loading.value">
              <Icon v-if="profileForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Password" rows>
        <form class="flex flex-col" @submit.prevent="onChangePassword">
          <Input
            v-model="passwordForm.values.currentPassword"
            label="Current"
            password
            boxed
            :call-error="passwordForm.errors.value.currentPassword"
          />
          <Input
            v-model="passwordForm.values.newPassword"
            label="New"
            password
            boxed
            :call-error="passwordForm.errors.value.newPassword"
          />
          <Input
            v-model="passwordForm.values.confirmPassword"
            label="Confirm"
            password
            boxed
            :call-error="passwordForm.errors.value.confirmPassword"
          />

          <div class="flex justify-end px-4.25 py-3.25">
            <Button theme="primary" size="sm" type="submit" :disabled="passwordForm.loading.value">
              <Icon v-if="passwordForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card title="API keys" rows>
        <template #right>
          <Button v-if="!creatingKey" theme="secondary" size="xs" @click="creatingKey = true">
            New key
          </Button>
        </template>

        <Alert v-if="createdToken" theme="success" class="m-4.25">
          Copy this token now — it will not be shown again.
          <pre class="mt-2 overflow-x-auto rounded-control bg-inset p-2 text-xs">{{
            createdToken
          }}</pre>
        </Alert>

        <form
          v-if="creatingKey"
          class="flex flex-col border-t border-hairline"
          @submit.prevent="onCreateKey"
        >
          <Input
            v-model="keyForm.values.name"
            label="Name"
            placeholder="ci-deploy"
            mono
            boxed
            :call-error="keyForm.errors.value.name"
          />
          <Input
            v-model="keyForm.values.expiresInDays"
            label="Expires in days"
            placeholder="90"
            mono
            boxed
            :call-error="keyForm.errors.value.expiresInDays"
          />

          <div class="flex justify-end gap-2 px-4.25 py-3.25">
            <Button theme="quiet" size="sm" type="button" @click="creatingKey = false"
              >Cancel</Button
            >
            <Button theme="primary" size="sm" type="submit" :disabled="keyForm.loading.value">
              <Icon v-if="keyForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Create
            </Button>
          </div>
        </form>

        <template v-if="keysStatus === 'pending' && !keysLoadedOnce">
          <SkeletonRow v-for="index in 2" :key="index" />
        </template>

        <EmptyState
          v-else-if="!apiKeys.length"
          variant="prompt"
          description="No API keys yet."
          class="m-2.5"
        />

        <Row v-for="key in apiKeys" :key="key.id" as="div" class="flex items-center gap-3.5">
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13.5px] text-ink">{{ key.name }}</p>
            <p class="truncate text-caption text-ink-2">
              {{ key.prefix }}••• · last used {{ formatWhen(key.lastUsedAt) }}
              <span v-if="key.expiresAt"> · expires {{ formatWhen(key.expiresAt) }}</span>
            </p>
          </div>
          <button
            type="button"
            title="Revoke"
            :disabled="revokingKey === key.id"
            class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed disabled:opacity-60"
            @click="revokeKey(key.id)"
          >
            <Icon name="lucide:trash-2" class="size-4" />
          </button>
        </Row>
      </Card>

      <Card title="Active sessions" content-class="p-0">
        <template #right>
          <Button
            v-if="sessions.length > 1"
            theme="quiet"
            size="xs"
            :disabled="revokingAll"
            @click="revokeAllSessions"
          >
            <Icon v-if="revokingAll" name="svg-spinners:tadpole" size="16" />
            Sign out other sessions
          </Button>
        </template>

        <template v-if="sessionsStatus === 'pending' && !sessionsLoadedOnce">
          <SkeletonRow v-for="index in 2" :key="index" />
        </template>

        <template v-else>
          <Row v-for="item in sessions" :key="item.id" as="div" class="flex items-center gap-3.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13.5px] text-ink">
                {{ item.userAgent || 'Unknown device' }}
                <span v-if="item.current" class="text-caption text-ink-2">(this device)</span>
              </p>
              <p class="truncate text-caption text-ink-2">
                {{ item.ip || 'unknown IP' }} · last used {{ formatWhen(item.lastUsedAt) }}
              </p>
            </div>
            <button
              type="button"
              title="Revoke"
              :disabled="revokingSession === item.id"
              class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed disabled:opacity-60"
              @click="revokeSession(item.id)"
            >
              <Icon name="lucide:log-out" class="size-4" />
            </button>
          </Row>
        </template>
      </Card>

      <NuxtLink
        v-if="user?.superuser"
        to="/admin/users"
        class="flex items-center justify-between rounded-card border border-edge bg-card px-4.25 py-3.25 text-[13px] text-ink transition-colors hover:text-accent"
      >
        <span>Manage all users (superuser)</span>
        <Icon name="lucide:chevron-right" class="size-4" />
      </NuxtLink>
    </div>
  </Content>
</template>
