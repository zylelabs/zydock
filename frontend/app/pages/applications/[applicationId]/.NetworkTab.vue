<script setup lang="ts">
  import type { Application } from '~/composables/services/useApplications';

  defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();
</script>

<template>
  <div class="flex max-w-205 flex-col gap-4.5">
    <DomainsCard :application-id="application.id" :can-manage="canManage" />
    <template v-if="application.source === 'git'">
      <PortsCard :application="application" :can-manage="canManage" @refresh="emit('refresh')" />
      <NetworksCard :application="application" :can-manage="canManage" @refresh="emit('refresh')" />
    </template>
    <p v-else class="text-caption text-ink-2">
      Ports and networks come from the compose file — see the Compose tab.
    </p>
  </div>
</template>
