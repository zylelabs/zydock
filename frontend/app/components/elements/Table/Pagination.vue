<script setup lang="ts">
  type Props = {
    totalPages?: number;
    limit?: number;
    page?: number;
  };

  const props = defineProps<Props>();

  const emit = defineEmits<{ changePage: [page: number] }>();

  const currentPage = ref<number>(props.page || 1);

  const getPages = computed(() => {
    const total = props.totalPages || 1;
    const current = currentPage.value;
    const pages: (number | string)[] = [];

    if (total <= 8) {
      for (let i = 1; i <= total; i++) pages.push(i);
      return pages;
    }

    if (current <= 5) {
      pages.push(1, 2, 3, 4, 5, 6, '...', total);
    } else if (current >= total - 4) {
      pages.push(1, '...', total - 5, total - 4, total - 3, total - 2, total - 1, total);
    } else {
      pages.push(
        1,
        '...',
        current - 2,
        current - 1,
        current,
        current + 1,
        current + 2,
        '...',
        total,
      );
    }

    return pages;
  });

  const handleClick = (page: number | string) => {
    if (typeof page === 'number' && page !== currentPage.value) {
      emit('changePage', page);
    }
  };

  watch(
    () => props.page,
    newVal => {
      currentPage.value = Number(newVal) || 1;
    },
  );
</script>

<template>
  <div class="flex items-center justify-between gap-3 border-t border-hairline px-4.5 py-3">
    <div class="text-caption text-ink-2">Per page: {{ props.limit }}</div>

    <div class="flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        class="flex size-7 items-center justify-center rounded-control border border-edge text-ink-2 hover:bg-inset disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="currentPage <= 1"
        @click="handleClick(currentPage - 1)"
      >
        <Icon name="hugeicons:arrow-left-01" size="16" />
      </button>

      <button
        v-for="(pageItem, index) in getPages"
        :key="index"
        type="button"
        class="flex size-7 items-center justify-center rounded-control text-[13px] select-none"
        :class="
          pageItem === '...'
            ? 'cursor-default text-ink-3'
            : pageItem === currentPage
              ? 'bg-ink font-medium text-page'
              : 'border border-edge text-ink-2 hover:bg-inset'
        "
        :disabled="pageItem === '...'"
        @click="handleClick(pageItem)"
      >
        {{ pageItem }}
      </button>

      <button
        type="button"
        class="flex size-7 items-center justify-center rounded-control border border-edge text-ink-2 hover:bg-inset disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="currentPage >= getPages.length"
        @click="handleClick(currentPage + 1)"
      >
        <Icon name="hugeicons:arrow-right-01" size="16" />
      </button>
    </div>
  </div>
</template>
