<script setup lang="ts">
  import { z } from 'zod';
  import { useOrganizations } from '~/composables/services/useOrganizations';

  const toast = useToast();
  const { organizations, current, select, create } = useOrganizations();

  const dropdownRef = ref<{ dropdownOpened: boolean } | null>(null);
  const creating = ref(false);

  const label = computed(() => current.value?.name ?? 'Select an organization');

  const closeDropdown = () => {
    if (dropdownRef.value) {
      dropdownRef.value.dropdownOpened = false;
    }
  };

  const choose = (organizationId: string) => {
    const organization = organizations.value.find(item => item.id === organizationId);

    if (organization) {
      select(organization);
    }

    closeDropdown();
  };

  const form = useSchemaForm(
    z.object({ name: z.string().trim().min(2, 'At least 2 characters') }),
    { name: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const openCreate = () => {
    form.reset();
    creating.value = true;
    closeDropdown();
  };

  const handleCreate = form.submit(async values => {
    await create(values.name);

    creating.value = false;
  });
</script>

<template>
  <div>
    <Dropdown ref="dropdownRef" alignment-x="right" content-class="w-full min-w-64">
      <template #button>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-1 text-left transition-colors hover:bg-surface-hover/60"
        >
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-linear-to-br from-primary to-primary-strong text-sm font-semibold text-white"
          >
            {{ label.charAt(0).toUpperCase() }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15px] font-semibold text-content-strong">
              {{ label }}
            </span>
            <span v-if="current?.role" class="block text-xs text-content-muted capitalize">
              {{ current.role }}
            </span>
          </span>
          <Icon name="lucide:chevrons-up-down" class="size-4 shrink-0 text-content-muted" />
        </button>
      </template>

      <div class="flex flex-col">
        <button
          v-for="organization in organizations"
          :key="organization.id"
          type="button"
          class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover"
          @click.stop="choose(organization.id)"
        >
          <span class="truncate">{{ organization.name }}</span>
          <Icon
            v-if="organization.id === current?.id"
            name="lucide:check"
            class="size-4 shrink-0 text-primary"
          />
        </button>

        <p v-if="!organizations.length" class="px-3 py-2 text-xs text-content-muted">
          You don't belong to any organization yet.
        </p>

        <div class="my-1 border-t border-surface-border" />

        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-content-muted transition-colors hover:bg-surface-hover hover:text-content-strong"
          @click.stop="openCreate"
        >
          <Icon name="lucide:plus" class="size-4" />
          Create organization
        </button>
      </div>
    </Dropdown>

    <Modal :open="creating" @on-close-modal="creating = false">
      <Card
        title="Create organization"
        description="A space for your projects, servers, and team."
        class="w-md max-w-full"
        close-button
        @on-close="creating = false"
      >
        <form class="flex flex-col gap-4" @submit.prevent="handleCreate">
          <Input
            v-model="form.values.name"
            label="Name"
            placeholder="My company"
            :call-error="form.errors.value.name"
          />

          <div class="flex justify-end gap-2">
            <Button theme="ghost" type="button" @click="creating = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="form.loading.value">
              <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
              Create
            </Button>
          </div>
        </form>
      </Card>
    </Modal>
  </div>
</template>
