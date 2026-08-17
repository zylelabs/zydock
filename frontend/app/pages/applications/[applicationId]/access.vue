<script setup lang="ts">
  import type { RouteLocationGeneric } from 'vue-router';

  definePageMeta({
    redirect: (to: RouteLocationGeneric) =>
      `/applications/${to.params.applicationId}/logs?view=access`,
  });
</script>

<template>
  <div />
</template>
