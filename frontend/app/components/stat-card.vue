<script setup lang="ts">
  const {
    highlight = '',
    caption = '',
    points = [],
  } = defineProps<{
    label: string;
    value: string | number;
    icon: string;
    highlight?: string;
    caption?: string;
    points?: number[];
  }>();
</script>

<template>
  <UiCard flush>
    <div class="px-5 pt-5">
      <div class="flex items-center gap-2">
        <span class="flex-1 text-sm font-semibold">{{ label }}</span>
        <Icon :name="icon" class="size-4.5 text-content-dim" />
      </div>

      <div class="mt-3.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span class="text-[34px] leading-none font-semibold tracking-tight text-content-strong">
          {{ value }}
        </span>

        <span v-if="highlight" class="text-sm font-semibold text-success">{{ highlight }}</span>
        <span v-if="caption" class="text-sm whitespace-nowrap text-content-muted">
          {{ caption }}
        </span>
      </div>
    </div>

    <UiSparkline :points="points" class="mt-3.5 text-content-dim" />
  </UiCard>
</template>
