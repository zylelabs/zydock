<script setup lang="ts">
  type StepStatus = 'done' | 'running' | 'pending';
  type Step = { label: string; hint?: string; time?: string; status: StepStatus };

  defineProps<{ steps: Step[] }>();
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <div
      v-for="(step, index) in steps"
      :key="index"
      class="flex items-start gap-2.75 rounded-button px-2.5 py-2.25"
      :class="step.status === 'running' && 'bg-inset'"
    >
      <div
        class="mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-label font-semibold"
        :class="
          step.status === 'done'
            ? 'bg-live text-white'
            : step.status === 'running'
              ? 'bg-ink text-page'
              : 'bg-edge text-ink-3'
        "
      >
        <Icon v-if="step.status === 'done'" name="lucide:check" class="size-2.5" />
        <template v-else>{{ index + 1 }}</template>
      </div>
      <div class="min-w-0 flex-1">
        <div
          class="text-caption font-medium"
          :class="step.status === 'pending' ? 'text-ink-3' : 'text-ink'"
        >
          {{ step.label }}
        </div>
        <div v-if="step.hint" class="mt-0.5 text-caption text-ink-3">{{ step.hint }}</div>
      </div>
      <div v-if="step.time" class="font-mono text-caption text-ink-3">{{ step.time }}</div>
    </div>
  </div>
</template>
