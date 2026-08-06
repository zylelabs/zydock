<script setup lang="ts">
  import {
    useApplications,
    type Application,
    type ApplicationVariable,
  } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();

  const session = useSessionStore();
  const applicationsApi = useApplications();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const { data, refresh: refreshVariables } = await useAsyncData(
    () => `application-${props.application.id}-variables`,
    () =>
      session.organizationId
        ? applicationsApi.listVariables(props.application.id)
        : Promise.resolve({ variables: [] }),
    { server: false, watch: [() => session.organizationId, () => props.application.id] },
  );

  const variables = computed(() => data.value?.variables ?? []);

  const revealed = ref<Record<string, boolean>>({});
  const toggleReveal = (key: string) => (revealed.value[key] = !revealed.value[key]);
  const shownValue = (variable: ApplicationVariable) =>
    !variable.secret || revealed.value[variable.key] ? (variable.value ?? '') : '••••••••';

  const editingVars = ref(false);
  const draft = ref<ApplicationVariable[]>([]);
  const savingVars = ref(false);
  const varsError = ref('');

  const startEditVars = () => {
    draft.value = variables.value.map(variable => ({ ...variable }));
    varsError.value = '';
    editingVars.value = true;
  };

  const addVar = () => draft.value.push({ key: '', value: '', secret: false });
  const removeVar = (index: number) => draft.value.splice(index, 1);

  const saveVars = async () => {
    varsError.value = '';
    savingVars.value = true;

    try {
      await applicationsApi.replaceVariables(
        props.application.id,
        draft.value.filter(variable => variable.key.trim()),
      );

      editingVars.value = false;
      await refreshVariables();
    } catch (error) {
      varsError.value = messageOf(error, 'Failed to save the variables.');
    } finally {
      savingVars.value = false;
    }
  };
</script>

<template>
  <div class="max-w-205">
    <Card title="Environment variables" content-class="p-0">
      <template v-if="canManage" #right>
        <Button v-if="!editingVars" theme="secondary" size="xs" @click="startEditVars">Edit</Button>
      </template>

      <template v-if="!editingVars">
        <EmptyState
          v-if="!variables.length"
          variant="prompt"
          description="No variables defined."
          class="m-2.5"
        />

        <Row v-for="variable in variables" :key="variable.key" as="div" class="flex items-center">
          <div class="w-52.5 shrink-0 truncate font-mono text-[13px] text-ink">
            {{ variable.key }}
          </div>
          <div class="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-2">
            {{ shownValue(variable) }}
          </div>
          <Button
            v-if="variable.secret"
            theme="secondary"
            size="xs"
            @click="toggleReveal(variable.key)"
          >
            {{ revealed[variable.key] ? 'Hide' : 'Show' }}
          </Button>
        </Row>

        <Row as="div" class="flex items-center">
          <p class="text-caption text-ink-3">
            Values are encrypted at rest on the server that runs the container.
          </p>
        </Row>
      </template>

      <div v-else class="flex flex-col">
        <Alert v-if="varsError" theme="error" class="mx-4.25 mt-3">{{ varsError }}</Alert>

        <div
          v-for="(variable, index) in draft"
          :key="index"
          class="flex items-center gap-2 border-b border-hairline px-4.25"
        >
          <Input v-model="variable.key" class="flex-1" placeholder="KEY" mono boxed bare />
          <Input v-model="variable.value" class="flex-1" placeholder="value" mono boxed bare />
          <label class="flex cursor-pointer items-center gap-1.5 text-caption text-ink-2">
            <Checkbox v-model="variable.secret" />
            secret
          </label>
          <button
            type="button"
            class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:text-failed"
            @click="removeVar(index)"
          >
            <Icon name="lucide:x" class="size-3.5" />
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2 px-4.25 py-3.25">
          <Button theme="quiet" size="sm" @click="addVar">
            <Icon name="proicons:add" size="16" />
            Add
          </Button>
          <div class="ml-auto flex items-center gap-2">
            <Button theme="quiet" size="sm" @click="editingVars = false">Cancel</Button>
            <Button theme="primary" size="sm" :disabled="savingVars" @click="saveVars">
              <Icon v-if="savingVars" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </div>
      </div>
    </Card>
  </div>
</template>
