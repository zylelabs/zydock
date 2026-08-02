<script setup lang="ts">
  import OrganizationSwitcher from './OrganizationSwitcher.vue';

  const { isOpen, close } = useSidebar();

  const session = useSessionStore();
  const api = useApi();

  const userInitial = computed(() => (session.user?.name ?? '').charAt(0).toUpperCase());

  const loggingOut = ref(false);

  const logout = async () => {
    loggingOut.value = true;

    await api.post('/auth/logout').catch(() => undefined);

    session.clear();
    await navigateTo('/auth/login');
  };
</script>

<template>
  <aside
    class="fixed top-12 left-0 h-[calc(100dvh-3rem)] w-(--sidebar-width) px-4 border-r border-surface-border bg-surface-sunken backdrop-blur-sm flex flex-col py-6 gap-2 z-40 transform transition-transform duration-300 ease-in-out lg:static lg:top-auto lg:h-full lg:z-auto lg:translate-x-0"
    :class="isOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <div class="flex items-center gap-3 select-none">
      <img src="@/assets/img/logo.svg" width="42" />
      <div class="border-l border-white/25 pl-3 my-auto flex flex-col">
        <div class="text-lg/tight text-white uppercase font-montserrat tracking-wider">ZyDock</div>
        <span class="text-xs tracking-wider font-montserrat">v0.0.1</span>
      </div>
    </div>

    <div class="my-6">
      <OrganizationSwitcher />
    </div>

    <nav class="flex flex-col gap-1 flex-1">
      <NuxtLink
        class="hover:bg-primary-400/8 p-2 flex text-sm font-medium rounded-md items-center gap-3 transition-colors"
        active-class="bg-primary-400/15 hover:bg-primary-400/15 text-primary-400 font-medium p-2 flex items-center gap-3 transition-colors border-l-3 border-primary-400"
        to="/"
        @click="close"
      >
        <Icon name="lucide:layout-dashboard" size="18" />
        <span class="text-body-md">Overview</span>
      </NuxtLink>
      <NuxtLink
        class="hover:bg-primary-400/8 p-2 flex text-sm font-medium rounded-md items-center gap-3 transition-colors"
        active-class="bg-primary-400/15 hover:bg-primary-400/15 text-primary-400 font-medium p-2 flex items-center gap-3 transition-colors border-l-3 border-primary-400"
        to="/projects"
        @click="close"
      >
        <Icon name="lucide:folder-git-2" size="18" />
        <span class="text-body-md">Projects</span>
      </NuxtLink>
      <NuxtLink
        class="hover:bg-primary-400/8 p-2 flex text-sm font-medium rounded-md items-center gap-3 transition-colors"
        active-class="bg-primary-400/15 hover:bg-primary-400/15 text-primary-400 font-medium p-2 flex items-center gap-3 transition-colors border-l-3 border-primary-400"
        to="/servers"
        @click="close"
      >
        <Icon name="lucide:server" size="18" />
        <span class="text-body-md">Servers</span>
      </NuxtLink>
    </nav>

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
        class="rounded-md p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-content-strong disabled:opacity-60"
        @click="logout"
      >
        <Icon
          :name="loggingOut ? 'lucide:loader-circle' : 'lucide:log-out'"
          :class="['size-4', loggingOut && 'animate-spin']"
        />
      </button>
    </div>

    <!-- <div class="mt-auto mx-auto text-sm text-white/80 font-medium">development - v0.0.1</div> -->
  </aside>
</template>
