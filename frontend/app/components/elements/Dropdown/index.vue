<script setup lang="ts">
  type AlignmentX = 'left' | 'right';
  type AlignmentY = 'top' | 'bottom';

  const props = defineProps<{
    alignmentX?: AlignmentX;
    alignmentY?: AlignmentY;
    /** Locks the panel to the button's width instead of only using it as a minimum. */
    matchWidth?: boolean;
    /** Tailwind CSS classes */
    contentClass?: string;
  }>();

  const dropdownOpened = ref(false);
  const mounted = ref(false);

  const dropdownRef = ref<HTMLElement | null>(null);
  const panelRef = ref<HTMLElement | null>(null);

  /**
   * The panel is teleported to `body` and placed from the button's viewport rect: as a child it was
   * clipped by the `overflow-hidden` of every card it opens inside.
   */
  const panelStyle = ref<Record<string, string>>({});

  const GAP = 6;

  const updatePosition = () => {
    const button = dropdownRef.value;

    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();

    const style: Record<string, string> = {
      position: 'fixed',
      minWidth: `${rect.width}px`,
    };

    if (props.matchWidth) {
      style.width = `${rect.width}px`;
      style.maxWidth = `${rect.width}px`;
    }

    if (props.alignmentX === 'right') {
      style.left = `${rect.left}px`;
    } else {
      style.right = `${window.innerWidth - rect.right}px`;
    }

    if (props.alignmentY === 'top') {
      style.bottom = `${window.innerHeight - rect.top + GAP}px`;
    } else {
      style.top = `${rect.bottom + GAP}px`;
    }

    panelStyle.value = style;
  };

  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as Node;

    if (dropdownRef.value?.contains(target) || panelRef.value?.contains(target)) {
      return;
    }

    dropdownOpened.value = false;
  };

  onMounted(() => {
    mounted.value = true;
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
  });

  watch(dropdownOpened, async opened => {
    if (!opened) {
      return;
    }

    await nextTick();
    updatePosition();
  });

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

    <Teleport to="body" :disabled="!mounted">
      <div
        v-show="dropdownOpened"
        ref="panelRef"
        class="z-50 min-w-32 rounded-panel border border-edge bg-card p-1 shadow-lifted"
        :style="panelStyle"
        :class="contentClass"
        @click="handleCloseDropdown"
      >
        <slot />
      </div>
    </Teleport>
  </div>
</template>
