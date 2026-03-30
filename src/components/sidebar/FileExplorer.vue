<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { FilePlus, FolderPlus, ChevronsDownUp, ChevronsUpDown } from 'lucide-vue-next'
import FileExplorerNode from './FileExplorerNode.vue'
import PendingInputRow from './PendingInputRow.vue'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { draggingEntry, PENDING_ID } from '@/composables/useDragDrop'
import { useToastStore } from '@/stores/toast'

const files = useFilesStore()
const editorStore = useEditorStore()
const toast = useToastStore()

const totalFolderCount = computed(() => files.entries.filter((e) => e.kind === 'directory').length)
const anyExpanded = computed(() => files.collapsedFolderIds.size < totalFolderCount.value)
const newName = ref('')

const isRootDropTarget = ref(false)

function getRootAppendOrder(): number {
  const roots = files.entries
    .filter((e) => e.parent_id === null)
    .sort((a, b) => a.sort_order - b.sort_order)
  return roots.length === 0 ? 1000 : Math.max(...roots.map((e) => e.sort_order)) + 1000
}

async function onRootDrop(e: DragEvent) {
  e.preventDefault()
  isRootDropTarget.value = false
  const entry = draggingEntry.value
  if (!entry || entry.id === PENDING_ID) return
  draggingEntry.value = null

  const dragId = entry.id
  const baseOrder = getRootAppendOrder()

  if (files.selectedIds.size >= 2 && files.selectedIds.has(dragId)) {
    const idSet = files.selectedIds
    const topLevel = [...idSet].filter((id) => {
      let parentId = files.entries.find((e) => e.id === id)?.parent_id ?? null
      while (parentId) {
        if (idSet.has(parentId)) return false
        parentId = files.entries.find((e) => e.id === parentId)?.parent_id ?? null
      }
      return true
    })
    const snapshot = topLevel.map((id) => {
      const e = files.entries.find((en) => en.id === id)
      return { id, label: e ? e.name.replace(/\.[^.]+$/, '') : id }
    })
    const failed: typeof snapshot = []
    for (let i = 0; i < topLevel.length; i++) {
      const ok = await files.moveEntry(topLevel[i]!, null, baseOrder + i, true)
      if (!ok) failed.push(snapshot[i]!)
    }
    if (failed.length > 0) {
      const names = failed.map((f) => `"${f.label}"`).join(', ')
      toast.addToast(`Couldn't move ${names} to root: name conflict.`, 'error')
    }
    return
  }

  files.moveEntry(dragId, null, baseOrder)
}

const showEmptyContextMenu = ref(false)
const emptyContextMenuPos = ref({ x: 0, y: 0 })

function onEmptyAreaContextMenu(e: MouseEvent) {
  // Only fire when clicking the scrollable container itself, not a child entry
  if (e.target !== e.currentTarget) return
  e.preventDefault()
  emptyContextMenuPos.value = { x: e.clientX, y: e.clientY }
  showEmptyContextMenu.value = true
  const close = () => {
    showEmptyContextMenu.value = false
    window.removeEventListener('click', close)
  }
  setTimeout(() => window.addEventListener('click', close), 0)
}

function emptyAreaNewFile() {
  showEmptyContextMenu.value = false
  files.triggerCreate(null, 'file', null)
}

function emptyAreaNewFolder() {
  showEmptyContextMenu.value = false
  files.triggerCreate(null, 'folder', null)
}

onMounted(async () => {
  if (files.entries.length > 0) return
  await files.fetchEntries()
  await files.seedWelcomeFile()
})

const showRootInput = computed(() => files.pendingCreate?.parentId === null)

watch(showRootInput, (val, _old, onCleanup) => {
  if (val) {
    newName.value = ''
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('[data-pending-input]')) {
        files.clearPendingCreate()
      }
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    onCleanup(() => document.removeEventListener('mousedown', handler))
  }
})

function getInsertBelowActive(): {
  parentId: string | null
  insertBefore: string | null
} | null {
  const activeId = editorStore.activeDocumentId
  if (!activeId) return null
  const activeEntry = files.entries.find((e) => e.id === activeId)
  if (!activeEntry) return null
  const siblings = files.entries
    .filter((e) => e.parent_id === activeEntry.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const idx = siblings.findIndex((s) => s.id === activeEntry.id)
  const insertBefore = idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1]!.id : null
  return { parentId: activeEntry.parent_id, insertBefore }
}

function startNewFile() {
  const folderId = files.selectedFolderId
  if (folderId) {
    files.triggerCreate(folderId, 'file')
  } else {
    const below = getInsertBelowActive()
    files.triggerCreate(below?.parentId ?? null, 'file', below?.insertBefore ?? null)
  }
}

function startNewFolder() {
  const folderId = files.selectedFolderId
  if (folderId) {
    files.triggerCreate(folderId, 'folder')
  } else {
    const below = getInsertBelowActive()
    files.triggerCreate(below?.parentId ?? null, 'folder', below?.insertBefore ?? null)
  }
}

async function submitNew() {
  const name = newName.value.trim()
  if (!name) {
    files.clearPendingCreate()
    return
  }
  const pending = files.pendingCreate!
  const sortOrder = files.getPendingSortOrder()
  if (pending.type === 'file') {
    const finalName = name.endsWith('.md') ? name : `${name}.md`
    await files.createDocument(finalName, 'md', pending.parentId, sortOrder)
  } else {
    await files.createDirectory(name, pending.parentId, sortOrder)
  }
  newName.value = ''
  files.clearPendingCreate()
}

function cancelNew() {
  files.clearPendingCreate()
  newName.value = ''
}

function onPendingDragStart(e: DragEvent) {
  draggingEntry.value = {
    kind: 'document',
    id: PENDING_ID,
    name: '',
    parentId: null,
    type: 'md',
  }
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onPendingDragEnd() {
  draggingEntry.value = null
}
</script>

<template>
  <div
    class="flex-1 flex flex-col overflow-y-auto"
    @click.self="files.selectFolder(null); files.clearSelection()"
    @contextmenu="onEmptyAreaContextMenu"
  >
    <div class="flex items-center justify-between px-3 py-2">
      <span class="text-xs font-medium text-text-muted uppercase tracking-widest">Files</span>
      <div class="flex items-center gap-0.5">
        <button
          v-if="totalFolderCount > 0"
          class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :title="anyExpanded ? 'Collapse all' : 'Expand all'"
          @click="anyExpanded ? files.collapseAll() : files.expandAll()"
        >
          <ChevronsDownUp v-if="anyExpanded" :size="16" />
          <ChevronsUpDown v-else :size="16" />
        </button>
        <button
          class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :title="files.selectedFolderId ? 'New file in selected folder' : 'New file'"
          @click="startNewFile"
        >
          <FilePlus :size="16" />
        </button>
        <button
          class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :title="files.selectedFolderId ? 'New folder in selected folder' : 'New folder'"
          @click="startNewFolder"
        >
          <FolderPlus :size="16" />
        </button>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="files.loading" class="px-3 space-y-2">
      <div v-for="i in 3" :key="i" class="h-6 bg-surface-elevated rounded animate-pulse" />
    </div>

    <div v-else class="text-sm select-none" @click.self="files.selectFolder(null); files.clearSelection()">
      <template v-for="entry in files.tree" :key="entry.id">
        <PendingInputRow
          v-if="showRootInput && files.pendingCreate?.insertBefore === entry.id"
          v-model="newName"
          :type="files.pendingCreate?.type ?? 'file'"
          :depth="0"
          @submit="submitNew"
          @cancel="cancelNew"
          @dragstart="onPendingDragStart"
          @dragend="onPendingDragEnd"
        />

        <FileExplorerNode :entry="entry" :depth="0" />
      </template>

      <PendingInputRow
        v-if="showRootInput && files.pendingCreate?.insertBefore === null"
        v-model="newName"
        :type="files.pendingCreate?.type ?? 'file'"
        :depth="0"
        @submit="submitNew"
        @cancel="cancelNew"
        @dragstart="onPendingDragStart"
        @dragend="onPendingDragEnd"
      />

      <!-- Empty state -->
      <div v-if="files.tree.length === 0 && !showRootInput" class="px-3 py-4">
        <p class="text-xs text-text-muted text-center">No files yet</p>
      </div>
    </div>

    <!-- Empty-space drop zone — fills remaining height, shows line at top when active -->
    <div
      class="flex-1 min-h-4 relative"
      @click="files.selectFolder(null); files.clearSelection()"
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

  <Teleport to="body">
    <div
      v-if="showEmptyContextMenu"
      class="fixed z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-36"
      :style="{ left: emptyContextMenuPos.x + 'px', top: emptyContextMenuPos.y + 'px' }"
    >
      <button
        class="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors cursor-pointer"
        @click="emptyAreaNewFile"
      >
        New file
      </button>
      <button
        class="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors cursor-pointer"
        @click="emptyAreaNewFolder"
      >
        New folder
      </button>
    </div>
  </Teleport>
</template>
