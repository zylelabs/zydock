<script setup lang="ts">
  import { get, upperFirst } from 'lodash-es';

  type Header = {
    [key: string]: HeaderContent;
  };

  type TdRow = {
    [key: string]: {
      [key: string]: {
        class?: string;
        lineClass?: string | ((item: Record<string, any>) => string | undefined);
      };
    };
  };

  type HeaderContent = {
    label?: string;
    hideLabel?: boolean;
    sortable?: boolean;
    class?: string | ((item: Record<string, any>) => string | undefined);
    tdClass?: string | ((item: Record<string, any>) => string | undefined);
    thClass?: string | ((item: Record<string, any>) => string | undefined);
    tdRow?: TdRow;
    noWrap?: boolean;
    mapValues?: { [key: string]: string };
    type?:
      | MasksPatternKeys
      | string
      | ((item: Record<string, any>, value: any) => MasksPatternKeys | string);
    fallback?: string;
    rowspan?: number;
    colspan?: number;
    parentKey?: string;
  };

  type Items = { [key: string]: unknown }[];

  type Props = {
    header: Header;
    items: Items;
    tableFixed?: boolean;
    title?: string;
    thClass?:
      string | ((row: unknown, item: unknown, valueFormatted: unknown) => string | undefined);
    tdClass?:
      string | ((row: unknown, item: unknown, valueFormatted: unknown) => string | undefined);
    totalPages?: number;
    page?: number;
    limit?: number;
    loading?: boolean;
    loadingHeader?: boolean;
    fullPage?: boolean;
    stickyHeader?: boolean;
    expandable?: boolean;
    striped?: boolean;
    hover?: boolean;
    hideHeader?: boolean;
    emptyLabel?: string;
    skeletonNumber?: number;
    disableMobileCards?: boolean;
  };

  const emit = defineEmits(['change-page', 'change-order']);
  const props = defineProps<Props>();

  const data = reactive<Props>({
    header: props.header,
    items: props.items || [],
  });

  watchEffect(() => {
    if (props.header) {
      data.header = props.header;
    }
  });

  watchEffect(() => {
    if (props.items) {
      data.items = props.items;
    }
  });

  const currentOrder = useState('asc');
  const expandedRowIndex = ref<number | null>(null);

  const toggleRow = (index: number) => {
    expandedRowIndex.value = expandedRowIndex.value === index ? null : index;
  };

  const onExpandEnter = (el: Element, done: () => void) => {
    const content = el.querySelector<HTMLElement>('.expand-content');
    if (!content) return done();

    content.style.overflow = 'hidden';
    content.style.height = '0';
    content.style.opacity = '0';
    void content.offsetHeight;
    content.style.transition = 'height 0.3s ease, opacity 0.3s ease';
    content.style.height = `${content.scrollHeight}px`;
    content.style.opacity = '1';

    const end = () => {
      content.style.height = 'auto';
      content.style.overflow = '';
      content.removeEventListener('transitionend', end);
      done();
    };
    content.addEventListener('transitionend', end);
  };

  const onExpandLeave = (el: Element, done: () => void) => {
    const content = el.querySelector<HTMLElement>('.expand-content');
    if (!content) return done();

    content.style.overflow = 'hidden';
    content.style.height = `${content.scrollHeight}px`;
    content.style.opacity = '1';
    void content.offsetHeight;
    content.style.transition = 'height 0.3s ease, opacity 0.3s ease';
    content.style.height = '0';
    content.style.opacity = '0';

    const end = () => {
      content.removeEventListener('transitionend', end);
      done();
    };
    content.addEventListener('transitionend', end);
  };

  const itemContent = (
    item: { [key: string]: unknown },
    fieldName: string | number,
    field: HeaderContent,
  ) => {
    let value = get(item, fieldName);

    if (typeof value === 'function') {
      return value(field);
    }

    if (field.mapValues && typeof value === 'string') {
      value = field.mapValues[value] || value;
    }

    if (field.type) {
      const resolvedType = typeof field.type === 'function' ? field.type(item, value) : field.type;

      if (resolvedType === 'float') {
        return formatter.toFixedRound(value as string, 2);
      }

      if (resolvedType === 'stringList') {
        if (Array.isArray(value)) {
          const mapped = value.map(itemValue =>
            field.mapValues && field.mapValues[itemValue] ? field.mapValues[itemValue] : itemValue,
          );

          return mapped.join(', ');
        }

        return value;
      }

      return formatter.mask(resolvedType, value as string);
    }

    return value;
  };

  const handleChangeOrder = (fieldName: string | number) => {
    const newCurrentOrder = currentOrder.value === 'asc' ? 'desc' : 'asc';
    currentOrder.value = newCurrentOrder;

    emit('change-order', { order_by: fieldName, order_dir: currentOrder.value });
  };

  const getTdClassProp = (
    row: unknown,
    item: unknown,
    valueFormatted: unknown,
  ): string | undefined => {
    if (!props.tdClass) return undefined;

    if (typeof props.tdClass === 'function') {
      return props.tdClass(row, item, valueFormatted);
    }

    return props.tdClass;
  };

  const getThClassProp = (fieldName: string | number, field: HeaderContent): string | undefined => {
    if (!props.thClass) return undefined;

    if (typeof props.thClass === 'function') {
      const label = upperFirst(
        field.label ? field.label : fieldName.toString().replaceAll('_', ' '),
      );
      return props.thClass(fieldName, field, label);
    }

    return props.thClass;
  };

  const getFieldThClass = (field: HeaderContent): string | undefined => {
    if (!field.thClass) return undefined;

    if (typeof field.thClass === 'function') {
      return field.thClass({} as Record<string, any>);
    }

    return field.thClass;
  };

  const getFieldClass = (field: HeaderContent, item: Record<string, any>): string | undefined => {
    if (!field.class) return undefined;

    if (typeof field.class === 'function') {
      return field.class(item);
    }

    return field.class;
  };

  const getFieldTdClass = (field: HeaderContent, item: Record<string, any>): string | undefined => {
    if (!field.tdClass) return undefined;

    if (typeof field.tdClass === 'function') {
      return field.tdClass(item);
    }

    return field.tdClass;
  };

  const getTdRowClass = (field: any, item: Record<string, any>): string | undefined => {
    if (!field.tdRow) return undefined;

    const tdRowKeys = Object.keys(field.tdRow);
    const matchingKey = tdRowKeys.find(key => key in item);

    return matchingKey ? field.tdRow[matchingKey]?.[item[matchingKey]]?.class : undefined;
  };

  const getTrRowClass = (field: any, item: Record<string, any>): string | undefined => {
    if (!field.tdRow) return undefined;

    const tdRowKeys = Object.keys(field.tdRow);
    const matchingKey = tdRowKeys.find(key => key in item);

    if (!matchingKey) return undefined;

    const rowConfig = field.tdRow[matchingKey]?.[item[matchingKey]];
    if (!rowConfig) return undefined;

    if (typeof rowConfig.lineClass === 'function') {
      return rowConfig.lineClass(item);
    }

    return rowConfig.lineClass;
  };

  const getRowLineClass = (item: Record<string, any>): string | undefined => {
    for (const fieldName in data.header) {
      const field = data.header[fieldName];
      const trClass = getTrRowClass(field, item);
      if (trClass) return trClass;
    }
    return undefined;
  };

  const maxHeaderRowspan = computed(() => {
    let max = 1;
    for (const fieldName in data.header) {
      const field = data.header[fieldName];
      if (field?.rowspan && field.rowspan > max) {
        max = field.rowspan;
      }
      if (field?.colspan && field.colspan > 1) {
        max = Math.max(max, 2);
      }
    }
    return max;
  });

  const colspanParentMap = computed(() => {
    const map: Record<string, string> = {};
    const keys = Object.keys(data.header);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const field = data.header[key];
      if (field?.colspan && field.colspan > 1) {
        for (let j = 1; j <= field.colspan; j++) {
          const childKey = keys[i + j];
          if (i + j < keys.length && childKey) {
            map[childKey] = key;
          }
        }
      }
    }
    return map;
  });

  const isHeaderCellVisible = (rowIndex: number, fieldName: string | number): boolean => {
    const field = data.header[fieldName];
    const fnStr = String(fieldName);
    const parentKey = colspanParentMap.value[fnStr];

    if (rowIndex === 0) {
      if (parentKey) return false;
      return true;
    }

    if (field?.rowspan && field.rowspan > rowIndex) return false;

    if (parentKey) return true;

    return false;
  };

  const getThRowspan = (rowIndex: number, field: HeaderContent): number | undefined => {
    if (rowIndex > 0) return undefined;
    return field.rowspan && field.rowspan > 1 ? field.rowspan : undefined;
  };

  const getThColspan = (rowIndex: number, field: HeaderContent): number | undefined => {
    if (rowIndex > 0) return undefined;
    return field.colspan && field.colspan > 1 ? field.colspan : undefined;
  };

  const hasVisibleCellsInRow = (rowIndex: number): boolean => {
    for (const fieldName in data.header) {
      if (isHeaderCellVisible(rowIndex, fieldName)) return true;
    }
    return false;
  };

  const getFieldLabel = (field: HeaderContent, fieldName: string | number): string => {
    if (field.hideLabel) return '';
    return upperFirst(field.label ? field.label : fieldName.toString().replaceAll('_', ' '));
  };

  const showPagination = computed(
    () => !!(props.totalPages && props.limit && props.totalPages > 1),
  );
</script>

<template>
  <div
    :class="{
      'z-10 bg-white border border-gray-200 rounded-lg': props.title,
      'mobile-cards': !props.disableMobileCards,
      'no-pagination': !showPagination,
    }"
  >
    <div
      v-if="props.title"
      class="p-4 sm:p-5 font-medium flex items-center text-lg sm:text-xl border-b bg-slate-50 rounded-t-lg"
    >
      {{ props.title }}
    </div>
    <div class="shadow-sm" :class="[!props.fullPage && !props.title && 'border rounded-lg']">
      <div class="overflow-x-auto">
        <table
          class="w-full text-start! divide-y"
          :class="[
            props.tableFixed ? 'table-fixed' : 'table-auto',
            !props.fullPage && 'rounded-t-lg',
          ]"
        >
          <thead
            v-show="!hideHeader"
            class="divide-y"
            :class="[props.fullPage && 'bg-white', props.stickyHeader && 'sticky top-0']"
          >
            <tr v-if="props.loadingHeader">
              <td
                v-for="columns in 10"
                :key="columns"
                class="px-4 py-5 text-start! font-medium text-sm uppercase bg-slate-50 last:rounded-tr-lg first:rounded-tl-lg"
              ></td>
            </tr>
            <template v-else>
              <tr v-for="headerRow in maxHeaderRowspan" :key="'header-row-' + headerRow">
                <template v-for="(field, fieldName) in data.header" :key="fieldName">
                  <th
                    v-if="isHeaderCellVisible(headerRow - 1, fieldName)"
                    class="px-4 py-3 text-start font-medium text-sm uppercase"
                    :class="[
                      !props.fullPage &&
                        !props.title &&
                        'bg-slate-50 last:rounded-tr-lg first:rounded-tl-lg',
                      props.title && 'bg-slate-100/80',
                      getThClassProp(fieldName, field),
                      getFieldThClass(field),
                    ]"
                    :rowspan="getThRowspan(headerRow - 1, field)"
                    :colspan="getThColspan(headerRow - 1, field)"
                  >
                    <slot
                      :name="`header-${fieldName}`"
                      :label="
                        upperFirst(
                          field.label ? field.label : fieldName.toString().replaceAll('_', ' '),
                        )
                      "
                    >
                      <div class="flex items-center whitespace-pre-line text-center!">
                        {{
                          !field.hideLabel
                            ? upperFirst(
                                field.label
                                  ? field.label
                                  : fieldName.toString().replaceAll('_', ' '),
                              )
                            : ''
                        }}

                        <div
                          v-if="field.sortable"
                          class="flex items-center my-auto ml-1.5 cursor-pointer"
                          @click="handleChangeOrder(fieldName)"
                        >
                          <Icon
                            :name="
                              currentOrder === 'asc'
                                ? 'hugeicons:arrow-up-01'
                                : 'hugeicons:arrow-down-01'
                            "
                            size="18"
                          />
                        </div>
                      </div>
                    </slot>
                  </th>
                </template>

                <th
                  v-if="headerRow > 1 && !hasVisibleCellsInRow(headerRow - 1)"
                  class="px-4 py-3 bg-slate-50"
                  style="padding: 0; border: none; line-height: inherit"
                ></th>

                <th
                  v-if="props.expandable && headerRow === 1"
                  class="px-4 py-3 text-start font-medium text-sm uppercase bg-slate-100/80"
                  style="width: 40px"
                  :rowspan="maxHeaderRowspan > 1 ? maxHeaderRowspan : undefined"
                ></th>
              </tr>
            </template>
          </thead>

          <tbody class="divide-y w-1!">
            <template v-if="props.loading">
              <tr
                v-for="n in props.skeletonNumber || props.limit || 10"
                :key="'skeleton-' + n"
                class="animate-pulse"
                :class="[[undefined, true].includes(props.striped) && 'even:bg-slate-50/50']"
              >
                <template v-if="!props.loadingHeader">
                  <td v-for="(_field, fieldName) in data.header" :key="fieldName" class="px-4 py-3">
                    <div class="h-5 w-full bg-gray-200 rounded"></div>
                  </td>
                </template>
                <template v-else>
                  <td v-for="columns in 10" :key="columns" class="px-4 py-3">
                    <div class="h-5 w-full bg-gray-200 rounded"></div>
                  </td>
                </template>
                <td v-if="props.expandable" class="px-4 py-3 w-10">
                  <div class="h-5 w-4 bg-gray-200 rounded"></div>
                </td>
              </tr>
            </template>

            <template v-else-if="data.items.length">
              <template v-for="(item, index) in data.items" :key="index">
                <tr
                  class="text-sm bg-white transition-colors duration-150"
                  :class="[
                    props.expandable && 'cursor-pointer',
                    props.hover && 'hover:bg-slate-50/50',
                    [undefined, true].includes(props.striped) && 'even:bg-slate-50/50',
                    getRowLineClass(item),
                  ]"
                  @click="toggleRow(index)"
                >
                  <template v-for="(field, fieldName) in data.header" :key="fieldName">
                    <td
                      v-if="!field.colspan || field.colspan <= 1"
                      class="px-4 py-3"
                      :data-label="getFieldLabel(field, fieldName)"
                      :class="[
                        getTdClassProp(
                          item,
                          get(item, fieldName),
                          itemContent(item, fieldName, field),
                        ),
                        getFieldTdClass(field, item),
                        field.noWrap && 'whitespace-nowrap',
                        field.type === 'money' && 'whitespace-nowrap',
                        getFieldClass(field, item),
                        getTdRowClass(field, item),
                        index === data.items.length - 1 &&
                          !(props.expandable && expandedRowIndex === index) &&
                          'first:rounded-bl-lg last:rounded-br-lg',
                      ]"
                      :colspan="(item?.options_table_colspan as Numberish) || undefined"
                    >
                      <slot
                        :name="fieldName"
                        :value="get(item, fieldName)"
                        :index="index"
                        :row="item"
                        :value-formatted="itemContent(item, fieldName, field)"
                      >
                        {{
                          field.fallback
                            ? hasValue(get(item, fieldName))
                              ? itemContent(item, fieldName, field)
                              : field.fallback
                            : itemContent(item, fieldName, field)
                        }}
                      </slot>
                    </td>
                  </template>

                  <td
                    v-if="props.expandable"
                    class="px-4 py-3 w-10 text-center"
                    :class="[
                      index === data.items.length - 1 &&
                        !(props.expandable && expandedRowIndex === index) &&
                        'last:rounded-br-lg',
                    ]"
                  >
                    <Tooltip>
                      <button
                        class="text-gray-600 hover:text-black focus:outline-none cursor-pointer"
                        type="button"
                      >
                        <Icon
                          name="lucide:chevron-right"
                          size="24"
                          class="transition-transform duration-300 ease-in-out"
                          :class="expandedRowIndex === index && 'rotate-90'"
                        />
                      </button>

                      <template #popper>
                        <div class="text-sm">Click to expand</div>
                      </template>
                    </Tooltip>
                  </td>
                </tr>

                <Transition :css="false" @enter="onExpandEnter" @leave="onExpandLeave">
                  <tr v-if="props.expandable && expandedRowIndex === index">
                    <td
                      :colspan="Object.keys(data.header).length + 1"
                      class="p-0 bg-slate-50/50"
                      :class="[index === data.items.length - 1 && 'rounded-b-lg']"
                    >
                      <div class="expand-content">
                        <div class="px-4 py-3">
                          <slot name="expand" :row="item" :index="index">
                            <div class="text-sm text-gray-600">
                              Expanded content of row {{ index + 1 }}
                            </div>
                          </slot>
                        </div>
                      </div>
                    </td>
                  </tr>
                </Transition>
              </template>
            </template>
            <tr v-else>
              <td
                :colspan="Object.keys(data.header).length + (props.expandable ? 1 : 0)"
                class="py-4 text-center text-gray-500 text-sm italic"
              >
                {{ props.emptyLabel || '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Pagination
        v-if="showPagination"
        :total-pages="props.totalPages"
        :limit="props.limit"
        :page="props.page"
        @change-page="e => emit('change-page', e)"
      />
    </div>
  </div>
</template>

<style scoped>
  @media (max-width: 767px) {
    .mobile-cards :deep(.overflow-x-auto) {
      overflow-x: visible;
    }

    .mobile-cards :deep(table),
    .mobile-cards :deep(tbody),
    .mobile-cards :deep(tr),
    .mobile-cards :deep(td) {
      display: block;
      width: 100%;
      min-width: 100%;
    }

    .mobile-cards :deep(thead) {
      display: none;
    }

    .mobile-cards :deep(tbody > tr) {
      background: white;
    }

    .mobile-cards :deep(tbody > tr + tr) {
      border-top: 1px solid rgb(229 231 235);
    }
    .mobile-cards.no-pagination :deep(tbody > tr:last-child) {
      border-bottom-left-radius: 0.5rem;
      border-bottom-right-radius: 0.5rem;
      overflow: hidden;
    }

    .mobile-cards :deep(tbody > tr:first-child) {
      border-top-left-radius: 0.5rem;
      border-top-right-radius: 0.5rem;
      overflow: hidden;
    }

    .mobile-cards :deep(tbody > tr > td) {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.125rem;
      border: none;
      border-bottom: 1px solid rgb(243 244 246);
      text-align: left !important;
      white-space: normal !important;
    }

    .mobile-cards :deep(tbody > tr > td:last-child) {
      border-bottom: none;
    }

    .mobile-cards :deep(tbody > tr > td[data-label])::before {
      content: attr(data-label);
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
      color: rgb(107 114 128);
    }

    .mobile-cards :deep(tbody > tr > td[data-label=''])::before {
      display: none;
    }
  }
</style>
