<script setup lang="ts">
  import type { Status } from '~/components/elements/StatusDot.vue';
  import {
    useApplications,
    type Application,
    type ApplicationService,
    type ApplicationServiceStatus,
  } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();

  const applicationsApi = useApplications();
  const session = useSessionStore();

  const { data: servicesData, status: servicesStatus } = useLazyAsyncData<{
    services: ApplicationService[];
    networkName?: string;
  }>(
    () => `application-${props.application.id}-services`,
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
  const networkName = computed(() => servicesData.value?.networkName ?? '');
  const servicesFirstLoad = useFirstLoad(servicesStatus);

  const { data: statusData, refresh: refreshStatus } = useLazyAsyncData<{
    services: ApplicationServiceStatus[];
    degraded?: { reason: string };
  }>(
    () => `application-${props.application.id}-services-status`,
    () =>
      session.organizationId
        ? applicationsApi.serviceStatus(props.application.id)
        : Promise.resolve({ services: [] }),
    {
      server: false,
      watch: [() => session.organizationId, () => props.application.id],
      default: () => ({ services: [] }),
    },
  );

  const statusByService = computed(
    () => new Map(statusData.value?.services.map(entry => [entry.service, entry]) ?? []),
  );
  const degradedReason = computed(() => statusData.value?.degraded?.reason ?? '');

  const STATE_DOT: Record<string, Status> = {
    running: 'live',
    restarting: 'attn',
    starting: 'attn',
    exited: 'failed',
    dead: 'failed',
  };

  const statusDotFor = (service: string) =>
    STATE_DOT[statusByService.value.get(service)?.state ?? ''] ?? 'stopped';

  const kindLine = (service: ApplicationService) => {
    const memory = statusByService.value.get(service.service)?.memoryUsedMb;

    return [service.kind, memory != null ? `${memory} MB` : null].filter(Boolean).join(' · ');
  };

  const primaryService = computed(() => services.value.find(entry => entry.role === 'primary'));

  const footerText = computed(() =>
    primaryService.value?.domain
      ? `Only ${primaryService.value.service} is published on a domain. The other services answer on the internal network and are unreachable from outside the server.`
      : 'No service in this application is published on a domain. All services answer on the internal network and are unreachable from outside the server.',
  );

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const restartTarget = ref('');
  const confirmRestartOpen = ref(false);
  const restartingService = ref('');
  const restartError = ref('');

  const askRestart = (service: string) => {
    restartTarget.value = service;
    confirmRestartOpen.value = true;
  };

  const confirmRestartService = async () => {
    restartError.value = '';
    restartingService.value = restartTarget.value;

    try {
      await applicationsApi.restartService(props.application.id, restartTarget.value);
      confirmRestartOpen.value = false;
      await refreshStatus();
    } catch (error) {
      restartError.value = messageOf(error, 'Failed to restart the service.');
    } finally {
      restartingService.value = '';
    }
  };
</script>

<template>
  <div class="flex max-w-205 flex-col gap-4.5">
    <Card :title="`Services · ${services.length}`" content-class="p-0">
      <template v-if="networkName" #right>
        <div class="font-mono text-caption text-ink-2 sm:text-right">network {{ networkName }}</div>
      </template>

      <template v-if="servicesFirstLoad">
        <SkeletonRow v-for="index in 2" :key="index" />
      </template>

      <template v-else>
        <div
          class="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-4.25 border-b border-hairline px-4.25 py-2.5 text-label text-ink-3 uppercase"
        >
          <div>Service</div>
          <div>Image</div>
          <div>Internal address</div>
          <div />
        </div>

        <Row
          v-for="service in services"
          :key="service.service"
          as="div"
          class="grid-cols-[1.4fr_1fr_1fr_auto]"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <StatusDot :status="statusDotFor(service.service)" />
              <span class="truncate font-mono text-caption text-ink">{{ service.service }}</span>
              <Tag :color="service.role === 'primary' ? 'live' : 'default'">
                {{ service.role === 'primary' ? 'Primary' : 'Linked' }}
              </Tag>
            </div>
            <div v-if="kindLine(service)" class="mt-0.75 text-caption text-ink-2">
              {{ kindLine(service) }}
            </div>
          </div>

          <div class="min-w-0 truncate font-mono text-caption text-ink" :title="service.image">
            {{ service.image ?? '—' }}
          </div>

          <div class="min-w-0">
            <div class="truncate font-mono text-caption text-ink">
              {{ service.service }}{{ service.internalPort ? `:${service.internalPort}` : '' }}
            </div>
            <div class="truncate text-caption text-ink-2">
              {{
                service.role === 'primary' ? (service.domain ?? 'not published') : 'internal only'
              }}
            </div>
          </div>

          <div class="relative flex items-center justify-end gap-2">
            <Button
              theme="secondary"
              size="sm"
              :to="`/applications/${application.id}/logs?service=${service.service}`"
            >
              Logs
            </Button>
            <Button
              v-if="canManage"
              theme="secondary"
              size="sm"
              :disabled="restartingService === service.service"
              @click="askRestart(service.service)"
            >
              <Icon
                v-if="restartingService === service.service"
                name="svg-spinners:tadpole"
                size="16"
              />
              Restart
            </Button>
          </div>
        </Row>
      </template>

      <template #footer>
        <div class="flex flex-col gap-1">
          <p class="text-caption text-ink-2">{{ footerText }}</p>
          <p v-if="degradedReason" class="text-caption text-ink-3">
            Live status unavailable — {{ degradedReason }}
          </p>
        </div>
      </template>
    </Card>

    <Alert v-if="restartError" theme="error">{{ restartError }}</Alert>

    <Confirm
      v-model:open="confirmRestartOpen"
      title="Restart service"
      :message="`Restart ${restartTarget}? The container is recreated and requests in flight can be interrupted.`"
      confirm-label="Restart"
      :loading="restartingService === restartTarget"
      @confirm="confirmRestartService"
    />
  </div>
</template>
