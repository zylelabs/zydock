<script setup lang="ts">
  import { useTemplates, type Template } from '~/composables/services/useTemplates';

  defineProps<{
    selectedTemplateId: string;
    composeMode: boolean;
  }>();

  const emit = defineEmits<{
    'select-template': [template: Template];
    'select-compose': [];
  }>();

  const { list: listTemplates, icon: getTemplateIcon } = useTemplates();

  const { data, status, error } = useLazyAsyncData('templates-catalog', () => listTemplates(), {
    server: false,
    default: () => ({ items: [] as Template[], total: 0, page: 1, size: 0, pages: 0 }),
  });

  const templates = computed(
    () => data.value?.items.filter(template => !template.deprecated) ?? [],
  );

  const iconUrls = reactive<Record<string, string>>({});

  watch(
    templates,
    list => {
      for (const template of list) {
        if (!template.icon || iconUrls[template.id]) {
          continue;
        }

        getTemplateIcon(template.id)
          .then(blob => {
            iconUrls[template.id] = URL.createObjectURL(blob);
          })
          .catch(() => {});
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    for (const url of Object.values(iconUrls)) {
      URL.revokeObjectURL(url);
    }
  });

  const categories = computed(() => {
    const unique = [...new Set(templates.value.map(template => template.category))];

    return [{ value: '', label: 'All' }, ...unique.map(value => ({ value, label: value }))];
  });

  const search = ref('');
  const activeCategory = ref('');

  const visibleTemplates = computed(() =>
    templates.value.filter(template => {
      if (activeCategory.value && template.category !== activeCategory.value) {
        return false;
      }

      if (!search.value.trim()) {
        return true;
      }

      const needle = search.value.trim().toLowerCase();

      return (
        template.name.toLowerCase().includes(needle) ||
        template.tagline.toLowerCase().includes(needle) ||
        template.tags.some(tag => tag.toLowerCase().includes(needle))
      );
    }),
  );

  const countLabel = computed(
    () => `${visibleTemplates.value.length} of ${templates.value.length} templates`,
  );
</script>

<template>
  <Card rows>
    <div
      class="flex items-center justify-between gap-3 border-t border-hairline px-4.25 py-3.25 first:border-t-0"
    >
      <input
        v-model="search"
        placeholder="Search the marketplace"
        class="min-w-0 flex-1 bg-transparent text-caption text-ink outline-none placeholder:text-ink-3"
      />
      <span class="shrink-0 text-caption text-ink-3">{{ countLabel }}</span>
    </div>

    <div class="flex flex-wrap gap-1.5 border-t border-hairline px-4.25 py-2.75">
      <button
        v-for="category in categories"
        :key="category.value"
        type="button"
        class="cursor-pointer rounded-full border px-2.75 py-1 text-caption transition-colors"
        :class="
          activeCategory === category.value
            ? 'border-accent bg-accent-soft/15 text-accent'
            : 'border-edge text-ink-2 hover:bg-inset'
        "
        @click="activeCategory = category.value"
      >
        {{ category.label }}
      </button>
    </div>

    <div class="max-h-125 overflow-y-auto border-t border-hairline p-3">
      <div v-if="status === 'pending'" class="grid grid-cols-2 gap-3">
        <SkeletonCard v-for="index in 4" :key="index" :rows="2" />
      </div>

      <Alert v-else-if="error" theme="error">Failed to load the marketplace catalog.</Alert>

      <p v-else-if="!visibleTemplates.length" class="px-2 py-8 text-center text-caption text-ink-2">
        No templates match your search.
      </p>

      <div v-else class="grid grid-cols-2 gap-3">
        <button
          v-for="template in visibleTemplates"
          :key="template.id"
          type="button"
          class="rounded-card border-[1.5px] p-3.5 text-left transition-colors"
          :class="
            !composeMode && selectedTemplateId === template.id
              ? 'border-accent'
              : 'border-edge hover:border-edge-strong'
          "
          @click="emit('select-template', template)"
        >
          <div class="flex items-center gap-2.5">
            <div
              class="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-control bg-inset text-ink-2"
            >
              <img
                v-if="iconUrls[template.id]"
                :src="iconUrls[template.id]"
                alt=""
                class="size-full object-contain"
              />
              <Icon v-else name="lucide:box" size="14" />
            </div>
            <div class="min-w-0 flex-1 truncate text-body font-semibold text-ink">
              {{ template.name }}
            </div>
          </div>
          <p class="mt-2 line-clamp-2 text-caption text-ink-2">{{ template.tagline }}</p>
          <div v-if="template.category" class="mt-2.5">
            <Tag>{{ template.category }}</Tag>
          </div>
        </button>

        <button
          type="button"
          class="rounded-card border-[1.5px] border-dashed p-3.5 text-left transition-colors"
          :class="composeMode ? 'border-accent' : 'border-edge hover:border-edge-strong'"
          @click="emit('select-compose')"
        >
          <div class="flex items-center gap-2.5">
            <div
              class="flex size-6 shrink-0 items-center justify-center rounded-control bg-inset text-ink-2"
            >
              <Icon name="lucide:file-code" size="14" />
            </div>
            <div class="text-body font-semibold text-ink">Use your own compose file</div>
          </div>
          <p class="mt-2 text-caption text-ink-2">
            Paste a docker-compose.yml and run it as-is, without a catalog entry.
          </p>
        </button>
      </div>
    </div>
  </Card>
</template>
