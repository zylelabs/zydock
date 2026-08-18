<script setup lang="ts">
  import { z } from 'zod';
  import {
    useTemplateSources,
    type TemplateSource,
  } from '~/composables/services/useTemplateSources';

  const toast = useToast();
  const { list: listTemplateSources, create, sync, remove } = useTemplateSources();

  const emptySources = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const {
    data: sourcesData,
    refresh: refreshSources,
    status: sourcesStatus,
    error: sourcesLoadError,
  } = useLazyAsyncData('settings-template-sources', () => listTemplateSources(), {
    server: false,
    default: () => emptySources,
  });

  const sources = computed(() => sourcesData.value?.items ?? []);
  const sourcesFirstLoad = useFirstLoad(sourcesStatus);

  const sourcesError = computed(
    () =>
      (sourcesLoadError.value as { message?: string } | null)?.message ||
      (sourcesLoadError.value ? 'Could not load the catalog sources.' : ''),
  );

  const errorMessageOf = (error: unknown, fallback: string) =>
    (error as { message?: string })?.message || fallback;

  const formatDate = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');

  const addOpen = ref(false);

  const addForm = useSchemaForm(
    z.object({
      url: z
        .string()
        .trim()
        .url('Enter a valid URL')
        .refine(value => value.startsWith('https://'), 'Only "https://" URLs are supported'),
      ref: z.string().trim().min(1, 'Enter a branch or tag'),
    }),
    { url: '', ref: 'main' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const openAdd = () => {
    addForm.reset();
    addOpen.value = true;
  };

  const handleAdd = addForm.submit(async values => {
    await create({ url: values.url, ref: values.ref });
    addOpen.value = false;
    await refreshSources();
    toast.success({
      title: 'Source added',
      message: 'Sync it to fetch its templates.',
    });
  });

  const syncingId = ref<string | null>(null);

  const syncSource = async (source: TemplateSource) => {
    syncingId.value = source.id;

    try {
      await sync(source.id);
      await refreshSources();
    } catch (error) {
      toast.error({ title: 'Error', message: errorMessageOf(error, 'Could not sync the source.') });
    } finally {
      syncingId.value = null;
    }
  };

  const toRemove = ref<TemplateSource | null>(null);
  const confirmRemoveOpen = ref(false);
  const removing = ref(false);

  const askRemove = (source: TemplateSource) => {
    toRemove.value = source;
    confirmRemoveOpen.value = true;
  };

  const runRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;

    try {
      await remove(toRemove.value.id);
      await refreshSources();
      confirmRemoveOpen.value = false;
      toRemove.value = null;
    } catch (error) {
      toast.error({
        title: 'Error',
        message: errorMessageOf(error, 'Could not remove the source.'),
      });
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <Card
      title="Catalog sources"
      description="Community catalogs synced from a Git repository, in addition to the built-in marketplace."
    >
      <template #right>
        <Button theme="primary" size="xs" @click="openAdd">
          <Icon name="proicons:add" size="16" />
          Add source
        </Button>
      </template>

      <Row as="div" class="flex items-start">
        <Alert theme="warning" class="w-full">
          A template from a third-party source runs a container on your own server. The compose
          denylist limits what it can do, but it does not replace trusting whoever maintains the
          source — review it before adding.
        </Alert>
      </Row>

      <div v-if="sourcesFirstLoad" class="flex flex-col gap-3 p-3">
        <Skeleton class="h-24 w-full rounded-card" />
        <Skeleton class="h-24 w-full rounded-card" />
      </div>

      <Alert v-else-if="sourcesError" theme="error" class="m-3">{{ sourcesError }}</Alert>

      <EmptyState
        v-else-if="!sources.length"
        title="No catalog source added"
        description="Add a Git repository laid out like the built-in templates/ folder to bring its templates into the marketplace."
      />

      <div v-else class="flex flex-col gap-3.5">
        <div
          v-for="source in sources"
          :key="source.id"
          class="overflow-hidden rounded-card border border-edge"
        >
          <div class="flex flex-wrap items-center gap-3 px-4.25 py-3.25">
            <h3 class="min-w-0 flex-1 truncate font-mono text-body font-semibold text-ink">
              {{ source.url }}
            </h3>
            <Tag>{{ source.ref }}</Tag>
            <Tag :color="source.lastError ? 'failed' : source.lastSyncedAt ? 'live' : 'default'">
              {{ source.lastError ? 'Sync failed' : source.lastSyncedAt ? 'Synced' : 'Not synced' }}
            </Tag>
          </div>

          <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
            <div class="w-33 shrink-0 text-caption text-ink-2">Templates</div>
            <div class="min-w-0 flex-1 text-caption text-ink">{{ source.templateCount }}</div>
          </Row>
          <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
            <div class="w-33 shrink-0 text-caption text-ink-2">Last synced</div>
            <div class="min-w-0 flex-1 text-caption text-ink">
              {{ formatDate(source.lastSyncedAt) }}
            </div>
          </Row>

          <Row v-if="source.lastError" as="div" class="flex items-start">
            <Alert theme="error" class="w-full">{{ source.lastError }}</Alert>
          </Row>

          <Row v-if="source.collisions.length" as="div" class="flex items-start">
            <Alert theme="warning" class="w-full">
              <p v-for="collision in source.collisions" :key="collision.templateId">
                “{{ collision.templateId }}” was skipped: already provided by
                {{ collision.keptBy === 'embedded' ? 'the built-in catalog' : 'another source' }}.
              </p>
            </Alert>
          </Row>

          <Row as="div" class="flex items-center gap-2">
            <Button
              theme="secondary"
              size="xs"
              :disabled="syncingId === source.id"
              @click="syncSource(source)"
            >
              <Icon
                :name="syncingId === source.id ? 'svg-spinners:tadpole' : 'lucide:refresh-cw'"
                size="14"
              />
              Sync now
            </Button>
            <Button theme="quiet" size="xs" @click="askRemove(source)">
              <Icon name="lucide:trash-2" class="size-3.5" />
              Remove
            </Button>
          </Row>
        </div>
      </div>
    </Card>

    <Confirm
      v-if="toRemove"
      v-model:open="confirmRemoveOpen"
      title="Remove catalog source"
      :message="`Remove “${toRemove.url}”? Its ${toRemove.templateCount} template(s) disappear from the marketplace immediately. Applications already deployed from them keep running.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="runRemove"
    />

    <Modal :open="addOpen" @on-close-modal="addOpen = false">
      <Card
        title="Add catalog source"
        rows
        class="w-md max-w-full"
        close-button
        @on-close="addOpen = false"
      >
        <form class="flex flex-col" @submit.prevent="handleAdd">
          <Row as="div" class="flex items-start">
            <Alert theme="warning" class="w-full">
              Templates from this source run containers on your servers. Only add sources you trust
              — the compose denylist reduces the blast radius, it does not vet the author.
            </Alert>
          </Row>

          <Input
            v-model="addForm.values.url"
            label="Repository URL"
            placeholder="https://github.com/example/zydock-templates"
            mono
            boxed
            :call-error="addForm.errors.value.url"
          />
          <Input
            v-model="addForm.values.ref"
            label="Branch or tag"
            placeholder="main"
            mono
            boxed
            :call-error="addForm.errors.value.ref"
          />

          <p class="px-4.25 pt-3.25 text-caption text-ink-3">
            The repository must be laid out like the built-in <code>templates/</code> folder — one
            directory per template, each with a <code>template.json</code>. Adding it does not sync
            it; use "Sync now" afterwards.
          </p>

          <div class="flex items-center justify-end gap-2 px-4.25 py-3.25">
            <Button theme="quiet" size="sm" type="button" @click="addOpen = false">Cancel</Button>
            <Button theme="primary" size="sm" type="submit" :disabled="addForm.loading.value">
              <Icon v-if="addForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Add source
            </Button>
          </div>
        </form>
      </Card>
    </Modal>
  </div>
</template>
