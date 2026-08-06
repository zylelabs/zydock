<script setup lang="ts">
  import { useOrganizations } from '~/composables/services/useOrganizations';

  const { navbar } = useNavbar();
  const { isOpen, close } = useSidebar();

  const pageStore = usePageStore();
  const session = useSessionStore();
  const router = useRouter();
  const { load } = useOrganizations();

  const scrollContainer = ref<HTMLDivElement | null>(null);

  const scrollToTop = () => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  };

  provide('scrollToTop', scrollToTop);

  pageStore.addLoadingPage('delay');

  onMounted(async () => {
    if (!session.isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    await load().catch(() => undefined);

    pageStore.addLoadingPage('delay');
    pageStore.addLoadingPage('user');

    setTimeout(() => {
      pageStore.removeLoadingPage('user');
      pageStore.removeLoadingPage('delay');
    }, 500);
  });
</script>

<template>
  <LoadingPage />

  <div v-if="pageStore.hasLoadingPage" class="absolute top-0 left-0 h-full w-full bg-page" />

  <div v-else class="fixed inset-0 flex h-screen overflow-hidden bg-page text-ink">
    <Sidebar />

    <Transition name="fade">
      <div v-if="isOpen" class="fixed inset-0 z-30 bg-ink/40 lg:hidden" @click="close"></div>
    </Transition>

    <div class="flex w-full min-w-0 flex-1 flex-col">
      <Header
        :title="navbar.title"
        :context="navbar.context"
        :loading="navbar.loading"
        :action="navbar.action"
      />

      <div
        id="scroll-container"
        ref="scrollContainer"
        class="w-full min-h-0 flex-1 overflow-y-auto"
      >
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
  .fade-enter-active,
  .fade-leave-active {
    transition: opacity 0.3s ease;
  }
  .fade-enter-from,
  .fade-leave-to {
    opacity: 0;
  }
</style>
