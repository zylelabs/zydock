<script setup lang="ts">
  const { name } = useTheme();
  const session = useSessionStore();
  const route = useRoute();
  const api = useApi();
  const organizationStore = useOrganizationStore();
  const { load } = useOrganizations();

  // On the client (the tokens live in localStorage), load the organizations once inside the app:
  // it fills the switcher and applies the current organization's branding.
  onMounted(() => {
    if (session.isAuthenticated) {
      load().catch(() => undefined);
    }
  });

  const loggingOut = ref(false);

  const logout = async () => {
    loggingOut.value = true;

    // Best effort: revoke the session on the server, but always clear it locally and leave.
    await api.post('/auth/logout').catch(() => undefined);

    organizationStore.clear();
    session.clear();
    await navigateTo('/login');
  };

  const navigation = computed(() => [
    { label: 'Overview', icon: 'lucide:layout-dashboard', to: '/' },
    { label: 'Projects', icon: 'lucide:folder-git-2', to: '/projects' },
    { label: 'Servers', icon: 'lucide:server', to: '/servers' },
    { label: 'Databases', icon: 'lucide:database', to: '/databases' },
    { label: 'Domains', icon: 'lucide:globe', to: '/domains' },
    { label: 'Backups', icon: 'lucide:archive', to: '/backups' },
    { label: 'Notifications', icon: 'lucide:bell', to: '/notifications' },
    { label: 'Observability', icon: 'lucide:activity', to: '/observability' },
    // Platform-wide capability, not an organization role — only shown to a superuser account.
    ...(session.user?.superuser
      ? [{ label: 'Queue', icon: 'lucide:list-todo', to: '/queue' }]
      : []),
  ]);

  // The dashboard matches only its exact path; every other section stays lit for its sub-routes.
  const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));

  const userInitial = computed(() => (session.user?.name || name.value).charAt(0).toUpperCase());
</script>

<template>
  <div class="flex min-h-screen">
    <aside class="flex w-64 shrink-0 flex-col border-r border-surface-border bg-surface-raised">
      <OrganizationSwitcher />

      <nav class="flex-1 space-y-1 overflow-y-auto p-3">
        <NuxtLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="
            isActive(item.to)
              ? 'bg-surface text-content'
              : 'text-content-muted hover:bg-surface hover:text-content'
          "
        >
          <Icon :name="item.icon" class="size-5 shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="space-y-1 border-t border-surface-border p-3">
        <NuxtLink
          to="/account"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="
            isActive('/account')
              ? 'bg-surface text-content'
              : 'text-content-muted hover:bg-surface hover:text-content'
          "
        >
          <Icon name="lucide:user" class="size-5 shrink-0" />
          <span class="truncate">Account</span>
        </NuxtLink>

        <NuxtLink
          to="/settings"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="
            isActive('/settings')
              ? 'bg-surface text-content'
              : 'text-content-muted hover:bg-surface hover:text-content'
          "
        >
          <Icon name="lucide:settings" class="size-5 shrink-0" />
          <span class="truncate">Settings</span>
        </NuxtLink>

        <div v-if="session.user" class="flex items-center gap-2 px-3 py-2">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-white"
          >
            {{ userInitial }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ session.user.name }}</p>
            <p class="truncate text-xs text-content-muted">{{ session.user.email }}</p>
          </div>
          <button
            type="button"
            title="Sign out"
            :disabled="loggingOut"
            class="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface hover:text-content disabled:opacity-60"
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

    <main class="min-w-0 flex-1 overflow-y-auto p-6">
      <slot />
    </main>
  </div>
</template>
