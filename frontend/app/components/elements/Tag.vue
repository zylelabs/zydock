<script setup lang="ts">
  type Color = 'default' | 'live' | 'attn' | 'failed';
  type LegacyColor = 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'orange';

  const props = defineProps<{ color?: Color | LegacyColor | (string & {}) }>();

  const legacyColors: Record<LegacyColor, Color> = {
    green: 'live',
    red: 'failed',
    yellow: 'attn',
    blue: 'default',
    purple: 'default',
    orange: 'default',
  };

  const colors: Record<Color, string> = {
    default: 'bg-hairline text-ink-2',
    live: 'bg-live-bg text-live-ink',
    attn: 'bg-attn-bg text-attn-ink',
    failed: 'bg-failed/10 text-failed',
  };

  const resolvedColor = computed<Color>(
    () => legacyColors[props.color as LegacyColor] ?? (props.color as Color) ?? 'default',
  );

  const tagClass = computed(() => colors[resolvedColor.value]);
</script>

<template>
  <span
    class="inline-flex cursor-default! items-center rounded-full px-2.25 py-0.75 text-label uppercase"
    :class="tagClass"
  >
    <slot />
  </span>
</template>
