<script setup lang="ts">
  import { debounce } from 'lodash-es';
  import { computed, onBeforeUnmount, ref, watch } from 'vue';
  type Option = {
    label: string;
    value: string;
    count?: number;
    selected?: boolean;
    hint?: string;
  };

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
    labelWidth?: string;
    /** Drops the field's own divider, like `Input`'s `bare`. */
    bare?: boolean;
    /** Draws the field as a filled box to the right of the label, like `Input`'s `boxed`. */
    boxed?: boolean;
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

    const createdOptions: Option[] = normalizedValues.value
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
    match-width
    content-class="max-h-60 overflow-y-auto"
    class="w-full"
  >
    <template #button>
      <div
        class="flex cursor-default items-center in-data-rows:px-4.25 select-none"
        :class="[boxed ? 'gap-1.75 py-1.5' : 'gap-3.5 py-3', !bare && 'border-b border-hairline']"
      >
        <label
          v-if="label"
          class="shrink-0 text-caption text-ink-2"
          :class="[labelWidth || 'w-33', { 'text-ink-3': disabled }]"
        >
          {{ label }}
        </label>

        <div
          v-if="searchable || creatable"
          class="flex min-w-0 flex-1 items-center"
          :class="[
            { 'cursor-not-allowed opacity-50': disabled },
            boxed && 'rounded-control border border-edge bg-inset px-2.5',
          ]"
          :aria-disabled="disabled"
          @click.stop
        >
          <Input
            v-model="searchQuery"
            class="flex-1"
            type="text"
            input-class="flex-1 bg-transparent outline-none text-body disabled:cursor-not-allowed"
            :placeholder="searchPlaceholder"
            :disabled="disabled"
            :mask="inputMask"
            :bare="boxed"
            :compact="boxed"
            @focus="openDropdown"
            @keydown.enter.prevent="handleCreate"
          />
          <Icon
            name="mdi:chevron-down"
            size="18"
            class="ml-2 shrink-0 text-ink-2"
            @click="openDropdown"
          />
        </div>

        <div
          v-else
          class="flex min-w-0 flex-1 items-center font-mono text-ink"
          :class="[
            { 'cursor-not-allowed text-ink-3 opacity-50': disabled },
            boxed
              ? 'rounded-control border border-edge bg-inset px-2.5 py-1.5 text-caption'
              : 'text-body',
          ]"
          :aria-disabled="disabled"
        >
          {{ searchPlaceholder }}
          <Icon name="mdi:chevron-down" size="18" class="my-auto ml-auto text-ink-2" />
        </div>
      </div>
    </template>

    <ul class="flex w-full flex-col gap-0.5">
      <li
        v-if="canCreate"
        class="w-full cursor-pointer rounded-control px-2 py-1.5 whitespace-nowrap hover:bg-inset"
        @click.stop="handleCreate"
      >
        <div class="flex items-center gap-2 text-accent">
          <Icon name="mdi:plus-circle-outline" size="18" class="shrink-0" />
          <span class="truncate">Add "{{ searchQuery }}"</span>
        </div>
      </li>
      <li
        v-for="option in filteredOptions"
        :key="option.value"
        class="w-full rounded-control px-2 py-1.5 whitespace-nowrap text-ink hover:bg-inset"
        :class="isSelected(option.value) && 'bg-inset'"
        @click.stop="handleClick(option.value)"
      >
        <div class="flex items-center gap-2">
          <Icon
            v-if="isMultiple"
            :name="isSelected(option.value) ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'"
            size="18"
            class="shrink-0"
          />
          <span class="truncate" :title="option.label">{{ option.label }}</span>
          <span v-if="option.hint" class="ml-auto shrink-0 text-caption text-ink-3">
            {{ option.hint }}
          </span>
        </div>
      </li>
    </ul>
  </Dropdown>
</template>
