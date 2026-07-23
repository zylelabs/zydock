<script setup lang="ts">
  // Binds the organization theme to the document for the whole interface: title, favicon and colors.
  useTheme().applyToDocument();
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
