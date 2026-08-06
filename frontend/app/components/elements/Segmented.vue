<script setup lang="ts">
  type Option = { label: string; value: string };

  withDefaults(defineProps<{ options: Option[]; size?: 'md' | 'sm' }>(), { size: 'md' });

  const model = defineModel<string>();
</script>

<template>
  <div class="inline-flex rounded-[10px] bg-hairline p-0.75">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="cursor-pointer rounded-[7px] font-medium transition-colors"
      :class="[
        size === 'sm' ? 'px-2.75 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]',
        model === option.value ? 'bg-card text-ink shadow-lifted' : 'text-ink-2 hover:text-ink',
      ]"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
