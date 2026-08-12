<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();

  const applicationsApi = useApplications();
  const session = useSessionStore();

  const { data: servicesData, status } = useLazyAsyncData(
    () => `application-${props.application.id}-compose-services`,
    () =>
      session.organizationId
        ? applicationsApi.services(props.application.id)
        : Promise.resolve({ services: [] }),
    {
      server: false,
      watch: [() => session.organizationId, () => props.application.id],
      default: () => ({ services: [] }),
    },
  );

  const services = computed(() => servicesData.value?.services ?? []);

  const secretKeys = computed(
    () => new Set(props.application.variables.filter(variable => variable.secret).map(v => v.key)),
  );
</script>

<template>
  <div class="flex max-w-205 flex-col gap-4.5">
    <Card
      title="Services"
      description="Derived from the compose file. Container names follow the zydock-<slug>-<service>-1 convention."
      content-class="p-0"
    >
      <template v-if="status === 'pending'">
        <SkeletonRow v-for="index in 2" :key="index" />
      </template>

      <Row v-for="service in services" :key="service.service" class="grid-cols-[1fr_auto]">
        <div class="flex items-center gap-2">
          <span class="font-mono text-[13px] text-ink">{{ service.service }}</span>
          <Tag v-if="service.exposed" color="live">exposed</Tag>
        </div>
        <div class="font-mono text-caption text-ink-2">{{ service.containerName }}</div>
      </Row>

      <p
        v-if="status !== 'pending' && !services.length"
        class="px-4.25 py-6 text-center text-caption text-ink-2"
      >
        No services found in the compose file.
      </p>
    </Card>

    <Card
      title="docker-compose.yml"
      description="Exactly what the template or the pasted file declares — read-only, no secrets in this file."
    >
      <pre
        class="max-h-[50vh] overflow-auto rounded-control bg-terminal p-4 font-mono text-[12.5px] leading-[1.7] text-white/85"
        >{{ application.compose?.content }}</pre>
    </Card>

    <Card
      title="Variables"
      description="Values never leave the platform through this tab — secrets are shown as keys only."
      content-class="p-0"
    >
      <Row
        v-for="variable in application.variables"
        :key="variable.key"
        class="grid-cols-[1fr_auto]"
      >
        <span class="font-mono text-[13px] text-ink">{{ variable.key }}</span>
        <Tag v-if="secretKeys.has(variable.key)">secret</Tag>
      </Row>

      <p
        v-if="!application.variables.length"
        class="px-4.25 py-6 text-center text-caption text-ink-2"
      >
        No variables.
      </p>
    </Card>
  </div>
</template>
