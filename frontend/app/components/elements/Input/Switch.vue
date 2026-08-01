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
  <label class="inline-flex items-center cursor-pointer">
    <input
      :id="id"
      v-model="model"
      :name="name ? name : id"
      type="checkbox"
      :checked="checked"
      value=""
      class="sr-only peer"
    />
    <div
      class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:inset-s-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:w-5 after:h-5 after:transition-all peer-checked:bg-linear-to-l from-primary to-primary-700"
    ></div>
    <span class="pl-2 select-none">{{ label }}</span>
  </label>
</template>
