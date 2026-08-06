<script setup lang="ts">
  import GeneralTab from './.GeneralTab.vue';
  import TeamTab from './.TeamTab.vue';
  import GitSourcesTab from './.GitSourcesTab.vue';
  import UpdatesTab from './.UpdatesTab.vue';
  import DangerZoneTab from './.DangerZoneTab.vue';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useTeam } from '~/composables/services/useTeam';

  useHead({ title: 'Settings' });

  const route = useRoute();
  const session = useSessionStore();
  const { current } = useOrganizations();
  const { listMembers } = useTeam();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const isOwner = computed(() => current.value?.role === 'owner');
  const isSuperuser = computed(() => Boolean(session.user?.superuser));

  type TabId = 'general' | 'team' | 'git' | 'updates' | 'danger';

  const TABS = computed<{ id: TabId; label: string }[]>(() => [
    { id: 'general', label: 'General' },
    { id: 'team', label: 'Team' },
    { id: 'git', label: 'Git sources' },
    ...(isSuperuser.value ? [{ id: 'updates' as const, label: 'Updates' }] : []),
    { id: 'danger', label: 'Danger zone' },
  ]);

  const isTab = (value: unknown): value is TabId => TABS.value.some(tab => tab.id === value);

  const activeTab = ref<TabId>(isTab(route.query.tab) ? route.query.tab : 'general');

  const empty = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data: membersData } = useLazyAsyncData(
    () => `settings-member-count-${current.value?.id}`,
    () => (current.value ? listMembers() : Promise.resolve(empty)),
    { server: false, watch: [() => current.value?.id], default: () => empty },
  );

  const memberCount = computed(() => membersData.value?.total ?? 0);

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({ title: 'Settings', context: current.value?.name });
  });
</script>

<template>
  <Content>
    <EmptyState
      v-if="!current"
      variant="action"
      title="Select an organization"
      description="Choose or create an organization in the sidebar selector."
    />

    <div v-else class="flex max-w-215 flex-col gap-4.5">
      <Tabs v-model="activeTab" :tabs="TABS" />

      <GeneralTab
        v-if="activeTab === 'general'"
        :organization="current"
        :can-manage="canManage"
        :member-count="memberCount"
      />
      <TeamTab
        v-else-if="activeTab === 'team'"
        :organization="current"
        :can-manage="canManage"
        :is-owner="isOwner"
      />
      <GitSourcesTab
        v-else-if="activeTab === 'git'"
        :organization="current"
        :can-manage="canManage"
      />
      <UpdatesTab v-else-if="activeTab === 'updates' && isSuperuser" />
      <DangerZoneTab v-else :organization="current" :is-owner="isOwner" />
    </div>
  </Content>
</template>
