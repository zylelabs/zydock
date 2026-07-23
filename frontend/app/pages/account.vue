<script setup lang="ts">
  import { z } from 'zod';

  useHead({ title: 'Account' });

  const session = useSessionStore();
  const usersApi = useUsers();
  const apiKeysApi = useApiKeys();
  const sessionsApi = useSessions();

  const actionError = ref('');

  // --- Profile ------------------------------------------------------------------------------------

  const { data: profileData, refresh: refreshProfile } = await useAsyncData(
    'account-profile',
    () => usersApi.me(),
    { server: false },
  );

  const user = computed(() => profileData.value?.user ?? null);

  const profileForm = useForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      avatar: z.string().trim().max(2048),
    }),
    { name: '', avatar: '' },
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

  const profileSaved = ref(false);

  const onSaveProfile = profileForm.submit(async values => {
    profileSaved.value = false;

    const { user: updated } = await usersApi.updateMe({
      name: values.name,
      avatar: values.avatar || undefined,
    });

    session.updateUser({ name: updated.name, avatar: updated.avatar });
    profileSaved.value = true;
    await refreshProfile();
  });

  // --- Password -----------------------------------------------------------------------------------

  const passwordForm = useForm(
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
  );

  const passwordChanged = ref(false);

  const onChangePassword = passwordForm.submit(async values => {
    passwordChanged.value = false;

    await usersApi.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });

    passwordChanged.value = true;
    passwordForm.reset();
  });

  // --- API keys -------------------------------------------------------------------------------------

  const { data: keysData, refresh: refreshKeys } = await useAsyncData(
    'account-api-keys',
    () => apiKeysApi.list(),
    { server: false, default: () => ({ items: [], total: 0, page: 1, size: 0, pages: 0 }) },
  );

  const apiKeys = computed(() => keysData.value?.items ?? []);

  const creatingKey = ref(false);
  const keyForm = useForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      expiresInDays: z.string().regex(/^\d*$/, 'Invalid number of days'),
    }),
    { name: '', expiresInDays: '' },
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
    actionError.value = '';
    revokingKey.value = id;

    try {
      await apiKeysApi.revoke(id);
      await refreshKeys();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to revoke the key.';
    } finally {
      revokingKey.value = '';
    }
  };

  // --- Sessions ---------------------------------------------------------------------------------

  const { data: sessionsData, refresh: refreshSessions } = await useAsyncData(
    'account-sessions',
    () => sessionsApi.list(),
    { server: false, default: () => ({ items: [], total: 0, page: 1, size: 0, pages: 0 }) },
  );

  const sessions = computed(() => sessionsData.value?.items ?? []);

  const revokingSession = ref('');

  const revokeSession = async (id: string) => {
    actionError.value = '';
    revokingSession.value = id;

    try {
      await sessionsApi.revoke(id);
      await refreshSessions();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to revoke the session.';
    } finally {
      revokingSession.value = '';
    }
  };

  const revokingAll = ref(false);

  const revokeAllSessions = async () => {
    actionError.value = '';
    revokingAll.value = true;

    try {
      await sessionsApi.revokeAll();
      await refreshSessions();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to revoke sessions.';
    } finally {
      revokingAll.value = false;
    }
  };

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');
</script>

<template>
  <section class="mx-auto flex max-w-2xl flex-col gap-6">
    <header>
      <h1>Account</h1>
      <p class="mt-1 text-sm text-content-muted">Your profile, password, API keys and sessions.</p>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard title="Profile">
      <form class="flex flex-col gap-4" @submit.prevent="onSaveProfile">
        <UiAlert v-if="profileForm.formError.value" variant="error">
          {{ profileForm.formError.value }}
        </UiAlert>
        <UiAlert v-if="profileSaved" variant="success">Profile saved.</UiAlert>

        <div>
          <p class="text-sm font-medium text-content">Email</p>
          <p class="mt-1.5 text-sm text-content-muted">{{ user?.email }}</p>
        </div>
        <UiInput
          v-model="profileForm.values.name"
          label="Name"
          :error="profileForm.errors.value.name"
        />
        <UiInput
          v-model="profileForm.values.avatar"
          label="Avatar URL (optional)"
          placeholder="https://…/avatar.png"
        />

        <UiBadge v-if="user?.superuser" variant="info" class="w-fit">Superuser</UiBadge>

        <div class="flex justify-end">
          <UiButton type="submit" :loading="profileForm.submitting.value">Save</UiButton>
        </div>
      </form>
    </UiCard>

    <UiCard title="Password">
      <form class="flex flex-col gap-4" @submit.prevent="onChangePassword">
        <UiAlert v-if="passwordForm.formError.value" variant="error">
          {{ passwordForm.formError.value }}
        </UiAlert>
        <UiAlert v-if="passwordChanged" variant="success">
          Password changed. Other sessions were signed out.
        </UiAlert>

        <UiInput
          v-model="passwordForm.values.currentPassword"
          label="Current password"
          type="password"
          :error="passwordForm.errors.value.currentPassword"
        />
        <UiInput
          v-model="passwordForm.values.newPassword"
          label="New password"
          type="password"
          :error="passwordForm.errors.value.newPassword"
        />
        <UiInput
          v-model="passwordForm.values.confirmPassword"
          label="Confirm new password"
          type="password"
          :error="passwordForm.errors.value.confirmPassword"
        />

        <div class="flex justify-end">
          <UiButton type="submit" :loading="passwordForm.submitting.value"
            >Change password</UiButton
          >
        </div>
      </form>
    </UiCard>

    <UiCard title="API keys" description="Tokens for scripts and integrations to call the API.">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>API keys</h2>
          <UiButton v-if="!creatingKey" variant="secondary" @click="creatingKey = true">
            <Icon name="lucide:plus" class="size-4" />
            New key
          </UiButton>
        </div>
      </template>

      <UiAlert v-if="createdToken" variant="success" class="mb-4">
        <p>Copy this token now — it will not be shown again.</p>
        <pre class="mt-2 overflow-x-auto rounded-lg bg-surface p-2 text-xs">{{ createdToken }}</pre>
      </UiAlert>

      <form v-if="creatingKey" class="mb-4 flex flex-col gap-4" @submit.prevent="onCreateKey">
        <UiAlert v-if="keyForm.formError.value" variant="error">
          {{ keyForm.formError.value }}
        </UiAlert>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="keyForm.values.name"
            label="Name"
            placeholder="ci-deploy"
            :error="keyForm.errors.value.name"
          />
          <UiInput
            v-model="keyForm.values.expiresInDays"
            label="Expires in days (optional)"
            placeholder="90"
            :error="keyForm.errors.value.expiresInDays"
          />
        </div>

        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="creatingKey = false">Cancel</UiButton>
          <UiButton type="submit" :loading="keyForm.submitting.value">Create</UiButton>
        </div>
      </form>

      <p v-if="!apiKeys.length" class="text-sm text-content-muted">No API keys yet.</p>

      <ul v-else class="flex flex-col divide-y divide-surface-border">
        <li v-for="key in apiKeys" :key="key.id" class="flex items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ key.name }}</p>
            <p class="truncate text-xs text-content-muted">
              {{ key.prefix }}••• · last used {{ formatWhen(key.lastUsedAt) }}
              <span v-if="key.expiresAt"> · expires {{ formatWhen(key.expiresAt) }}</span>
            </p>
          </div>
          <button
            type="button"
            title="Revoke"
            :disabled="revokingKey === key.id"
            class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger disabled:opacity-60"
            @click="revokeKey(key.id)"
          >
            <Icon name="lucide:trash-2" class="size-4" />
          </button>
        </li>
      </ul>
    </UiCard>

    <UiCard title="Active sessions">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Active sessions</h2>
          <UiButton
            v-if="sessions.length > 1"
            variant="ghost"
            :loading="revokingAll"
            @click="revokeAllSessions"
          >
            Sign out other sessions
          </UiButton>
        </div>
      </template>

      <ul class="flex flex-col divide-y divide-surface-border">
        <li v-for="item in sessions" :key="item.id" class="flex items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
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
            class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger disabled:opacity-60"
            @click="revokeSession(item.id)"
          >
            <Icon name="lucide:log-out" class="size-4" />
          </button>
        </li>
      </ul>
    </UiCard>

    <NuxtLink
      v-if="user?.superuser"
      to="/admin/users"
      class="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised p-4 text-sm transition-colors hover:text-primary"
    >
      <span>Manage all users (superuser)</span>
      <Icon name="lucide:chevron-right" class="size-4" />
    </NuxtLink>
  </section>
</template>
