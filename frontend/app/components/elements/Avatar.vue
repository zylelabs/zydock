<script setup lang="ts">
  import { getColorFromName } from '~/utils';

  const props = defineProps<{ name: string; class?: string }>();

  const initials = computed(() => {
    const parts = props.name.trim().split(/\s+/).filter(Boolean);

    if (!parts.length) {
      return '?';
    }

    if (parts.length === 1) {
      return parts[0]!.slice(0, 2).toUpperCase();
    }

    return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
  });

  const background = computed(() => getColorFromName(props.name));
</script>

<template>
  <div
    class="flex size-8.5 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold text-white"
    :class="props.class"
    :style="{ background }"
  >
    {{ initials }}
  </div>
</template>
