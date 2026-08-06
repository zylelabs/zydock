<script setup lang="ts">
  const page = usePageStore();
</script>

<template>
  <Transition name="fade-only-leave" appear>
    <div
      v-show="page.hasLoadingPage"
      class="flex items-center justify-center absolute z-50 w-full h-full top-0 left-0 bg-page"
    >
      <Icon name="svg-spinners:pulse-rings-multiple" class="text-accent" size="3em" />
    </div>
  </Transition>
</template>

<style scoped>
  .fade-only-leave-leave-active {
    transition: opacity 0.5s ease;
  }
  .fade-only-leave-leave-to {
    opacity: 0;
  }

  .fade-only-leave-enter-active,
  .fade-only-leave-enter-from,
  .fade-only-leave-enter-to {
    transition: none;
    opacity: 1;
  }
</style>
