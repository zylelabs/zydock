<script setup lang="ts">
  const STAR_COUNT = 64;
  const STAR_COLORS = ['#c9b6ff', '#a9c8ff', '#ffffff'];

  const noise = (seed: number) => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;

    return value - Math.floor(value);
  };

  const stars = Array.from({ length: STAR_COUNT }, (_, index) => {
    const opacity = 0.35 + noise(index + 9.4) * 0.5;

    return {
      cx: (noise(index + 1.3) * 1000).toFixed(1),
      cy: (noise(index + 3.7) * 1000).toFixed(1),
      r: (0.6 + noise(index + 5.1) * 1.2).toFixed(2),
      color: STAR_COLORS[Math.floor(noise(index + 7.9) * STAR_COLORS.length)] ?? '#ffffff',
      opacity: opacity.toFixed(2),
      values: `${opacity.toFixed(2)};${(opacity * 0.25).toFixed(2)};${opacity.toFixed(2)}`,
      duration: `${(2.5 + noise(index + 11.2) * 3.8).toFixed(2)}s`,
      begin: `${(noise(index + 13.6) * 5).toFixed(2)}s`,
    };
  });
</script>

<template>
  <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
    <div class="animate-drift absolute -inset-[6%]">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid slice"
        class="block"
      >
        <defs>
          <radialGradient id="nebula-violet">
            <stop offset="0%" stop-color="#6d4cff" />
            <stop offset="100%" stop-color="#6d4cff" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="nebula-blue">
            <stop offset="0%" stop-color="#3b6dff" />
            <stop offset="100%" stop-color="#3b6dff" stop-opacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="820" cy="80" rx="420" ry="260" fill="url(#nebula-violet)" opacity="0.35" />
        <ellipse cx="120" cy="720" rx="320" ry="230" fill="url(#nebula-blue)" opacity="0.28" />

        <circle
          v-for="(star, index) in stars"
          :key="index"
          :cx="star.cx"
          :cy="star.cy"
          :r="star.r"
          :fill="star.color"
          :opacity="star.opacity"
        >
          <animate
            attributeName="opacity"
            :values="star.values"
            :dur="star.duration"
            :begin="star.begin"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </div>
  </div>
</template>
