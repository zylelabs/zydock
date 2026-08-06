<script setup lang="ts">
  import { z } from 'zod';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import type { Organization } from '~/stores/organization.store';

  const props = defineProps<{
    organization: Organization;
    canManage: boolean;
    memberCount: number;
  }>();

  const toast = useToast();
  const { update } = useOrganizations();

  const editing = ref(false);

  const form = useSchemaForm(
    z.object({ name: z.string().trim().min(1, 'Enter a name') }),
    { name: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const startEdit = () => {
    form.values.name = props.organization.name;
    editing.value = true;
  };

  const handleSave = form.submit(async values => {
    await update(props.organization.id, { name: values.name });
    editing.value = false;
  });

  const formatDate = (value: string) => new Date(value).toLocaleDateString('en-US');
</script>

<template>
  <Card title="General" content-class="p-0">
    <template v-if="canManage" #right>
      <Button v-if="!editing" theme="secondary" size="xs" @click="startEdit">Edit</Button>
    </template>

    <template v-if="!editing">
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Name</div>
        <div class="truncate text-[13px] text-ink">{{ organization.name }}</div>
      </Row>
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Slug</div>
        <div class="truncate font-mono text-[13px] text-ink">{{ organization.slug }}</div>
      </Row>
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Created</div>
        <div class="text-[13px] text-ink">{{ formatDate(organization.createdAt) }}</div>
      </Row>
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Your role</div>
        <Tag class="capitalize">{{ organization.role }}</Tag>
      </Row>
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Members</div>
        <div class="text-[13px] text-ink">{{ memberCount }}</div>
      </Row>
    </template>

    <form v-else class="flex flex-col gap-1.5 p-4.25" @submit.prevent="handleSave">
      <Input v-model="form.values.name" label="Name" :call-error="form.errors.value.name" />

      <div class="mt-1 flex justify-end gap-2">
        <Button theme="quiet" type="button" @click="editing = false">Cancel</Button>
        <Button theme="primary" size="sm" type="submit" :disabled="form.loading.value">
          <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
          Save
        </Button>
      </div>
    </form>
  </Card>
</template>
