<script setup lang="ts">
  const { points, height = 96 } = defineProps<{ points: number[]; height?: number }>();

  const WIDTH = 300;
  const PADDING = 14;

  const polyline = computed(() => {
    if (points.length < 2) {
      return '';
    }

    const highest = Math.max(...points);
    const lowest = Math.min(...points);
    const range = highest - lowest;
    const usable = height - PADDING * 2;

    return points
      .map((value, index) => {
        const x = (index / (points.length - 1)) * WIDTH;
        const y = range
          ? PADDING + usable - ((value - lowest) / range) * usable
          : PADDING + usable / 2;

        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });
</script>

<template>
  <svg
    v-if="polyline"
    :viewBox="`0 0 ${WIDTH} ${height}`"
    :height="height"
    preserveAspectRatio="none"
    class="block w-full"
    aria-hidden="true"
  >
    <polyline
      :points="polyline"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
