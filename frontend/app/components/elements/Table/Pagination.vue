<script setup lang="ts">
  type Props = {
    totalPages?: number;
    limit?: number;
    page?: number;
  };

  const props = defineProps<Props>();

  const emit = defineEmits(['change-page']);

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
      emit('change-page', { page: Number(page) || 1 });
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
  <div
    class="flex flex-col gap-3 justify-between items-center w-full px-4 py-3 bg-slate-50 border-t rounded-b-lg text-sm sm:flex-row sm:text-base"
  >
    <div class="whitespace-nowrap">Per page: {{ props.limit }}</div>

    <div class="flex flex-wrap items-center justify-center gap-2">
      <div
        class="flex items-center justify-center border p-1 rounded shadow w-7! h-7!"
        :class="Number(currentPage) === 1 ? 'cursor-default opacity-50' : 'cursor-pointer'"
        @click="
          () => {
            if (currentPage >= 2) {
              handleClick(currentPage - 1);
            }
          }
        "
      >
        <Icon name="hugeicons:arrow-left-01" size="18" />
      </div>

      <div
        v-for="(pageItem, index) in getPages"
        :key="index"
        class="flex items-center justify-center rounded select-none"
        :class="[
          pageItem === '...'
            ? 'font-medium text-gray-800'
            : 'p-1 border w-7! h-7! cursor-pointer shadow',
          pageItem === currentPage && 'font-medium bg-primary text-white border-transparent',
          getPages.length === 1 && 'opacity-50 cursor-default!',
        ]"
        @click="handleClick(pageItem)"
      >
        {{ pageItem }}
      </div>

      <div
        class="flex items-center justify-center border p-1 rounded shadow w-7! h-7!"
        :class="
          Number(currentPage) === getPages.length ? 'cursor-default opacity-50' : 'cursor-pointer'
        "
        @click="
          () => {
            if (currentPage <= getPages.length - 1) {
              handleClick(currentPage + 1);
            }
          }
        "
      >
        <Icon name="hugeicons:arrow-right-01" size="18" />
      </div>
    </div>
  </div>
</template>
