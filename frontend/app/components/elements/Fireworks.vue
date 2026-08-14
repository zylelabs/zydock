<script setup lang="ts">
  const props = withDefaults(defineProps<{ duration?: number }>(), { duration: 6000 });

  const emit = defineEmits<{ done: [] }>();

  type Rocket = { x: number; y: number; vx: number; vy: number; targetY: number; hue: number };

  type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    decay: number;
    hue: number;
    size: number;
  };

  const GRAVITY = 0.05;
  const DRAG = 0.986;
  const LAUNCH_INTERVAL_MS = 320;
  const PARTICLES_PER_BURST = 90;

  const canvas = ref<HTMLCanvasElement | null>(null);

  onMounted(() => {
    const element = canvas.value;
    const context = element?.getContext('2d');

    if (!element || !context) {
      emit('done');

      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      emit('done');

      return;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      element.width = width * ratio;
      element.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const rockets: Rocket[] = [];
    const particles: Particle[] = [];

    const launch = () => {
      rockets.push({
        x: width * (0.15 + Math.random() * 0.7),
        y: height,
        vx: (Math.random() - 0.5) * 1.4,
        vy: -(height / 90) * (0.75 + Math.random() * 0.35),
        targetY: height * (0.1 + Math.random() * 0.32),
        hue: Math.floor(Math.random() * 360),
      });
    };

    const explode = (rocket: Rocket) => {
      for (let index = 0; index < PARTICLES_PER_BURST; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.sqrt(Math.random()) * 5.5 + 0.6;

        particles.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          decay: 0.008 + Math.random() * 0.013,
          hue: rocket.hue + (Math.random() - 0.5) * 40,
          size: 1.4 + Math.random() * 1.6,
        });
      }
    };

    let frameHandle = 0;
    let startedAt = 0;
    let lastLaunchAt = 0;
    let finished = false;

    const stop = () => {
      if (finished) {
        return;
      }

      finished = true;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener('resize', resize);
      emit('done');
    };

    const frame = (time: number) => {
      if (!startedAt) {
        startedAt = time;
      }

      const launching = time - startedAt < props.duration;

      if (launching && time - lastLaunchAt > LAUNCH_INTERVAL_MS) {
        lastLaunchAt = time;
        launch();
      }

      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = 'rgba(0, 0, 0, 0.18)';
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      for (let index = rockets.length - 1; index >= 0; index -= 1) {
        const rocket = rockets[index]!;

        rocket.x += rocket.vx;
        rocket.y += rocket.vy;
        rocket.vy += GRAVITY;

        context.fillStyle = `hsl(${rocket.hue}, 100%, 72%)`;
        context.beginPath();
        context.arc(rocket.x, rocket.y, 2, 0, Math.PI * 2);
        context.fill();

        if (rocket.vy >= 0 || rocket.y <= rocket.targetY) {
          explode(rocket);
          rockets.splice(index, 1);
        }
      }

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index]!;

        particle.vx *= DRAG;
        particle.vy = particle.vy * DRAG + GRAVITY;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life -= particle.decay;

        if (particle.life <= 0) {
          particles.splice(index, 1);

          continue;
        }

        context.fillStyle = `hsla(${particle.hue}, 100%, 65%, ${particle.life})`;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }

      if (!launching && !rockets.length && !particles.length) {
        stop();

        return;
      }

      frameHandle = requestAnimationFrame(frame);
    };

    frameHandle = requestAnimationFrame(frame);

    onBeforeUnmount(() => {
      cancelAnimationFrame(frameHandle);
      window.removeEventListener('resize', resize);
      finished = true;
    });
  });
</script>

<template>
  <canvas ref="canvas" aria-hidden="true" class="pointer-events-none fixed inset-0 z-60"></canvas>
</template>
