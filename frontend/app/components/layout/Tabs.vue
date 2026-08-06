<script setup lang="ts">
  type Tab = { id: string; label: string };

  defineProps<{ tabs: Tab[] }>();
  const emit = defineEmits<{ changeTab: [id: string] }>();

  const active = defineModel<string>();

  const select = (tab: Tab) => {
    active.value = tab.id;
    emit('changeTab', tab.id);
  };
</script>

<template>
  <div class="flex items-center gap-1.5 border-b border-edge">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="cursor-pointer px-2.75 pt-2 pb-3 text-[13.5px] font-medium text-ink-2 transition-colors"
      :class="tab.id === active && 'text-ink shadow-[inset_0_-2px_0_0_var(--color-ink)]'"
      @click="select(tab)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
