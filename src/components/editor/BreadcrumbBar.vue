<script setup lang="ts">
import { computed } from 'vue'
import { FileText } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'

const editorStore = useEditorStore()
const filesStore = useFilesStore()

const activeId = computed(() => editorStore.activeDocumentId)

const ancestors = computed(() => {
  if (!activeId.value) return []
  return filesStore.getAncestorPath(activeId.value)
})

const fileName = computed(() => {
  if (!activeId.value) return ''
  const entry = filesStore.entries.find((e) => e.id === activeId.value)
  return entry?.name.replace(/\.[^.]+$/, '') ?? ''
})

function selectFolder(id: string) {
  filesStore.selectFolder(id)
}
</script>

<template>
  <div
    v-if="activeId"
    class="h-7 px-3 flex items-center gap-1 border-b border-border-subtle bg-surface shrink-0 overflow-hidden"
  >
    <template v-for="segment in ancestors" :key="segment.id">
      <button
        class="text-xs font-ui text-text-muted hover:text-text-secondary transition-colors duration-75 max-w-[120px] truncate shrink-0 cursor-pointer"
        :title="segment.name"
        @click="selectFolder(segment.id)"
      >
        {{ segment.name }}
      </button>
      <span class="text-text-muted text-xs shrink-0 select-none">/</span>
    </template>

    <FileText :size="14" class="text-accent shrink-0" />
    <span
      class="text-xs font-ui font-medium text-text-secondary max-w-[200px] truncate shrink-0"
      :title="fileName"
    >
      {{ fileName }}
    </span>
  </div>
</template>
