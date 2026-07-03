<!-- Gallery view of all images in the workspace, grouped by folder with independent expand/collapse state. -->
<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-vue-next'
import ImageNode from './ImageNode.vue'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { draggingEntry, PENDING_ID } from '@/composables/useDragDrop'
import { useToastStore } from '@/stores/toast'

const filesStore = useFilesStore()
const uiStore = useUiStore()
const toast = useToastStore()

// Folder expand state is local to the images tab and independent of the file
// explorer's collapsedFolderIds, so toggling here doesn't affect the file tree.
const expandedFolders = ref(new Set<string>())

function toggleFolder(id: string) {
  if (expandedFolders.value.has(id)) {
    expandedFolders.value.delete(id)
  } else {
    expandedFolders.value.add(id)
  }
}

const isRootDropTarget = ref(false)

/**
 * Returns a sort_order value that appends after all current root entries.
 * +1000 gaps leave room for future insertions without renumbering.
 */
function getRootAppendOrder(): number {
  const roots = filesStore.entries
    .filter((e) => e.parent_id === null)
    .sort((a, b) => a.sort_order - b.sort_order)
  return roots.length === 0 ? 1000 : Math.max(...roots.map((e) => e.sort_order)) + 1000
}

/**
 * Handles dropping an image (or multi-selected set) onto the empty root area.
 * When multi-selecting, only moves "top-level" entries (skips those whose ancestor
 * is also in the selection) to avoid moving a subtree twice.
 */
async function onRootDrop(e: DragEvent) {
  e.preventDefault()
  isRootDropTarget.value = false
  const entry = draggingEntry.value
  if (!entry || entry.id === PENDING_ID) return
  draggingEntry.value = null

  const dragId = entry.id
  const baseOrder = getRootAppendOrder()

  if (filesStore.selectedIds.size >= 2 && filesStore.selectedIds.has(dragId)) {
    const idSet = filesStore.selectedIds
    // Filter out entries whose ancestor is also in the selection set.
    const topLevel = [...idSet].filter((id) => {
      let parentId = filesStore.entries.find((e) => e.id === id)?.parent_id ?? null
      while (parentId) {
        if (idSet.has(parentId)) return false
        parentId = filesStore.entries.find((e) => e.id === parentId)?.parent_id ?? null
      }
      return true
    })
    const snapshot = topLevel.map((id) => {
      const e = filesStore.entries.find((en) => en.id === id)
      return { id, label: e ? e.name.replace(/\.[^.]+$/, '') : id }
    })
    const failed: typeof snapshot = []
    for (let i = 0; i < topLevel.length; i++) {
      // Pass checkConflict=true to detect name collisions at the root level.
      const ok = await filesStore.moveEntry(topLevel[i]!, null, baseOrder + i, true)
      if (!ok) failed.push(snapshot[i]!)
    }
    if (failed.length > 0) {
      const names = failed.map((f) => `"${f.label}"`).join(', ')
      toast.addToast(`Couldn't move ${names} to root: name conflict.`, 'error')
    }
    return
  }

  filesStore.moveEntry(dragId, null, baseOrder)
}

const totalFolderCount = computed(
  () => filesStore.entries.filter((e) => e.kind === 'directory').length,
)
// anyExpanded checks whether any folder (by its ID) appears in the local expandedFolders set.
const anyExpanded = computed(() => {
  const folderIds = filesStore.entries.filter((e) => e.kind === 'directory').map((e) => e.id)
  return folderIds.some((id) => expandedFolders.value.has(id))
})

function expandAll() {
  const folderIds = filesStore.entries.filter((e) => e.kind === 'directory').map((e) => e.id)
  expandedFolders.value = new Set(folderIds)
}

function collapseAll() {
  expandedFolders.value = new Set()
}

/**
 * Expands every ancestor folder of the given entry so it becomes visible in the tree.
 * Used before scrolling to a highlighted image.
 */
function expandPathTo(entryId: string) {
  const ancestors = filesStore.getAncestorPath(entryId)
  for (const ancestor of ancestors) {
    expandedFolders.value.add(ancestor.id)
  }
}

// When the editor highlights an image (e.g. after inserting via paste), reveal
// it in the images tab and scroll it into view. nextTick ensures the DOM has
// re-rendered with the expanded folders before querying the element.
watch(
  () => uiStore.highlightedImageId,
  async (id) => {
    if (!id) return
    expandPathTo(id)
    await nextTick()
    const el = document.querySelector(`[data-image-id="${id}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  },
)
</script>

<template>
  <div class="flex-1 flex flex-col overflow-y-auto" @click.self="filesStore.clearSelection()">
    <div class="flex items-center justify-between px-3 py-2">
      <span class="text-xs font-medium text-text-muted uppercase tracking-widest">Images</span>
      <div class="flex items-center gap-0.5">
        <button
          v-if="totalFolderCount > 0"
          class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :title="anyExpanded ? 'Collapse all' : 'Expand all'"
          @click="anyExpanded ? collapseAll() : expandAll()"
        >
          <ChevronsDownUp v-if="anyExpanded" :size="16" />
          <ChevronsUpDown v-else :size="16" />
        </button>
      </div>
    </div>

    <div v-if="filesStore.loading" class="px-3 space-y-2">
      <div v-for="i in 3" :key="i" class="h-6 bg-surface-elevated rounded animate-pulse" />
    </div>

    <div v-else-if="filesStore.imageTree.length === 0" class="px-3 py-4">
      <p class="text-xs text-text-muted text-center">No images yet</p>
      <p class="text-xs text-text-muted text-center mt-1">Paste or drop images into the editor</p>
    </div>

    <div v-else class="text-sm select-none">
      <ImageNode
        v-for="entry in filesStore.imageTree"
        :key="entry.id"
        :entry="entry"
        :depth="0"
        :expanded-folders="expandedFolders"
        @toggle-folder="toggleFolder"
      />
    </div>

    <!-- Empty-space drop zone — fills remaining height, shows line at top when active -->
    <div
      class="flex-1 min-h-4 relative"
      @click="filesStore.clearSelection()"
      @dragover.prevent="isRootDropTarget = true"
      @dragleave="isRootDropTarget = false"
      @drop="onRootDrop"
    >
      <div
        v-if="isRootDropTarget"
        class="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-full pointer-events-none"
      />
    </div>
  </div>
</template>
