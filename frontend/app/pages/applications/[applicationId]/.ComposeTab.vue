<script setup lang="ts">
  import {
    applicationVersionStatus,
    isVersionDowngrade,
    useApplications,
    type Application,
    type TemplateUpdatePreview,
  } from '~/composables/services/useApplications';
  import { useTemplates, type Template } from '~/composables/services/useTemplates';

  const props = defineProps<{ application: Application; canManage: boolean }>();

  const applicationsApi = useApplications();
  const templatesApi = useTemplates();
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

  const { data: templateData } = useLazyAsyncData<{ template: Template | null }>(
    () => `application-${props.application.id}-origin-template`,
    async () => {
      const templateId = props.application.origin?.templateId;

      if (!templateId) {
        return { template: null };
      }

      try {
        return await templatesApi.get(templateId);
      } catch {
        return { template: null };
      }
    },
    {
      server: false,
      watch: [() => props.application.origin?.templateId],
      default: () => ({ template: null }),
    },
  );

  const versionStatus = computed(() =>
    applicationVersionStatus(props.application, templateData.value?.template ?? null),
  );

  const versionSelectOptions = computed(() =>
    versionStatus.value.editable
      ? versionStatus.value.options.map(option => ({
          value: option.value,
          label: option.label ?? option.value,
        }))
      : [],
  );

  const selectedVersion = ref('');

  watch(
    versionStatus,
    status => {
      if (status.editable) {
        selectedVersion.value = status.current;
      }
    },
    { immediate: true },
  );

  const isDowngrade = computed(
    () =>
      versionStatus.value.editable &&
      isVersionDowngrade(
        versionStatus.value.options,
        versionStatus.value.current,
        selectedVersion.value,
      ),
  );

  const hasDatabases = computed(() => Boolean(templateData.value?.template?.databases.length));

  const confirmOpen = ref(false);
  const applying = ref(false);
  const applyError = ref('');

  const { data: templateUpdateData, refresh: refreshTemplateUpdate } = useLazyAsyncData<{
    preview: TemplateUpdatePreview | null;
  }>(
    () => `application-${props.application.id}-template-update`,
    async () => {
      if (props.application.templateStatus !== 'update-available') {
        return { preview: null };
      }

      try {
        return { preview: await applicationsApi.templateUpdatePreview(props.application.id) };
      } catch {
        return { preview: null };
      }
    },
    {
      server: false,
      watch: [() => props.application.templateStatus, () => props.application.id],
      default: () => ({ preview: null }),
    },
  );

  const templateUpdatePreview = computed(() => templateUpdateData.value?.preview ?? null);

  const requiredNewInputs = computed(
    () =>
      templateData.value?.template?.inputs.filter(
        input =>
          input.required && templateUpdatePreview.value?.variables?.added.includes(input.key),
      ) ?? [],
  );

  const templateUpdateInputValues = reactive<Record<string, string>>({});

  watch(
    requiredNewInputs,
    inputs => {
      for (const key of Object.keys(templateUpdateInputValues)) {
        if (!inputs.some(input => input.key === key)) {
          Reflect.deleteProperty(templateUpdateInputValues, key);
        }
      }

      for (const input of inputs) {
        if (templateUpdateInputValues[input.key] === undefined) {
          templateUpdateInputValues[input.key] = input.default != null ? String(input.default) : '';
        }
      }
    },
    { immediate: true },
  );

  const confirmManualOverwrite = ref(false);
  const applyingTemplateUpdate = ref(false);
  const templateUpdateError = ref('');

  const canApplyTemplateUpdate = computed(
    () =>
      requiredNewInputs.value.every(input => templateUpdateInputValues[input.key]) &&
      (!templateUpdatePreview.value?.manuallyEdited || confirmManualOverwrite.value),
  );

  const applyTemplateUpdateNow = async () => {
    templateUpdateError.value = '';
    applyingTemplateUpdate.value = true;

    try {
      const { deployment } = await applicationsApi.applyTemplateUpdate(props.application.id, {
        confirmOverwrite: confirmManualOverwrite.value,
        deployNow: true,
        inputs: { ...templateUpdateInputValues },
      });

      if (deployment) {
        await navigateTo(`/applications/${props.application.id}/deployments/${deployment.id}`);
      } else {
        await refreshTemplateUpdate();
      }
    } catch (error) {
      templateUpdateError.value = messageOf(error, 'Failed to update the template.');
    } finally {
      applyingTemplateUpdate.value = false;
    }
  };

  const confirmTitle = computed(() => (isDowngrade.value ? 'Downgrade version' : 'Update version'));

  const confirmMessage = computed(() =>
    isDowngrade.value
      ? `Downgrade to ${selectedVersion.value}? This can be incompatible with data already migrated by the version currently running. Volumes are never deleted, but the data does not roll back on its own.`
      : `Update to ${selectedVersion.value}? The application will restart to apply the new version.`,
  );

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const handleCloseConfirm = () => {
    if (applying.value) {
      return;
    }

    confirmOpen.value = false;
  };

  const applyVersion = async () => {
    applyError.value = '';
    applying.value = true;

    try {
      const { deployment } = await applicationsApi.changeVersion(props.application.id, {
        version: selectedVersion.value,
        deployNow: true,
      });

      confirmOpen.value = false;

      if (deployment) {
        await navigateTo(`/applications/${props.application.id}/deployments/${deployment.id}`);
      }
    } catch (error) {
      applyError.value = messageOf(error, 'Failed to change the version.');
    } finally {
      applying.value = false;
    }
  };
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
      v-if="application.origin?.templateId"
      title="Version"
      description="The image tag pinned for this application, from the versions the template declares."
    >
      <template v-if="versionStatus.editable">
        <div class="flex flex-wrap items-end gap-3.5">
          <div>
            <div class="text-caption text-ink-2">Running</div>
            <div class="font-mono text-[13px] text-ink">{{ versionStatus.current }}</div>
          </div>

          <template v-if="canManage">
            <Select
              v-model="selectedVersion"
              label="Version"
              :options="versionSelectOptions"
              boxed
              class="min-w-40"
            />
            <Button
              theme="secondary"
              size="sm"
              :disabled="selectedVersion === versionStatus.current"
              @click="confirmOpen = true"
            >
              Update
            </Button>
          </template>
        </div>

        <Alert v-if="applyError" theme="error" class="mt-3.5">{{ applyError }}</Alert>
      </template>

      <p v-else class="text-caption text-ink-2">{{ versionStatus.reason }}</p>
    </Card>

    <Card
      v-if="application.templateStatus === 'deprecated'"
      title="Template update"
      description="This template was taken off the marketplace catalog."
    >
      <Alert theme="warning">
        The template this application was created from is no longer listed in the catalog, so no
        update is offered. It keeps running exactly as deployed.
      </Alert>
    </Card>

    <Card
      v-else-if="application.templateStatus === 'update-available' && templateUpdatePreview"
      title="Template update"
      :description="`v${templateUpdatePreview.installedVersion} installed, v${templateUpdatePreview.availableVersion} available.`"
    >
      <div class="flex flex-col gap-3.5">
        <div
          v-if="
            templateUpdatePreview.variables &&
            (templateUpdatePreview.variables.added.length ||
              templateUpdatePreview.variables.removed.length)
          "
          class="flex flex-col gap-1 font-mono text-[12.5px]"
        >
          <div
            v-for="key in templateUpdatePreview.variables.added"
            :key="`added-${key}`"
            class="text-live-ink"
          >
            + {{ key }}
          </div>
          <div
            v-for="key in templateUpdatePreview.variables.removed"
            :key="`removed-${key}`"
            class="text-failed"
          >
            - {{ key }}
          </div>
        </div>

        <div
          v-if="templateUpdatePreview.composeDiff"
          class="max-h-[40vh] overflow-auto rounded-control bg-terminal p-4 font-mono text-[12.5px] leading-[1.7]"
        >
          <div
            v-for="(line, index) in templateUpdatePreview.composeDiff"
            :key="index"
            class="whitespace-pre"
            :class="{
              'bg-live-bg text-live-ink': line.type === 'added',
              'bg-failed/10 text-failed': line.type === 'removed',
              'text-white/70': line.type === 'context',
            }"
          >
            {{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}
            {{ line.content }}
          </div>
        </div>

        <TemplateInputFields
          v-if="requiredNewInputs.length"
          :inputs="requiredNewInputs"
          :values="templateUpdateInputValues"
          @update:value="(key, value) => (templateUpdateInputValues[key] = value)"
        />

        <Alert v-if="templateUpdatePreview.manuallyEdited" theme="error">
          The compose file was edited by hand — applying this update overwrites that edit and it
          cannot be recovered.
        </Alert>

        <label
          v-if="templateUpdatePreview.manuallyEdited"
          class="flex items-center gap-2 text-caption text-ink-2"
        >
          <Checkbox v-model="confirmManualOverwrite" />
          I understand the manual edit will be discarded.
        </label>

        <Alert v-if="templateUpdateError" theme="error">{{ templateUpdateError }}</Alert>

        <Button
          v-if="canManage"
          theme="secondary"
          size="sm"
          class="self-start"
          :disabled="applyingTemplateUpdate || !canApplyTemplateUpdate"
          @click="applyTemplateUpdateNow"
        >
          <Icon v-if="applyingTemplateUpdate" name="svg-spinners:tadpole" size="16" />
          Update template
        </Button>
      </div>
    </Card>

    <Card
      title="docker-compose.yml"
      description="Exactly what the template or the pasted file declares — read-only, no secrets in this file."
    >
      <template #right>
        <Tag
          v-if="application.templateStatus === 'update-available'"
          color="attn"
          title="The embedded catalog has a newer version of this template — it will ship with the next Zydock update."
        >
          Template update available
        </Tag>
      </template>

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

    <Modal :open="confirmOpen" @on-close-modal="handleCloseConfirm">
      <Card
        :title="confirmTitle"
        class="w-[32rem] max-w-full"
        close-button
        @on-close="handleCloseConfirm"
      >
        <p class="text-sm text-ink-2">{{ confirmMessage }}</p>

        <p v-if="isDowngrade && hasDatabases" class="mt-3 text-sm text-ink-2">
          Back up the database before downgrading —
          <NuxtLink to="/backups" class="text-accent underline">create a backup</NuxtLink>.
        </p>

        <template #footer>
          <div class="ml-auto flex items-center gap-2">
            <Button theme="quiet" type="button" :disabled="applying" @click="handleCloseConfirm">
              Cancel
            </Button>
            <Button
              :theme="isDowngrade ? 'destructive' : 'primary'"
              type="button"
              :disabled="applying"
              @click="applyVersion"
            >
              <Icon v-if="applying" name="svg-spinners:tadpole" size="16" />
              {{ isDowngrade ? 'Downgrade' : 'Update' }}
            </Button>
          </div>
        </template>
      </Card>
    </Modal>
  </div>
</template>
