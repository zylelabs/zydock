<script setup lang="ts">
  import { applicationStatusDot, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{
    application: Application;
    context: string;
    server?: string;
    lastDeploy: string;
  }>();

  const columns = computed(() =>
    props.server
      ? 'grid-cols-[1.3fr_1.1fr_0.8fr_0.8fr_auto]'
      : 'grid-cols-[1.3fr_1.1fr_0.8fr_auto]',
  );

  const origin = computed(() => {
    if (props.application.source === 'git') {
      return props.application.git?.repository ?? '—';
    }

    return props.application.origin
      ? `Template · ${props.application.origin.templateId}`
      : 'Docker Compose';
  });
</script>

<template>
  <Row :to="`/applications/${application.id}`" :class="columns">
    <div class="flex min-w-0 items-center gap-2.75">
      <StatusDot :status="applicationStatusDot(application.status)" />
      <div class="min-w-0">
        <div class="truncate text-[14px] font-medium text-ink">{{ application.name }}</div>
        <div class="truncate font-mono text-caption text-ink-2">{{ application.slug }}</div>
      </div>
    </div>
    <div class="truncate font-mono text-[13px] text-ink-2">{{ origin }}</div>
    <div class="truncate text-[13px] text-ink-2">{{ context }}</div>
    <div v-if="server" class="truncate text-[13px] text-ink-2">{{ server }}</div>
    <div class="text-right text-caption text-ink-2">{{ lastDeploy }}</div>
  </Row>
</template>
