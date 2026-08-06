<script setup lang="ts">
  import {
    serverStatusDot,
    type Server,
    type ServerStatus,
  } from '~/composables/services/useServers';
  import type { SystemMetrics } from '~/composables/services/useMetrics';
  import {
    applicationStatusDot,
    type Application,
    type ApplicationStatus,
  } from '~/composables/services/useApplications';

  defineProps<{
    server: Server;
    metrics?: SystemMetrics | null;
    applications?: Application[];
  }>();

  const SERVER_STATUS_LABEL: Record<ServerStatus, string> = {
    pending: 'Pending',
    validating: 'Validating',
    provisioning: 'Provisioning',
    online: 'Online',
    offline: 'Offline',
    failed: 'Failed',
  };

  const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
    created: 'Created',
    deploying: 'Deploying',
    running: 'Running',
    stopped: 'Stopped',
    failed: 'Failed',
  };

  const percent = (used = 0, total = 0) => (total ? Math.round((used / total) * 100) : 0);
</script>

<template>
  <div class="flex flex-col gap-4 rounded-panel border border-edge bg-card p-4.5 shadow-raised">
    <div class="flex items-center gap-3">
      <div class="flex size-10.5 shrink-0 items-center justify-center rounded-xl bg-inset">
        <div class="h-3 w-4.75 rounded-[3px] border-[1.5px] border-ink-2"></div>
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-[14.5px] font-semibold text-ink">{{ server.name }}</div>
        <div class="truncate font-mono text-[12.5px] text-ink-2">
          {{
            server.type === 'local' ? `${server.agent.host}:${server.agent.port}` : server.ssh.host
          }}
          <span v-if="server.resources.cpuCount">
            · {{ server.resources.cpuCount }} vCPU · {{ server.resources.memoryMb }} MB
          </span>
        </div>
      </div>
      <Tag :color="serverStatusDot(server.status)">{{ SERVER_STATUS_LABEL[server.status] }}</Tag>
      <slot name="actions" />
    </div>

    <div v-if="applications?.length" class="flex flex-col gap-1.5">
      <NuxtLink
        v-for="application in applications"
        :key="application.id"
        :to="`/applications/${application.id}`"
        class="flex items-center gap-2.5 rounded-[10px] border border-hairline bg-inset px-2.75 py-2.25 transition-colors hover:border-edge-strong"
      >
        <StatusDot :status="applicationStatusDot(application.status)" />
        <span class="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
          {{ application.name }}
        </span>
        <span class="font-mono text-xs text-ink-2">{{
          APPLICATION_STATUS_LABEL[application.status]
        }}</span>
      </NuxtLink>
    </div>

    <div v-if="metrics" class="grid grid-cols-2 gap-3.5 border-t border-hairline pt-3.5">
      <Gauge
        label="CPU"
        :value="`${Math.round(metrics.cpuPercent ?? 0)}%`"
        :percent="metrics.cpuPercent ?? 0"
      />
      <Gauge
        label="Memory"
        :value="`${percent(metrics.memoryUsedMb, metrics.memoryTotalMb)}%`"
        :percent="percent(metrics.memoryUsedMb, metrics.memoryTotalMb)"
      />
    </div>
  </div>
</template>
