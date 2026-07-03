<!-- Modal for choosing a destination folder during a bulk move; emits the selected folder ID (or null for root) on confirm. -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Folder, X } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'

const emit = defineEmits<{
  /** Emitted with the selected folder ID, or null to move to the workspace root. */
  confirm: [targetFolderId: string | null]
  cancel: []
}>()

const filesStore = useFilesStore()
// null means "Root" (workspace top level).
const selected = ref<string | null>(null)

interface FolderItem {
  id: string
  name: string
  /** Visual indent depth used to show folder hierarchy without a tree component. */
  depth: number
}

/**
 * Produces a flat, depth-annotated list of all folders via a depth-first walk,
 * sorted by sort_order then name at each level. This allows rendering the
 * folder hierarchy as a simple flat list with left-padding for indentation.
 */
const folderList = computed<FolderItem[]>(() => {
  const result: FolderItem[] = []
  function walk(parentId: string | null, depth: number) {
    const children = filesStore.entries
      .filter((e) => e.parent_id === parentId && e.kind === 'directory')
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    for (const folder of children) {
      result.push({ id: folder.id, name: folder.name, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      @click.self="emit('cancel')"
    >
      <div class="bg-surface border border-border rounded-lg shadow-xl w-72 flex flex-col max-h-96">
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <span class="text-sm font-medium text-text-primary font-ui">Move to folder</span>
          <button
            class="text-text-muted hover:text-text-primary cursor-pointer"
            @click="emit('cancel')"
          >
            <X :size="15" />
          </button>
        </div>

        <!-- Folder list -->
        <div class="flex-1 overflow-y-auto py-1">
          <!-- Root option -->
          <button
            class="w-full text-left flex items-center gap-2 px-4 py-1.5 text-xs font-ui transition-colors duration-75 cursor-pointer"
            :class="
              selected === null
                ? 'bg-surface-overlay text-text-primary'
                : 'text-text-secondary hover:bg-surface-elevated'
            "
            @click="selected = null"
          >
            <Folder :size="15" class="text-amber shrink-0" />
            <span class="truncate">Root</span>
          </button>

          <button
            v-for="folder in folderList"
            :key="folder.id"
            class="w-full text-left flex items-center gap-2 py-1.5 text-xs font-ui transition-colors duration-75 cursor-pointer"
            :style="{ paddingLeft: folder.depth * 12 + 16 + 'px', paddingRight: '16px' }"
            :class="
              selected === folder.id
                ? 'bg-surface-overlay text-text-primary'
                : 'text-text-secondary hover:bg-surface-elevated'
            "
            @click="selected = folder.id"
          >
            <Folder :size="15" class="text-amber shrink-0" />
            <span class="truncate">{{ folder.name }}</span>
          </button>

          <div v-if="folderList.length === 0" class="px-4 py-3 text-xs text-text-muted text-center">
            No folders yet
          </div>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
          <button
            class="px-3 py-1.5 text-xs font-ui text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded transition-colors duration-75 cursor-pointer"
            @click="emit('cancel')"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs font-ui bg-accent text-white rounded hover:bg-accent/90 transition-colors duration-75 cursor-pointer"
            @click="emit('confirm', selected)"
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
