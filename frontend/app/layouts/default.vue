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

    // try {
    //   const me = await $fetch<IMeResponse>('/api/proxy/auth/me', {
    //     query: { api: 'auth' },
    //   });

    //   if (me) {
    //     user.email = me.email;
    //     user.name = me.name;
    //     user.organizations = me.organizations;

    //     if (me.organizations && me.organizations.length > 0) {
    //       const features: Features = [];

    //       await Promise.all(
    //         me.organizations.map(async (org: IOrganization) => {
    //           const response = await $fetch<any>(`/api/proxy/analysis/organizations/${org.id}`);

    //           if (response.features) {
    //             features.push(...response.features);
    //           }
    //         }),
    //       );

    //       user.features = features;
    //     }
    //   }
    // } finally {
    //   pageStore.removeLoadingPage('user');

    //   setTimeout(() => {
    //     pageStore.removeLoadingPage('delay');
    //     scrollToTop();
    //   }, 500);
    // }

    setTimeout(() => {
      pageStore.removeLoadingPage('user');
      pageStore.removeLoadingPage('delay');
    }, 500);
  });
</script>

<template>
  <Background />
  <LoadingPage />

  <div v-if="pageStore.hasLoadingPage" class="bg-surface absolute w-full h-full top-0 left-0" />

  <div v-else class="fixed inset-0 flex h-screen flex-col overflow-hidden bg-background">
    <!-- <ProductNavbar /> -->

    <div class="flex min-h-0 flex-1">
      <Sidebar />

      <div class="flex w-full min-w-0 flex-1 flex-col">
        <Transition name="fade">
          <div
            v-if="isOpen"
            class="fixed inset-0 top-12 z-30 bg-black/40 lg:hidden"
            @click="close"
          ></div>
        </Transition>

        <Navbar :title="navbar.title" :breadcrumb="navbar.breadcrumb" :loading="navbar.loading" />

        <div
          id="scroll-container"
          ref="scrollContainer"
          class="w-full min-h-0 flex-1 overflow-y-auto"
        >
          <div class="">
            <slot />
          </div>
        </div>
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
