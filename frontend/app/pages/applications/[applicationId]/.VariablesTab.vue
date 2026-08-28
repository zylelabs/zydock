<script setup lang="ts">
  import {
    useApplications,
    type Application,
    type ApplicationVariable,
  } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const session = useSessionStore();
  const applicationsApi = useApplications();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const {
    data,
    status,
    refresh: refreshVariables,
  } = useLazyAsyncData(
    () => `application-${props.application.id}-variables`,
    () =>
      session.organizationId
        ? applicationsApi.listVariables(props.application.id)
        : Promise.resolve({ variables: [] }),
    {
      server: false,
      watch: [() => session.organizationId, () => props.application.id],
      default: () => ({ variables: [] }),
    },
  );

  const isFirstLoad = useFirstLoad(status);

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

  const addVar = () =>
    draft.value.push({ key: '', value: '', secret: false, build: false, buildSecret: false });
  const removeVar = (index: number) => draft.value.splice(index, 1);

  const onBuildToggle = (variable: ApplicationVariable) => {
    if (!variable.build) {
      variable.buildSecret = false;
    }
  };

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

  const injectingArgs = ref(false);
  const injectError = ref('');

  const setInjectBuildArgs = async (value: boolean) => {
    injectError.value = '';
    injectingArgs.value = true;

    try {
      await applicationsApi.update(props.application.id, { git: { injectBuildArgs: value } });
      emit('refresh');
    } catch (error) {
      injectError.value = messageOf(error, 'Failed to update the setting.');
    } finally {
      injectingArgs.value = false;
    }
  };
</script>

<template>
  <div class="max-w-205">
    <Alert v-if="application.unconsumedBuildArgs?.length" theme="warning" class="mb-4.5">
      <p>
        The Dockerfile does not declare
        <b>{{ application.unconsumedBuildArgs.join(', ') }}</b>
        as <code>ARG</code>, so the build passes the value but Docker discards it.
      </p>

      <p v-if="application.git?.injectBuildArgs" class="mt-2">
        Automatic <code>ARG</code> injection is <b>on</b> for this application.
        <Button
          theme="secondary"
          size="xs"
          :disabled="injectingArgs"
          @click="setInjectBuildArgs(false)"
        >
          <Icon v-if="injectingArgs" name="svg-spinners:tadpole" size="16" />
          Turn off
        </Button>
      </p>
      <template v-else>
        <p class="mt-2">
          Zydock can build from a <b>copy</b> of the Dockerfile with
          <code>ARG &lt;KEY&gt;</code> added after each <code>FROM</code>. The repository is not
          touched, and this only takes effect on the next deploy.
        </p>
        <Button
          class="mt-2"
          theme="secondary"
          size="xs"
          :disabled="injectingArgs"
          @click="setInjectBuildArgs(true)"
        >
          <Icon v-if="injectingArgs" name="svg-spinners:tadpole" size="16" />
          Declare ARG automatically
        </Button>
      </template>

      <p v-if="injectError" class="mt-2 text-failed">{{ injectError }}</p>
    </Alert>

    <Alert v-if="application.unconsumedBuildSecrets?.length" theme="warning" class="mb-4.5">
      <p>
        The Dockerfile does not mount
        <b>{{ application.unconsumedBuildSecrets.join(', ') }}</b>
        as a BuildKit secret, so the value never reaches the build.
      </p>
      <p class="mt-2">
        Add this to the stage that needs it:
        <code
          v-for="key in application.unconsumedBuildSecrets"
          :key="key"
          class="mt-1 block w-fit rounded bg-canvas-2 px-2 py-1"
        >
          RUN --mount=type=secret,id={{ key }} ...
        </code>
      </p>
    </Alert>

    <Card title="Environment variables" content-class="p-0">
      <template v-if="canManage" #right>
        <Button v-if="!editingVars" theme="secondary" size="xs" @click="startEditVars">Edit</Button>
      </template>

      <template v-if="!editingVars">
        <template v-if="isFirstLoad">
          <SkeletonRow v-for="index in 3" :key="index" />
        </template>

        <EmptyState
          v-else-if="!variables.length"
          variant="prompt"
          description="No variables defined."
          class="m-2.5"
        />

        <Row v-for="variable in variables" :key="variable.key" as="div" class="flex items-center">
          <div class="w-52.5 shrink-0 truncate font-mono text-caption text-ink">
            {{ variable.key }}
          </div>
          <div class="min-w-0 flex-1 truncate font-mono text-caption text-ink-2">
            {{ shownValue(variable) }}
          </div>
          <Tag v-if="variable.buildSecret">build secret</Tag>
          <Tag v-else-if="variable.build">build</Tag>
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
            Values are encrypted at rest on the server that runs the container. Variables marked
            <b>build</b> are passed as <code>--build-arg</code> during the image build, and their
            value stays visible in <code>docker history</code>. Variables marked
            <b>build secret</b> are passed as a BuildKit <code>--secret</code> instead — they never
            land in an image layer, but the Dockerfile must mount them with
            <code>RUN --mount=type=secret</code>. Changes only take effect on the next deploy.
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
          <label
            v-if="application.source === 'git'"
            class="flex cursor-pointer items-center gap-1.5 text-caption text-ink-2"
          >
            <Checkbox v-model="variable.build" @change="onBuildToggle(variable)" />
            build
          </label>
          <label
            v-if="application.source === 'git'"
            class="flex cursor-pointer items-center gap-1.5 text-caption text-ink-2"
            :class="{ 'opacity-40': !variable.build }"
          >
            <Checkbox v-model="variable.buildSecret" :disabled="!variable.build" />
            as BuildKit secret
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
