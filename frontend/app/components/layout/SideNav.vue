<script setup lang="ts">
  type SideNavItem = { id: string; label: string; icon?: string; danger?: boolean };

  defineProps<{ items: SideNavItem[] }>();
  const emit = defineEmits<{ changeItem: [id: string] }>();

  const active = defineModel<string>();

  const select = (item: SideNavItem) => {
    active.value = item.id;
    emit('changeItem', item.id);
  };
</script>

<template>
  <nav class="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="flex shrink-0 cursor-pointer items-center gap-2 rounded-control px-2.75 py-2 text-left text-[13.5px] font-medium transition-colors hover:bg-inset lg:shrink"
      :class="[
        item.danger ? 'text-failed' : 'text-ink-2 hover:text-ink',
        item.id === active && 'bg-inset',
        item.id === active && !item.danger && 'text-ink',
      ]"
      @click="select(item)"
    >
      <Icon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
      <span class="truncate">{{ item.label }}</span>
    </button>
  </nav>
</template>
