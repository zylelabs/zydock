<script setup lang="ts">
  useHead({ title: 'Observabilidade' });

  interface ServerMetric {
    cpuPercent?: number;
    memoryUsedMb: number;
    memoryTotalMb: number;
    diskUsedGb?: number;
    diskTotalGb?: number;
    uptimeSeconds: number;
  }

  const session = useSessionStore();
  const { current } = useOrganizations();
  const servers = useServers();
  const applications = useApplications();
  const databases = useDatabases();
  const domains = useDomains();
  const { subscribe, status } = useWebSocket();

  const { data } = await useAsyncData(
    'observability',
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [serverList, apps, dbs, doms] = await Promise.all([
        servers.list(),
        applications.list(),
        databases.list(),
        domains.list(),
      ]);

      return {
        servers: serverList.items,
        counts: {
          servers: serverList.total,
          applications: apps.total,
          databases: dbs.total,
          domains: doms.total,
        },
      };
    },
    { server: false, watch: [() => session.organizationId] },
  );

  const cards = computed(() => [
    { label: 'Servidores', value: data.value?.counts.servers ?? 0, icon: 'lucide:server' },
    { label: 'Aplicações', value: data.value?.counts.applications ?? 0, icon: 'lucide:box' },
    { label: 'Bancos', value: data.value?.counts.databases ?? 0, icon: 'lucide:database' },
    { label: 'Domínios', value: data.value?.counts.domains ?? 0, icon: 'lucide:globe' },
  ]);

  // Métricas ao vivo dos servidores online, pelo WebSocket (uma assinatura por servidor).
  const metrics = reactive<Record<string, ServerMetric>>({});
  const subscribed = new Set<string>();

  watch(
    () => data.value?.servers,
    list => {
      for (const server of list ?? []) {
        if (!server.online || subscribed.has(server.id)) {
          continue;
        }

        subscribed.add(server.id);
        subscribe(`server:${server.id}:metrics`, message => {
          if (message.event === 'metrics') {
            metrics[server.id] = message.data as ServerMetric;
          }
        });
      }
    },
    { immediate: true },
  );

  const percent = (used = 0, total = 0) => (total ? Math.round((used / total) * 100) : 0);

  const rows = computed(() =>
    (data.value?.servers ?? [])
      .filter(server => server.online)
      .map(server => ({
        id: server.id,
        name: server.name,
        metric: metrics[server.id] as ServerMetric | undefined,
      })),
  );
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header>
      <h1>Observabilidade</h1>
      <p class="mt-1 text-sm text-content-muted">Visão geral e métricas ao vivo da organização.</p>
    </header>

    <UiCard v-if="!current" title="Selecione uma organização">
      <p class="text-sm text-content-muted">Escolha ou crie uma organização na barra lateral.</p>
    </UiCard>

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="card in cards"
          :key="card.label"
          class="flex items-center gap-3 rounded-xl border border-surface-border bg-surface-raised p-4"
        >
          <Icon :name="card.icon" class="size-6 text-primary" />
          <div>
            <p class="text-2xl font-semibold">{{ card.value }}</p>
            <p class="text-xs text-content-muted">{{ card.label }}</p>
          </div>
        </div>
      </div>

      <UiCard title="Servidores ao vivo">
        <template #header>
          <div class="flex items-center justify-between">
            <h2>Servidores ao vivo</h2>
            <span class="text-xs text-content-muted">{{ status }}</span>
          </div>
        </template>

        <p v-if="!rows.length" class="text-sm text-content-muted">
          Nenhum servidor online. As métricas aparecem quando o agente está conectado.
        </p>

        <ul v-else class="flex flex-col gap-4">
          <li v-for="row in rows" :key="row.id">
            <div class="mb-1 flex items-center justify-between text-sm">
              <span class="font-medium">{{ row.name }}</span>
              <span class="text-xs text-content-muted">
                {{
                  row.metric
                    ? `up ${Math.floor((row.metric.uptimeSeconds ?? 0) / 3600)}h`
                    : 'aguardando…'
                }}
              </span>
            </div>

            <div v-if="row.metric" class="grid gap-2 sm:grid-cols-2">
              <div>
                <div class="mb-1 flex justify-between text-xs text-content-muted">
                  <span>CPU</span><span>{{ Math.round(row.metric.cpuPercent ?? 0) }}%</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    class="h-full bg-primary"
                    :style="{ width: `${Math.min(100, row.metric.cpuPercent ?? 0)}%` }"
                  />
                </div>
              </div>
              <div>
                <div class="mb-1 flex justify-between text-xs text-content-muted">
                  <span>Memória</span>
                  <span>{{ percent(row.metric.memoryUsedMb, row.metric.memoryTotalMb) }}%</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    class="h-full bg-primary"
                    :style="{
                      width: `${percent(row.metric.memoryUsedMb, row.metric.memoryTotalMb)}%`,
                    }"
                  />
                </div>
              </div>
            </div>
          </li>
        </ul>
      </UiCard>
    </template>
  </section>
</template>
