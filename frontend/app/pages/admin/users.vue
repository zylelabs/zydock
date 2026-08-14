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

  const { data, status, refresh } = useLazyAsyncData(
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

  const isFirstLoad = useFirstLoad(status);

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

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({ title: 'Users', context: 'Account' });
  });
</script>

<template>
  <Content>
    <Card v-if="!isSuperuser" title="Access restricted">
      <p class="text-caption text-ink-2">Only a superuser account can manage users.</p>
    </Card>

    <div v-else class="flex flex-col gap-4.5">
      <div class="flex flex-wrap gap-4">
        <div class="flex-1">
          <Input v-model="search" label="Search" placeholder="name or email" boxed bare />
        </div>
        <div class="w-48">
          <Select v-model="statusFilter" label="Status" :options="statusOptions" boxed bare />
        </div>
      </div>

      <Card content-class="p-0">
        <template v-if="isFirstLoad">
          <SkeletonRow v-for="index in 4" :key="index" avatar />
        </template>

        <EmptyState
          v-else-if="!users.length"
          variant="prompt"
          description="No users match this filter."
          class="m-2.5"
        />

        <Row v-for="user in users" :key="user.id" as="div" class="flex items-center gap-3.5">
          <Avatar :name="user.name || user.email" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-caption text-ink">
              {{ user.name }}
              <span v-if="isSelf(user)" class="text-caption text-ink-2">(you)</span>
              <Tag v-if="user.superuser" color="live" class="ml-1">superuser</Tag>
            </p>
            <p class="truncate text-caption text-ink-2">
              {{ user.email }} · last login {{ formatWhen(user.lastLoginAt) }}
            </p>
          </div>
          <Tag :color="user.status === 'active' ? 'live' : 'attn'">{{ user.status }}</Tag>
          <Button
            v-if="!isSelf(user)"
            theme="secondary"
            size="xs"
            :disabled="busy === user.id"
            @click="toggleStatus(user)"
          >
            <Icon v-if="busy === user.id" name="svg-spinners:tadpole" size="14" />
            {{ user.status === 'active' ? 'Disable' : 'Enable' }}
          </Button>
        </Row>
      </Card>
    </div>
  </Content>
</template>
