<script setup lang="ts">
  defineProps<{
    id?: string;
    name?: string;
    label?: string;
    checked?: boolean | 'true' | 'false';
  }>();

  const model = defineModel();
</script>

<template>
  <label class="inline-flex cursor-pointer items-center gap-2.5">
    <input
      :id="id"
      v-model="model"
      :name="name ? name : id"
      type="checkbox"
      :checked="checked"
      value=""
      class="peer sr-only"
    />
    <div
      class="relative h-6 w-10 shrink-0 rounded-full bg-hairline transition-colors after:absolute after:top-0.75 after:left-0.75 after:h-4.5 after:w-4.5 after:rounded-full after:bg-card after:shadow-lifted after:transition-transform after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
    ></div>
    <span v-if="label" class="text-[13.5px] text-ink select-none">{{ label }}</span>
  </label>
</template>
