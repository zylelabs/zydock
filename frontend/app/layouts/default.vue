<script setup lang="ts">
  const { name, logo } = useTheme();
  const session = useSessionStore();
  const route = useRoute();
  const api = useApi();

  const loggingOut = ref(false);

  const logout = async () => {
    loggingOut.value = true;

    // Best effort: revoke the session on the server, but always clear it locally and leave.
    await api.post('/auth/logout').catch(() => undefined);

    session.clear();
    await navigateTo('/login');
  };

  const navigation = [
    { label: 'Visão geral', icon: 'lucide:layout-dashboard', to: '/' },
    { label: 'Projetos', icon: 'lucide:folder-git-2', to: '/projects' },
    { label: 'Servidores', icon: 'lucide:server', to: '/servers' },
    { label: 'Bancos de dados', icon: 'lucide:database', to: '/databases' },
    { label: 'Domínios', icon: 'lucide:globe', to: '/domains' },
    { label: 'Observabilidade', icon: 'lucide:activity', to: '/observability' },
  ];

  // The dashboard matches only its exact path; every other section stays lit for its sub-routes.
  const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));

  const userInitial = computed(() => (session.user?.name || name.value).charAt(0).toUpperCase());
</script>

<template>
  <div class="flex min-h-screen">
    <aside class="flex w-64 shrink-0 flex-col border-r border-surface-border bg-surface-raised">
      <NuxtLink to="/" class="flex items-center gap-3 border-b border-surface-border px-5 py-4">
        <img v-if="logo" :src="logo" :alt="name" class="size-8 rounded-lg object-contain" />
        <span
          v-else
          class="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white"
        >
          {{ name.charAt(0) }}
        </span>
        <span class="truncate text-base font-semibold">{{ name }}</span>
      </NuxtLink>

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
          to="/settings"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="
            isActive('/settings')
              ? 'bg-surface text-content'
              : 'text-content-muted hover:bg-surface hover:text-content'
          "
        >
          <Icon name="lucide:settings" class="size-5 shrink-0" />
          <span class="truncate">Configurações</span>
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
            title="Sair"
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
