<script lang="ts" setup>
  type Tab = { id: string; label: string; active?: boolean; badge?: { color?: string } | null } & {
    subLabels?: Omit<Tab, 'subLabels'>[];
  };

  const props = defineProps<{ tabs: Tab[] }>();
  const emit = defineEmits(['changeTab']);

  const tabs = ref<Tab[]>(props.tabs);
  const tabRefs = ref<Array<HTMLElement | null>>([]);
  const dropdownRef = ref<HTMLElement | null>(null);
  const openDropdownIndex = ref<number | null>(null);
  const dropdownStyle = ref({ left: '0px', top: '0px', width: 'auto' });

  const activeIndex = ref(tabs.value.findIndex(t => t.active) || 0);

  const isMobile = ref(false);

  const updateIsMobile = () => {
    isMobile.value = window.innerWidth < 640;
  };

  const computeDropdownStyle = (index: number) => {
    nextTick(() => {
      const el = tabRefs.value[index];
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const left = rect.left + window.scrollX;
      const top = rect.bottom + window.scrollY + 4;
      const width = isMobile.value ? rect.width : Math.max(rect.width, 120);

      dropdownStyle.value = {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
      };
    });
  };

  const handleClick = (tab: Tab, index: number, ev?: MouseEvent) => {
    if (tab.subLabels && tab.subLabels.length) {
      ev?.stopPropagation();
      if (openDropdownIndex.value === index) {
        openDropdownIndex.value = null;
      } else {
        openDropdownIndex.value = index;
        computeDropdownStyle(index);
      }
      return;
    }

    tabs.value.forEach(item => {
      item.active = false;
      if (item.subLabels) item.subLabels.forEach(s => (s.active = false));
    });

    activeIndex.value = index;
    tab.active = true;
    openDropdownIndex.value = null;

    emit('changeTab', tab.id);
  };

  const handleSubClick = (sub: Omit<Tab, 'subLabels'>, parentIndex: number, ev?: MouseEvent) => {
    ev?.stopPropagation();

    tabs.value.forEach((t, i) => {
      t.active = i === parentIndex;
      if (t.subLabels) t.subLabels.forEach(s => (s.active = false));
    });

    const parent: Tab = tabs.value[parentIndex] as Tab;

    if (parent.subLabels) {
      const target = parent.subLabels.find(s => s.id === sub.id);
      if (target) target.active = true;
    }

    activeIndex.value = parentIndex;
    openDropdownIndex.value = null;

    emit('changeTab', sub.id);
  };

  const onResize = () => {
    updateIsMobile();
    if (openDropdownIndex.value !== null) computeDropdownStyle(openDropdownIndex.value);
  };

  const onDocClick = (ev: MouseEvent) => {
    const target = ev.target as Node;
    if (
      dropdownRef.value &&
      !dropdownRef.value.contains(target) &&
      !tabRefs.value.some(r => r && r.contains(target))
    ) {
      openDropdownIndex.value = null;
    }
  };

  const onScroll = () => {
    if (openDropdownIndex.value !== null) openDropdownIndex.value = null;
  };

  onMounted(() => {
    updateIsMobile();

    window.addEventListener('resize', onResize);
    document.addEventListener('click', onDocClick);

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('wheel', onScroll, { passive: true });
    document.addEventListener('touchmove', onScroll, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('click', onDocClick);

    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('scroll', onScroll, { capture: true } as any);
    window.removeEventListener('wheel', onScroll);
    document.removeEventListener('touchmove', onScroll);
  });
</script>

<template>
  <div class="relative w-full rounded-md overflow-hidden bg-slate-200 p-1">
    <div class="flex sm:flex-row flex-col gap-1.5 relative z-10 w-full">
      <div
        v-for="(tab, index) in tabs"
        :key="index"
        :ref="el => (tabRefs[index] = el as HTMLElement)"
        class="rounded-md py-1.5 px-4 font-medium text-center text-sm flex items-center justify-center transition-all duration-300 ease-in-out select-none whitespace-nowrap w-full relative"
        :class="[tab.active ? 'cursor-default bg-white' : 'cursor-pointer hover:bg-white/30']"
        @click.stop="handleClick(tab, index, $event)"
      >
        <span class="flex items-center justify-between gap-2">
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.badge != null"
            class="w-4 h-4 rounded-full border border-black/50"
            :style="{ backgroundColor: tab.badge!.color || 'transparent' }"
          ></span>
          <span v-if="tab.subLabels && tab.subLabels.length" class="ml-1">
            <svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fill-rule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                clip-rule="evenodd"
              />
            </svg>
          </span>
        </span>
      </div>
    </div>

    <teleport to="body">
      <div
        v-if="openDropdownIndex !== null"
        ref="dropdownRef"
        :style="{
          position: 'absolute',
          left: dropdownStyle.left,
          top: dropdownStyle.top,
          width: dropdownStyle.width,
        }"
        class="bg-white border rounded-md shadow-md z-20 overflow-hidden"
      >
        <div class="flex flex-col">
          <div
            v-for="(sub, sIdx) in tabs[openDropdownIndex]?.subLabels"
            :key="sIdx"
            class="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
            :class="sub.active ? 'font-semibold' : ''"
            @click.stop="handleSubClick(sub, openDropdownIndex, $event)"
          >
            {{ sub.label }}
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>
