<script setup lang="ts">
  import {
    USER_STATUSES,
    useUsers,
    type UserAccount,
    type UserAccountStatus,
  } from '~/composables/services/useUsers';

  useHead({ title: 'Users' });

  const toast = useToast();
  const session = useSessionStore();
  const usersApi = useUsers();

  const isSuperuser = computed(() => Boolean(session.user?.superuser));

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
    busy.value = user.id;

    try {
      await usersApi.update(user.id, { status: user.status === 'active' ? 'disabled' : 'active' });
      await refresh();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to update the user.',
      });
    } finally {
      busy.value = '';
    }
  };

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');
</script>

<template>
  <Content>
    <NuxtLink
      to="/account"
      class="mb-4 inline-flex items-center gap-1 text-sm text-content-muted transition-colors hover:text-content-strong"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Account
    </NuxtLink>

    <Header title="Users" description="Platform-wide user administration." />

    <Card v-if="!isSuperuser" title="Access restricted">
      <p class="text-sm text-content-muted">Only a superuser account can manage users.</p>
    </Card>

    <div v-else class="flex flex-col gap-6">
      <div class="flex flex-wrap gap-4">
        <div class="flex-1">
          <Input v-model="search" label="Search" placeholder="name or email" />
        </div>
        <div class="w-48">
          <Select v-model="statusFilter" label="Status" :options="statusOptions" />
        </div>
      </div>

      <Card title="Users">
        <p v-if="!users.length" class="text-sm text-content-muted">No users match this filter.</p>

        <ul v-else class="flex flex-col divide-y divide-surface-line">
          <li v-for="user in users" :key="user.id" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-content-strong">
                {{ user.name }}
                <span v-if="isSelf(user)" class="text-xs text-content-muted">(you)</span>
                <Tag v-if="user.superuser" color="blue" class="ml-1">superuser</Tag>
              </p>
              <p class="truncate text-xs text-content-muted">
                {{ user.email }} · last login {{ formatWhen(user.lastLoginAt) }}
              </p>
            </div>
            <Tag :color="user.status === 'active' ? 'green' : 'yellow'">{{ user.status }}</Tag>
            <Button
              v-if="!isSelf(user)"
              theme="ghost"
              :disabled="busy === user.id"
              @click="toggleStatus(user)"
            >
              <Icon v-if="busy === user.id" name="svg-spinners:tadpole" size="16" />
              {{ user.status === 'active' ? 'Disable' : 'Enable' }}
            </Button>
          </li>
        </ul>
      </Card>
    </div>
  </Content>
</template>
