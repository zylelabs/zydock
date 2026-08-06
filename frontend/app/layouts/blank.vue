<template>
  <div class="flex min-h-dvh items-center justify-center bg-page p-10 text-ink">
    <div class="w-97 max-w-full">
      <div class="mb-6.5 flex items-center gap-2.5 select-none">
        <div class="flex size-7 shrink-0 items-center justify-center rounded-control bg-ink">
          <div class="size-2.5 rotate-45 rounded-[2px] bg-page" />
        </div>
        <div class="text-[15px] font-semibold tracking-[-0.01em] text-ink">Zydock</div>
      </div>

      <slot />
    </div>
  </div>
</template>
