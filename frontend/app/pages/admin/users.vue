<script setup lang="ts">
  import { USER_STATUSES, type UserAccount, type UserAccountStatus } from '~/composables/use-users';

  useHead({ title: 'Users' });

  const session = useSessionStore();
  const isSuperuser = computed(() => Boolean(session.user?.superuser));
  const usersApi = useUsers();

  const actionError = ref('');
  const busy = ref('');
  const search = ref('');
  const statusFilter = ref<UserAccountStatus | ''>('');

  const { data, refresh } = await useAsyncData(
    'admin-users',
    async () => {
      if (!isSuperuser.value) {
        return { users: [] };
      }

      const result = await usersApi.list({
        search: search.value || undefined,
        status: statusFilter.value || undefined,
      });

      return { users: result.items };
    },
    { server: false, watch: [isSuperuser, search, statusFilter], default: () => ({ users: [] }) },
  );

  const users = computed(() => data.value?.users ?? []);

  const statusOptions = [
    { value: '', label: 'All statuses' },
    ...USER_STATUSES.map(status => ({ value: status, label: status })),
  ];

  const isSelf = (user: UserAccount) => user.id === session.user?.id;

  const toggleStatus = async (user: UserAccount) => {
    actionError.value = '';
    busy.value = user.id;

    try {
      await usersApi.update(user.id, { status: user.status === 'active' ? 'disabled' : 'active' });
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to update the user.';
    } finally {
      busy.value = '';
    }
  };

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');
</script>

<template>
  <section class="mx-auto flex max-w-3xl flex-col gap-6">
    <NuxtLink
      to="/account"
      class="flex items-center gap-1 text-sm text-content-muted hover:text-content"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Account
    </NuxtLink>

    <header>
      <h1>Users</h1>
      <p class="mt-1 text-sm text-content-muted">Platform-wide user administration.</p>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!isSuperuser" title="Access restricted">
      <p class="text-sm text-content-muted">Only a superuser account can manage users.</p>
    </UiCard>

    <template v-else>
      <div class="flex flex-wrap gap-4">
        <div class="flex-1">
          <UiInput v-model="search" label="Search" placeholder="name or email" />
        </div>
        <div class="w-48">
          <UiSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        </div>
      </div>

      <UiCard title="Users">
        <p v-if="!users.length" class="text-sm text-content-muted">No users match this filter.</p>

        <ul v-else class="flex flex-col divide-y divide-surface-border">
          <li v-for="user in users" :key="user.id" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ user.name }}
                <span v-if="isSelf(user)" class="text-xs text-content-muted">(you)</span>
                <UiBadge v-if="user.superuser" variant="info" class="ml-1">superuser</UiBadge>
              </p>
              <p class="truncate text-xs text-content-muted">
                {{ user.email }} · last login {{ formatWhen(user.lastLoginAt) }}
              </p>
            </div>
            <UiBadge :variant="user.status === 'active' ? 'success' : 'warning'">
              {{ user.status }}
            </UiBadge>
            <UiButton
              v-if="!isSelf(user)"
              variant="ghost"
              :loading="busy === user.id"
              @click="toggleStatus(user)"
            >
              {{ user.status === 'active' ? 'Disable' : 'Enable' }}
            </UiButton>
          </li>
        </ul>
      </UiCard>
    </template>
  </section>
</template>
