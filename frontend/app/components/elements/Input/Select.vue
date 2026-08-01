<script setup lang="ts">
  import { debounce } from 'lodash-es';
  import { computed, onBeforeUnmount, ref, watch } from 'vue';
  type Option = { label: string; value: string; count?: number; selected?: boolean };

  const props = defineProps<{
    label?: string;
    options?: Option[];
    disabled?: boolean;
    multiple?: boolean;
    searchable?: boolean;
    creatable?: boolean;
    remoteSearch?: boolean;
    placeholder?: string;
    inputMask?: string | MasksPatternKeys;
  }>();

  const emit = defineEmits<{ search: [query: string] }>();

  const model = defineModel<string | string[]>({ default: () => '' });

  const searchQuery = ref('');
  const dropdownRef = ref<{ dropdownOpened: boolean } | null>(null);
  const suppressSearchEmit = ref(false);

  const emitSearch = debounce((query: string) => emit('search', query), 300);

  onBeforeUnmount(() => emitSearch.cancel());

  watch(searchQuery, value => {
    if (!props.searchable) return;

    if (suppressSearchEmit.value) {
      suppressSearchEmit.value = false;
      return;
    }

    emitSearch(value);
  });

  const isMultiple = computed(() => props.multiple ?? Array.isArray(model.value));
  const normalizedValues = computed<string[]>(() =>
    Array.isArray(model.value) ? model.value : model.value ? [model.value] : [],
  );
  const selectedLabels = computed(() => {
    const map = new Map(props.options?.map(o => [o.value, o.label]));
    return normalizedValues.value.map(v => map.get(v) ?? v);
  });
  const isSelected = (value: string) => normalizedValues.value.includes(value);

  const searchPlaceholder = computed(() => {
    if (isMultiple.value)
      return selectedLabels.value.length
        ? selectedLabels.value.join(', ')
        : (props.placeholder ?? 'Select an option');
    return (
      props.options?.find(o => o.value === model.value)?.label ??
      props.placeholder ??
      'Select an option'
    );
  });

  const filteredOptions = computed(() => {
    const optionValues = new Set((props.options ?? []).map(o => o.value));

    const createdOptions = normalizedValues.value
      .filter(v => !optionValues.has(v))
      .map(v => ({ label: v, value: v }));

    const allOptions = [...createdOptions, ...(props.options ?? [])];

    if (!props.searchable || props.remoteSearch || !searchQuery.value) return allOptions;

    const query = searchQuery.value.toLowerCase();

    return allOptions.filter(o => o.label.toLowerCase().includes(query));
  });

  const canCreate = computed(() => {
    if (!props.creatable || !searchQuery.value) return false;

    const query = searchQuery.value.toLowerCase();

    return (
      !(props.options ?? []).some(
        o => o.label.toLowerCase() === query || o.value.toLowerCase() === query,
      ) && !normalizedValues.value.some(v => v.toLowerCase() === query)
    );
  });

  const handleCreate = () => {
    const val = searchQuery.value.trim();

    if (!val) return;

    if (isMultiple.value) {
      const arr = [...normalizedValues.value];
      if (!arr.includes(val)) arr.push(val);
      model.value = arr;
      suppressSearchEmit.value = true;
      searchQuery.value = '';
    } else {
      model.value = val;
      suppressSearchEmit.value = true;
      searchQuery.value = val;
      if (dropdownRef.value) dropdownRef.value.dropdownOpened = false;
    }
  };

  const openDropdown = () => {
    if (dropdownRef.value) dropdownRef.value.dropdownOpened = true;
  };

  watch(
    () => dropdownRef.value?.dropdownOpened,
    isOpen => {
      if (!isOpen && canCreate.value) handleCreate();
    },
  );

  const handleClick = (value: string) => {
    if (isMultiple.value) {
      const arr = [...normalizedValues.value];
      const idx = arr.indexOf(value);
      if (idx > -1) arr.splice(idx, 1);
      else arr.push(value);
      model.value = arr;
      suppressSearchEmit.value = true;
      searchQuery.value = '';
    } else {
      model.value = value;
      const label = props.options?.find(o => o.value === value)?.label ?? value;
      suppressSearchEmit.value = true;
      searchQuery.value = label;
      if (dropdownRef.value) dropdownRef.value.dropdownOpened = false;
    }
  };
</script>

<template>
  <Dropdown
    ref="dropdownRef"
    alignment-x="right"
    alignment-y="bottom"
    content-class="min-w-full w-max max-h-60 overflow-y-auto"
    class="w-full"
  >
    <template #button>
      <div class="flex flex-col gap-1 cursor-default select-none">
        <label
          v-if="label"
          class="flex gap-0.5 text-xs font-semibold tracking-widest text-content-muted uppercase mb-1"
          :class="{ 'text-content-dim': disabled }"
        >
          {{ label }}
        </label>

        <div
          v-if="searchable || creatable"
          class="flex w-full border border-field-border rounded-lg shadow-sm bg-surface-sunken transition-shadow duration-200"
          :class="{ 'cursor-not-allowed opacity-50': disabled }"
          :aria-disabled="disabled"
          @click.stop
        >
          <Input
            v-model="searchQuery"
            class="flex-1"
            type="text"
            input-class="flex-1 bg-transparent outline-none text-sm disabled:cursor-not-allowed border-none shadow-none"
            :placeholder="searchPlaceholder"
            :disabled="disabled"
            :mask="inputMask"
            @focus="openDropdown"
            @keydown.enter.prevent="handleCreate"
          />
          <Icon
            name="mdi:chevron-down"
            size="20"
            class="my-auto ml-auto mr-2 shrink-0 text-content-muted"
            @click="openDropdown"
          />
        </div>

        <div
          v-else
          class="flex w-full items-center border border-field-border rounded-lg shadow-sm px-2 py-2 bg-surface-sunken text-content-strong focus:outline-none focus:border-primary-400 transition-shadow duration-200 disabled:cursor-not-allowed disabled:text-content-dim disabled:border-surface-line"
          :class="{ 'cursor-not-allowed opacity-50': disabled }"
          :aria-disabled="disabled"
        >
          {{ searchPlaceholder }}
          <div class="flex ml-auto my-auto">
            <Icon name="mdi:chevron-down" size="20" class="my-auto text-content-muted" />
          </div>
        </div>
      </div>
    </template>

    <ul class="flex flex-col w-full gap-0.5">
      <li
        v-if="canCreate"
        class="px-2 py-1.5 rounded-md whitespace-nowrap hover:bg-surface-hover w-full cursor-pointer"
        @click.stop="handleCreate"
      >
        <div class="flex items-center gap-2 text-primary-400">
          <Icon name="mdi:plus-circle-outline" size="18" />
          <span>Add "{{ searchQuery }}"</span>
        </div>
      </li>
      <li
        v-for="option in filteredOptions"
        :key="option.value"
        class="px-2 py-1.5 rounded-md whitespace-nowrap hover:bg-surface-hover w-full text-content"
        :class="isSelected(option.value) && 'bg-surface-hover'"
        @click.stop="handleClick(option.value)"
      >
        <div class="flex items-center gap-2">
          <Icon
            v-if="isMultiple"
            :name="isSelected(option.value) ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'"
            size="18"
          />
          <span>{{ option.label }}</span>
        </div>
      </li>
    </ul>
  </Dropdown>
</template>
