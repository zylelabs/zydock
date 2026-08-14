<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const applicationsApi = useApplications();
  const session = useSessionStore();
  const recentApplications = useRecentApplicationsStore();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const confirmDeleteOpen = ref(false);
  const deletingApp = ref(false);
  const deleteError = ref('');

  const handleDeleteApplication = async () => {
    deleteError.value = '';
    deletingApp.value = true;

    try {
      const projectId = props.application.projectId;

      await applicationsApi.remove(props.application.id);

      if (session.organizationId) {
        recentApplications.remove(session.organizationId, props.application.id);
      }

      await navigateTo(projectId ? `/projects/${projectId}` : '/projects');
    } catch (error) {
      deleteError.value = messageOf(error, 'Failed to delete the application.');
      deletingApp.value = false;
    }
  };
</script>

<template>
  <div class="flex max-w-205 flex-col gap-4.5">
    <GitCredentialsCard
      v-if="application.source === 'git'"
      :application="application"
      @refresh="emit('refresh')"
    />
    <ResourcesCard
      v-if="application.source === 'git'"
      :application="application"
      :can-manage="canManage"
      @refresh="emit('refresh')"
    />

    <div
      v-if="canManage"
      class="flex items-center gap-4 rounded-card border border-failed/30 bg-failed/5 p-4.25"
    >
      <div class="flex-1">
        <div class="text-caption font-semibold text-failed">Delete application</div>
        <div class="mt-0.75 text-caption text-ink-2">
          Container, volumes and deployment history are removed. This cannot be undone.
        </div>
        <Alert v-if="deleteError" theme="error" class="mt-2">{{ deleteError }}</Alert>
      </div>
      <Button theme="destructive" size="sm" class="shrink-0" @click="confirmDeleteOpen = true">
        Delete
      </Button>
    </div>

    <Confirm
      v-model:open="confirmDeleteOpen"
      title="Delete application"
      :message="`Delete “${application.name}”? Its deployments and domains are removed too. This cannot be undone.`"
      confirm-label="Delete"
      danger
      :loading="deletingApp"
      @confirm="handleDeleteApplication"
    />
  </div>
</template>
