<script setup lang="ts">
  defineProps<{
    id?: string;
    name?: string;
    label?: string;
    value?: unknown;
    disabled?: boolean;
  }>();

  const model = defineModel();
</script>

<template>
  <label
    class="inline-flex items-center gap-2.5"
    :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
  >
    <input
      :id="id"
      v-model="model"
      :name="name"
      type="radio"
      :value="value"
      :disabled="disabled"
      class="peer sr-only"
    />
    <span
      class="relative flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 border-edge-strong transition-colors after:size-1.5 after:scale-0 after:rounded-full after:bg-card after:transition-transform after:content-[''] peer-checked:border-accent peer-checked:bg-accent peer-checked:after:scale-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:border-edge peer-disabled:bg-transparent peer-disabled:peer-checked:border-edge peer-disabled:peer-checked:bg-hairline"
    ></span>
    <span
      v-if="label"
      class="text-[13.5px] text-ink select-none"
      :class="disabled && 'text-ink-3'"
      >{{ label }}</span
    >
  </label>
</template>
