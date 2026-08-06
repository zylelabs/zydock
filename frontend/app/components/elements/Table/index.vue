<script setup lang="ts">
  import { get } from 'lodash-es';

  type Column = {
    key: string;
    label?: string;
    class?: string;
  };

  type Row = Record<string, unknown>;

  const props = defineProps<{
    columns: Column[];
    items: Row[];
    gridClass?: string;
    rowKey?: string | ((item: Row, index: number) => string | number);
    clickable?: boolean;
    loading?: boolean;
    skeletonRows?: number;
    emptyLabel?: string;
    page?: number;
    totalPages?: number;
    limit?: number;
  }>();

  const emit = defineEmits<{ rowClick: [item: Row, index: number]; changePage: [page: number] }>();

  const gridTemplateStyle = computed(() =>
    props.gridClass
      ? undefined
      : { gridTemplateColumns: `repeat(${props.columns.length}, minmax(0, 1fr))` },
  );

  const getRowKey = (item: Row, index: number) => {
    if (typeof props.rowKey === 'function') {
      return props.rowKey(item, index);
    }

    if (typeof props.rowKey === 'string') {
      return get(item, props.rowKey) as string;
    }

    return index;
  };

  const showPagination = computed(
    () => !!(props.totalPages && props.limit && props.totalPages > 1),
  );
</script>

<template>
  <div class="overflow-hidden rounded-card border border-edge bg-card shadow-raised">
    <template v-if="loading">
      <div
        v-for="n in skeletonRows || limit || 6"
        :key="`skeleton-${n}`"
        class="grid items-center gap-4.5 border-t border-hairline px-4.5 py-3.75 first:border-t-0"
        :class="gridClass"
        :style="gridTemplateStyle"
      >
        <Skeleton v-for="column in columns" :key="column.key" class="h-4 w-full" />
      </div>
    </template>

    <template v-else-if="items.length">
      <component
        :is="clickable ? 'button' : 'div'"
        v-for="(item, index) in items"
        :key="getRowKey(item, index)"
        type="button"
        class="grid w-full items-center gap-4.5 border-t border-hairline px-4.5 py-3.75 text-left first:border-t-0"
        :class="[gridClass, clickable && 'cursor-pointer hover:bg-inset']"
        :style="gridTemplateStyle"
        @click="clickable && emit('rowClick', item, index)"
      >
        <div v-for="column in columns" :key="column.key" :class="column.class">
          <slot :name="column.key" :value="get(item, column.key)" :item="item" :index="index">
            {{ get(item, column.key) }}
          </slot>
        </div>
      </component>
    </template>

    <div v-else class="px-4.5 py-8 text-center text-caption text-ink-3">
      <slot name="empty">{{ emptyLabel || 'Nothing here yet.' }}</slot>
    </div>

    <Pagination
      v-if="showPagination"
      :total-pages="totalPages"
      :limit="limit"
      :page="page"
      @change-page="page => emit('changePage', page)"
    />
  </div>
</template>
