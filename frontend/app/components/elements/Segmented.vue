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
      class="flex-1 basis-0 cursor-pointer rounded-[7px] text-center font-medium whitespace-nowrap transition-colors"
      :class="[
        size === 'sm' ? 'px-2.75 py-1 text-caption' : 'px-3.5 py-1.5 text-caption',
        model === option.value ? 'bg-card text-ink shadow-lifted' : 'text-ink-2 hover:text-ink',
      ]"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
