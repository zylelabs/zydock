<script setup lang="ts">
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import type { Organization } from '~/stores/organization.store';

  const props = defineProps<{ organization: Organization; isOwner: boolean }>();

  const toast = useToast();
  const { remove } = useOrganizations();

  const confirmDeleteOpen = ref(false);
  const deleting = ref(false);

  const onDelete = async () => {
    deleting.value = true;

    try {
      await remove(props.organization.id);
      confirmDeleteOpen.value = false;
      await navigateTo('/');
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to delete the organization.',
      });
    } finally {
      deleting.value = false;
    }
  };
</script>

<template>
  <Card v-if="!isOwner" title="Danger zone">
    <p class="text-[13px] text-ink-2">Only the owner can delete the organization.</p>
  </Card>

  <div
    v-else
    class="flex items-center gap-4 rounded-card border border-failed/40 bg-failed/5 px-4.25 py-3.25"
  >
    <div class="flex-1">
      <div class="text-[13px] font-semibold text-failed">Delete organization</div>
      <div class="mt-0.75 text-caption text-ink-2">
        Deletes every project, application, server and database inside it. This cannot be undone.
      </div>
    </div>
    <Button theme="destructive" size="sm" @click="confirmDeleteOpen = true">Delete</Button>
  </div>

  <Confirm
    v-model:open="confirmDeleteOpen"
    title="Delete organization"
    :message="`This permanently deletes “${organization.name}” and everything inside it: projects, applications, servers and databases.`"
    confirm-label="Delete"
    :confirm-text="organization.name"
    danger
    :loading="deleting"
    @confirm="onDelete"
  />
</template>
