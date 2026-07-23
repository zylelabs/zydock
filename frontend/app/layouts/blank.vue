<script setup lang="ts">
  // Centered shell for the entrance screens (login, cadastro, recuperação): the brand on top, the
  // screen's card below.
  const { name, logo } = useTheme();
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
    <NuxtLink to="/" class="flex items-center gap-3">
      <img v-if="logo" :src="logo" :alt="name" class="size-9 rounded-lg object-contain" />
      <span
        v-else
        class="flex size-9 items-center justify-center rounded-lg bg-primary text-base font-semibold text-white"
      >
        {{ name.charAt(0) }}
      </span>
      <span class="text-lg font-semibold">{{ name }}</span>
    </NuxtLink>

    <div class="w-full max-w-sm">
      <slot />
    </div>
  </div>
</template>
