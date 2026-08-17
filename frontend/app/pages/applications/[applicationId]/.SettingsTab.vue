<script setup lang="ts">
  import type { Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  type SectionId = 'healthcheck' | 'resources' | 'volumes' | 'git' | 'danger';

  const SECTIONS: { id: SectionId; label: string; icon: string; danger?: boolean }[] = [
    { id: 'healthcheck', label: 'Healthcheck', icon: 'lucide:heart-pulse' },
    { id: 'resources', label: 'Resource limits', icon: 'lucide:gauge' },
    { id: 'volumes', label: 'Volumes', icon: 'lucide:hard-drive' },
    { id: 'git', label: 'Git credentials', icon: 'lucide:git-branch' },
    { id: 'danger', label: 'Danger zone', icon: 'lucide:triangle-alert', danger: true },
  ];

  const visibleSections = computed(() =>
    SECTIONS.filter(section => section.id === 'danger' || props.application.source === 'git'),
  );

  const activeSection = ref<SectionId>(visibleSections.value[0]?.id ?? 'danger');
</script>

<template>
  <div class="flex max-w-215 flex-col gap-4.5 lg:flex-row lg:items-start lg:gap-6">
    <SideNav v-model="activeSection" :items="visibleSections" class="lg:w-52 lg:shrink-0" />

    <div class="min-w-0 flex-1">
      <HealthcheckCard
        v-if="activeSection === 'healthcheck'"
        :application="application"
        :can-manage="canManage"
        @refresh="emit('refresh')"
      />
      <ResourceLimitsCard
        v-else-if="activeSection === 'resources'"
        :application="application"
        :can-manage="canManage"
        @refresh="emit('refresh')"
      />
      <VolumesCard
        v-else-if="activeSection === 'volumes'"
        :application="application"
        :can-manage="canManage"
        @refresh="emit('refresh')"
      />
      <GitCredentialsCard
        v-else-if="activeSection === 'git'"
        :application="application"
        @refresh="emit('refresh')"
      />
      <DangerZoneCard v-else :application="application" :can-manage="canManage" />
    </div>
  </div>
</template>
