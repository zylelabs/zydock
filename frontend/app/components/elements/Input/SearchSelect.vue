<script setup lang="ts">
  type Option = { label: string; value: string; description?: string };

  const props = defineProps<{
    label?: string;
    options?: Option[];
    disabled?: boolean;
    placeholder?: string;
  }>();

  const model = defineModel<string>({ default: () => '' });

  const search = ref('');
  const dropdownOpen = ref(false);
  const dropdownRef = ref<HTMLElement | null>(null);

  const filteredOptions = computed(() => {
    if (!search.value) return props.options ?? [];
    const query = search.value.toLowerCase();
    return (props.options ?? []).filter(
      opt =>
        opt.label.toLowerCase().includes(query) || opt.description?.toLowerCase().includes(query),
    );
  });

  const selectedLabel = computed(() => {
    const opt = props.options?.find(o => o.value === model.value);
    return opt ? opt.label : '';
  });

  const handleSelect = (option: Option) => {
    model.value = option.value;
    search.value = '';
    dropdownOpen.value = false;
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
      dropdownOpen.value = false;
    }
  };

  onMounted(() => {
    document.addEventListener('click', handleClickOutside);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside);
  });
</script>

<template>
  <div ref="dropdownRef" class="relative w-full">
    <div class="flex flex-col gap-1">
      <label v-if="label" :class="{ 'text-gray-600': disabled }">{{ label }}</label>

      <div
        class="flex w-full border rounded-lg shadow-sm px-2 py-2 cursor-pointer items-center focus-within:border-gray-400 transition-shadow duration-200"
        :class="{ 'cursor-not-allowed opacity-50': disabled }"
        @click="!disabled && (dropdownOpen = !dropdownOpen)"
      >
        <input
          v-model="search"
          type="text"
          class="flex-1 outline-none bg-transparent placeholder-gray-400"
          :placeholder="selectedLabel || placeholder || 'Select an option'"
          :disabled="disabled"
          @focus="dropdownOpen = true"
          @click.stop
        />
        <Icon name="mdi:chevron-down" size="20" class="ml-auto text-gray-500" />
      </div>
    </div>

    <ul
      v-show="dropdownOpen"
      class="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto border rounded-lg bg-white shadow-md py-0.5"
    >
      <li
        v-for="option in filteredOptions"
        :key="option.value"
        class="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded-md"
        :class="{ 'bg-gray-100': model === option.value }"
        @click="handleSelect(option)"
      >
        <span class="font-medium">{{ option.label }}</span>
        <span v-if="option.description" class="text-gray-400 text-sm ml-2">
          {{ option.description }}
        </span>
      </li>
      <li v-if="filteredOptions.length === 0" class="px-3 py-2 text-gray-400 text-sm">
        No data found
      </li>
    </ul>
  </div>
</template>
