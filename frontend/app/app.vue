<script setup lang="ts">
  useAppearance();

  const { panelName } = usePanelName();

  useHead(() => ({
    titleTemplate: title => (title ? `${title} | ${panelName.value}` : panelName.value),
  }));
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
