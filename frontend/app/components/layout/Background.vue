<script setup lang="ts">
  const STAR_COUNT = 64;
  const STAR_COLORS = ['#a5b4fc', '#a5f3fc', '#ffffff'];
  const METEOR_COUNT = 4;
  const METEOR_SLOPE = 0.55;
  const METEOR_MIN_DELAY = 14000;
  const METEOR_MAX_DELAY = 30000;

  const between = (min: number, max: number) => min + Math.random() * (max - min);

  const createStar = () => {
    const opacity = between(0.35, 0.85);

    return {
      cx: between(0, 1000).toFixed(1),
      cy: between(0, 1000).toFixed(1),
      r: between(0.6, 1.8).toFixed(2),
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)] ?? '#ffffff',
      opacity: opacity.toFixed(2),
      values: `${opacity.toFixed(2)};${(opacity * 0.25).toFixed(2)};${opacity.toFixed(2)}`,
      duration: `${between(2.5, 6.3).toFixed(2)}s`,
      begin: `${between(0, 5).toFixed(2)}s`,
    };
  };

  const createMeteor = () => {
    const length = between(60, 130);

    return {
      length: length.toFixed(1),
      tailY: (-length * METEOR_SLOPE).toFixed(1),
      width: between(0.5, 0.9).toFixed(2),
    };
  };

  const stars = ref<Array<ReturnType<typeof createStar>>>([]);
  const meteors = ref<Array<ReturnType<typeof createMeteor>>>([]);
  const meteorRefs = ref<Array<SVGGElement | null>>([]);
  const meteorTimers = ref<Array<ReturnType<typeof setTimeout>>>([]);

  const launch = (element: SVGGElement) => {
    const startX = between(-120, 1120);
    const startY = between(-200, 640);
    const distance = between(460, 880);

    return element.animate(
      [
        { transform: `translate(${startX}px, ${startY}px)`, opacity: 0 },
        { opacity: 0.45, offset: 0.25 },
        { opacity: 0.3, offset: 0.6 },
        {
          transform: `translate(${startX - distance}px, ${startY + distance * METEOR_SLOPE}px)`,
          opacity: 0,
        },
      ],
      { duration: between(1000, 1600), easing: 'linear' },
    );
  };

  const schedule = (index: number, delay: number) => {
    meteorTimers.value[index] = setTimeout(() => {
      const element = meteorRefs.value[index];

      if (!element) return;

      launch(element).addEventListener('finish', () =>
        schedule(index, between(METEOR_MIN_DELAY, METEOR_MAX_DELAY)),
      );
    }, delay);
  };

  onMounted(async () => {
    stars.value = Array.from({ length: STAR_COUNT }, createStar);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    meteors.value = Array.from({ length: METEOR_COUNT }, createMeteor);

    await nextTick();

    meteors.value.forEach((_, index) => schedule(index, between(800, METEOR_MAX_DELAY)));
  });

  onBeforeUnmount(() => meteorTimers.value.forEach(clearTimeout));
</script>

<template>
  <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
    <div class="animate-drift absolute inset-[-6%]">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid slice"
        class="block"
      >
        <defs>
          <radialGradient id="nebula-indigo">
            <stop offset="0%" stop-color="#4f46e5" />
            <stop offset="100%" stop-color="#4f46e5" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="nebula-blue">
            <stop offset="0%" stop-color="#3b6dff" />
            <stop offset="100%" stop-color="#3b6dff" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="meteor-trail" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#cffafe" stop-opacity="0.7" />
            <stop offset="35%" stop-color="#a5b4fc" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#a5b4fc" stop-opacity="0" />
          </linearGradient>
        </defs>

        <ellipse cx="820" cy="80" rx="420" ry="260" fill="url(#nebula-indigo)" opacity="0.35" />
        <ellipse cx="120" cy="720" rx="320" ry="230" fill="url(#nebula-blue)" opacity="0.2" />

        <g class="animate-star-fade">
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
        </g>

        <g
          v-for="(meteor, index) in meteors"
          :key="`meteor-${index}`"
          :ref="el => (meteorRefs[index] = el as SVGGElement)"
          opacity="0"
        >
          <line
            x1="0"
            y1="0"
            :x2="meteor.length"
            :y2="meteor.tailY"
            stroke="url(#meteor-trail)"
            :stroke-width="meteor.width"
            stroke-linecap="round"
          />
          <circle cx="0" cy="0" :r="meteor.width" fill="#cffafe" opacity="0.7" />
        </g>
      </svg>
    </div>
  </div>
</template>
