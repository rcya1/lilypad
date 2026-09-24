<!-- Breadcrumb trail for the reader: folder / … / current note, styled like the editor's
     BreadcrumbBar so the trail sits in the same place in both modes. A folder crumb asks the shell to
     reveal that folder in the sidebar. -->
<script setup lang="ts">
import { FileText } from 'lucide-vue-next'

defineProps<{ ancestors: { id: string; name: string }[]; current: string }>()
const emit = defineEmits<{ folder: [id: string] }>()
</script>

<template>
  <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-1">
    <template v-for="folder in ancestors" :key="folder.id">
      <button
        class="max-w-[120px] shrink-0 cursor-pointer truncate font-ui text-xs text-text-muted transition-colors duration-75 hover:text-text-secondary"
        :title="folder.name"
        @click="emit('folder', folder.id)"
      >
        {{ folder.name }}
      </button>
      <span class="shrink-0 text-xs text-text-muted select-none">/</span>
    </template>
    <FileText :size="14" class="shrink-0 text-accent" />
    <span
      class="max-w-[200px] shrink-0 truncate font-ui text-xs font-medium text-text-secondary"
      :title="current"
      aria-current="page"
    >
      {{ current }}
    </span>
  </nav>
</template>
