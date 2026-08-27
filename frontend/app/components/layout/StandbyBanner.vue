<script setup lang="ts">
  import { useHealth } from '~/composables/services/useHealth';
  import { daysSince, STANDBY_STALE_DAYS } from '~/composables/services/useInstallation';

  const { data } = useAsyncData('layout-standby-banner', () => useHealth().get(), {
    server: false,
  });

  const isStandby = computed(() => data.value?.role === 'standby');
  const dataAgeDays = computed(() => daysSince(data.value?.dataFrom));
  const isStale = computed(() => dataAgeDays.value >= STANDBY_STALE_DAYS);
  const formattedDate = computed(() =>
    data.value?.dataFrom ? new Date(data.value.dataFrom).toLocaleDateString('en-US') : '',
  );
</script>

<template>
  <div
    v-if="isStandby"
    class="flex items-center justify-center gap-2 border-b border-attn/40 bg-attn-bg px-4 py-1.5 text-center text-caption text-attn-ink"
  >
    <Icon name="lucide:triangle-alert" class="size-3.5 shrink-0" />
    <span>
      This installation is in standby, read-only.
      <template v-if="formattedDate"> Its data is from {{ formattedDate }}{{ ' ' }}</template>
      <template v-if="isStale">— {{ dataAgeDays }} days old, consider destroying it.</template>
    </span>
  </div>
</template>
