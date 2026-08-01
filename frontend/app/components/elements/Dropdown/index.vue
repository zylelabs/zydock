<script setup lang="ts">
  type AlignmentX = 'left' | 'right';
  type AlignmentY = 'top' | 'bottom';

  defineProps<{
    alignmentX?: AlignmentX;
    alignmentY?: AlignmentY;
    /** Tailwind CSS classes */
    contentClass?: string;
  }>();

  const dropdownOpened = ref(false);

  const dropdownRef = ref<HTMLElement | null>(null);

  onMounted(() => {
    document.addEventListener('click', handleClickOutside);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside);
  });

  const handleClickOutside = (event: MouseEvent) => {
    if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
      dropdownOpened.value = false;
    }
  };

  const handleOpenDropdown = () => {
    dropdownOpened.value = !dropdownOpened.value;
  };

  const handleCloseDropdown = () => {
    dropdownOpened.value = false;
  };

  defineExpose({ dropdownOpened });
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <div @click="handleOpenDropdown">
      <slot name="button" />
    </div>

    <div
      v-show="dropdownOpened"
      class="z-50 absolute mt-1.5 min-w-32 rounded-lg border border-surface-border bg-surface-overlay p-1 shadow-xl backdrop-blur-sm"
      :class="[
        [undefined, 'left'].includes(alignmentX) && 'right-0',
        alignmentX === 'right' && 'left-0',
        [undefined, 'bottom'].includes(alignmentY) && 'top-full',
        alignmentY === 'top' && 'bottom-full',
        contentClass,
      ]"
      @click="handleCloseDropdown"
    >
      <slot />
    </div>
  </div>
</template>
