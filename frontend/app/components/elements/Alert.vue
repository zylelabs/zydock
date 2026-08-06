<script setup lang="ts">
  import { mergeClasses } from '~/utils';

  type AlertTheme = 'error' | 'warning' | 'success' | 'info';

  const props = defineProps<{
    class?: string;
    theme?: AlertTheme;
  }>();

  const base = 'flex items-start gap-2 rounded-control border px-3 py-2 text-sm';

  const themes: Record<AlertTheme, { class: string; icon: string }> = {
    error: { class: 'border-failed/40 bg-failed/10 text-failed', icon: 'lucide:circle-alert' },
    warning: {
      class: 'border-attn/40 bg-attn-bg text-attn-ink',
      icon: 'lucide:triangle-alert',
    },
    success: { class: 'border-live/40 bg-live-bg text-live-ink', icon: 'lucide:circle-check' },
    info: {
      class: 'border-edge bg-inset text-ink-2',
      icon: 'lucide:info',
    },
  };

  const alert = computed(() => themes[props.theme ?? 'info']);

  const alertClass = computed(() => mergeClasses(base, alert.value.class, props.class));
</script>

<template>
  <div role="alert" :class="alertClass">
    <Icon :name="alert.icon" class="mt-0.5 size-4 shrink-0" />
    <span><slot /></span>
  </div>
</template>
