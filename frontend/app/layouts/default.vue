<script setup lang="ts">
  const { name } = useTheme();
  const session = useSessionStore();
  const route = useRoute();
  const api = useApi();
  const organizationStore = useOrganizationStore();
  const { load } = useOrganizations();

  onMounted(() => {
    if (session.isAuthenticated) {
      load().catch(() => undefined);
    }
  });

  const loggingOut = ref(false);

  const logout = async () => {
    loggingOut.value = true;

    await api.post('/auth/logout').catch(() => undefined);

    organizationStore.clear();
    session.clear();
    await navigateTo('/login');
  };

  const navigation = computed(() => [
    {
      label: 'General',
      items: [
        { label: 'Overview', icon: 'lucide:layout-dashboard', to: '/' },
        { label: 'Projects', icon: 'lucide:folder-git-2', to: '/projects' },
        { label: 'Servers', icon: 'lucide:server', to: '/servers' },
      ],
    },
    {
      label: 'Resources',
      items: [
        { label: 'Databases', icon: 'lucide:database', to: '/databases' },
        { label: 'Domains', icon: 'lucide:globe', to: '/domains' },
        { label: 'Backups', icon: 'lucide:archive', to: '/backups' },
      ],
    },
    {
      label: 'Operations',
      items: [
        { label: 'Observability', icon: 'lucide:activity', to: '/observability' },
        { label: 'Notifications', icon: 'lucide:bell', to: '/notifications' },
        ...(session.user?.superuser
          ? [{ label: 'Queue', icon: 'lucide:list-todo', to: '/queue' }]
          : []),
      ],
    },
  ]);

  const footerNavigation = [
    { label: 'Account', icon: 'lucide:user', to: '/account' },
    { label: 'Settings', icon: 'lucide:settings', to: '/settings' },
  ];

  const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));

  const itemClasses = (to: string) =>
    mergeClasses(
      'flex items-center gap-3 rounded-lg p-2 text-sm font-medium transition-colors',
      isActive(to)
        ? 'bg-surface-hover text-content-strong'
        : 'text-content hover:bg-surface-hover/60 hover:text-content-strong',
    );

  const userInitial = computed(() => (session.user?.name || name.value).charAt(0).toUpperCase());
</script>

<template>
  <div class="flex min-h-screen">
    <NebulaBackground />

    <aside
      class="flex w-62 shrink-0 flex-col border-r border-surface-border bg-surface-sunken px-4 pt-5 pb-4 backdrop-blur-sm"
    >
      <OrganizationSwitcher />

      <nav class="mt-5 flex-1 space-y-4.5 overflow-y-auto">
        <div v-for="group in navigation" :key="group.label">
          <p
            class="px-2 pb-2 text-[11px] font-semibold tracking-[0.04em] text-content-dim uppercase"
          >
            {{ group.label }}
          </p>

          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            :class="itemClasses(item.to)"
          >
            <Icon :name="item.icon" class="size-5 shrink-0" />
            <span class="truncate">{{ item.label }}</span>
          </NuxtLink>
        </div>
      </nav>

      <div class="mt-4 space-y-1">
        <NuxtLink
          v-for="item in footerNavigation"
          :key="item.to"
          :to="item.to"
          :class="itemClasses(item.to)"
        >
          <Icon :name="item.icon" class="size-5 shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </NuxtLink>

        <div
          v-if="session.user"
          class="mt-3 flex items-center gap-3 rounded-xl border border-surface-border bg-surface-raised p-3"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary to-primary-strong text-sm font-semibold text-white"
          >
            {{ userInitial }}
          </span>

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-content-strong">
              {{ session.user.name }}
            </p>
            <p class="truncate text-[13px] text-content-muted">{{ session.user.email }}</p>
          </div>

          <button
            type="button"
            title="Sign out"
            :disabled="loggingOut"
            class="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-content-strong disabled:opacity-60"
            @click="logout"
          >
            <Icon
              :name="loggingOut ? 'lucide:loader-circle' : 'lucide:log-out'"
              :class="['size-4', loggingOut && 'animate-spin']"
            />
          </button>
        </div>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto px-8 py-7">
      <slot />
    </main>
  </div>
</template>
