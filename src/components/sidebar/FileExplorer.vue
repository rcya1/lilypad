<!-- Root of the sidebar file tree: toolbar for creating files/folders/web captures, drag-drop to root, and bulk-expand controls. -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, useTemplateRef } from 'vue'
import { FilePlus, FolderPlus, Globe, ChevronsDownUp, ChevronsUpDown } from 'lucide-vue-next'
import FileExplorerNode from './FileExplorerNode.vue'
import PendingInputRow from './PendingInputRow.vue'
import NewWebPageModal from './NewWebPageModal.vue'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { draggingEntry, PENDING_ID } from '@/composables/useDragDrop'
import { useToastStore } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import type { EntryRow } from '@/types/database'
import ContextMenu from '@/components/ui/ContextMenu.vue'
import ContextMenuItem from '@/components/ui/ContextMenuItem.vue'

const files = useFilesStore()
const editorStore = useEditorStore()
const toast = useToastStore()
const uiStore = useUiStore()
const growActionsIn = uiStore.arrivedViaModeSwitch('to-edit')

// The tree's scroll position is shared with the reader's sidebar, so flipping between modes with
// the Read/Edit switch keeps the same rows on screen.
const scroller = useTemplateRef<HTMLDivElement>('scroller')
function onScroll() {
  if (scroller.value) uiStore.sidebarScrollTop = scroller.value.scrollTop
}
onMounted(() => {
  if (scroller.value) scroller.value.scrollTop = uiStore.sidebarScrollTop
})

// anyExpanded drives the collapse-all / expand-all toggle button label.
const totalFolderCount = computed(() => files.entries.filter((e) => e.kind === 'directory').length)
const anyExpanded = computed(() => files.collapsedFolderIds.size < totalFolderCount.value)
const newName = ref('')

const isRootDropTarget = ref(false)

/** Clicking empty explorer space clears both the active folder and any selection. */
function deselectAll() {
  files.selectFolder(null)
  files.clearSelection()
}

/**
 * Returns a sort_order value that places a new entry after all current root entries.
 * Uses +1000 gaps so subsequent reorders have room to insert between existing values.
 */
function getRootAppendOrder(): number {
  const roots = files.entries
    .filter((e) => e.parent_id === null)
    .sort((a, b) => a.sort_order - b.sort_order)
  return roots.length === 0 ? 1000 : Math.max(...roots.map((e) => e.sort_order)) + 1000
}

/**
 * Handles a drop onto the empty area at the bottom of the explorer (root level).
 *
 * When multiple entries are selected and the dragged item is part of the selection,
 * only "top-level" selected entries are moved — entries whose ancestor is also
 * selected are skipped to avoid moving the same subtree twice.
 */
async function onRootDrop(e: DragEvent) {
  e.preventDefault()
  isRootDropTarget.value = false
  const entry = draggingEntry.value
  if (!entry || entry.id === PENDING_ID) return
  draggingEntry.value = null

  const dragId = entry.id
  const baseOrder = getRootAppendOrder()

  if (files.selectedIds.size >= 2 && files.selectedIds.has(dragId)) {
    const topLevel = files.filterTopLevelIds(files.selectedIds)
    const snapshot = topLevel.map((id) => {
      const e = files.getEntry(id)
      return { id, label: e ? e.name.replace(/\.[^.]+$/, '') : id }
    })
    const failed: typeof snapshot = []
    for (let i = 0; i < topLevel.length; i++) {
      // silent=true: suppress per-entry toasts; we show one aggregate toast for all failures below.
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

/**
 * Shows a "New file / New folder" context menu when right-clicking the empty
 * space of the explorer (not on any entry row).
 * The setTimeout(0) defers attaching the click-away listener until after the
 * current event finishes propagating, preventing it from immediately closing.
 */
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
  // Skip fetch if the store was already populated (e.g. sidebar remount).
  if (files.entries.length > 0) return
  await files.fetchEntries()
  await files.seedWelcomeFile()
})

// True when a root-level (no parent) pending create input should be shown.
const showRootInput = computed(() => files.pendingCreate?.parentId === null)

// When a root-level pending input appears, attach a click-away handler so
// clicking elsewhere cancels the creation without requiring an explicit Escape.
// onCleanup removes the handler when the input disappears.
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

/**
 * Returns the insertion position (parentId + insertBefore sibling) directly
 * below the currently active document, so new files created from the toolbar
 * appear next to the file being edited rather than at an arbitrary location.
 *
 * Returns null if there is no active document.
 */
function getInsertBelowActive(): {
  parentId: string | null
  insertBefore: string | null
} | null {
  const activeId = editorStore.activeDocumentId
  if (!activeId) return null
  const activeEntry = files.getEntry(activeId)
  if (!activeEntry) return null
  const siblings = files.entries
    .filter((e) => e.parent_id === activeEntry.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const idx = siblings.findIndex((s) => s.id === activeEntry.id)
  const insertBefore = idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1]!.id : null
  return { parentId: activeEntry.parent_id, insertBefore }
}

/**
 * Initiates creation of a new markdown file.
 * If a folder is selected in the sidebar, the file is created inside it.
 * Otherwise, the file is inserted immediately below the currently open document.
 */
function startNewFile() {
  const folderId = files.selectedFolderId
  if (folderId) {
    files.triggerCreate(folderId, 'file')
  } else {
    const below = getInsertBelowActive()
    files.triggerCreate(below?.parentId ?? null, 'file', below?.insertBefore ?? null)
  }
}

/**
 * Initiates creation of a new folder.
 * Placement priority: selected folder → below the active document → root.
 */
function startNewFolder() {
  const folderId = files.selectedFolderId
  if (folderId) {
    files.triggerCreate(folderId, 'folder')
  } else {
    const below = getInsertBelowActive()
    files.triggerCreate(below?.parentId ?? null, 'folder', below?.insertBefore ?? null)
  }
}

const showWebModal = ref(false)
const webModalParentId = ref<string | null>(null)

/** Opens the web-capture modal, resolving the target parent folder the same way as startNewFile. */
function startNewWebPage() {
  webModalParentId.value = files.selectedFolderId ?? getInsertBelowActive()?.parentId ?? null
  showWebModal.value = true
}

/**
 * Called after a web document is captured; immediately opens it in the editor.
 * @param entry - The newly created entry row returned by the capture flow.
 */
function onWebPageCreated(entry: EntryRow) {
  showWebModal.value = false
  editorStore.openDocument(entry.id, entry.name, 'web', entry.content ?? '')
}

/**
 * Confirms and creates the entry described by `files.pendingCreate`.
 * Auto-appends ".md" if the user omitted it for file entries.
 * Clears the pending state regardless of success or cancellation.
 */
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

/**
 * Sets draggingEntry to the PENDING_ID sentinel so drop zones know a
 * not-yet-created entry is being dragged (used to reorder the pending row
 * before committing the name).
 */
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
    ref="scroller"
    class="flex-1 flex flex-col overflow-y-auto"
    @scroll.passive="onScroll"
    @click.self="deselectAll"
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
        <!-- Editor-only actions. Flipping in from the reader, they grow in (the reader shrinks a
             copy of them away on the way out), so "collapse all" slides rather than jumps. -->
        <span
          class="flex items-center gap-0.5 overflow-hidden"
          :class="{ 'animate-actions-in': growActionsIn }"
        >
          <button
            :class="{ 'animate-icon-pop': growActionsIn }"
            style="animation-delay: 0ms"
            class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
            :title="files.selectedFolderId ? 'New file in selected folder' : 'New file'"
            @click="startNewFile"
          >
            <FilePlus :size="16" />
          </button>
          <button
            :class="{ 'animate-icon-pop': growActionsIn }"
            style="animation-delay: 40ms"
            class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
            :title="files.selectedFolderId ? 'New folder in selected folder' : 'New folder'"
            @click="startNewFolder"
          >
            <FolderPlus :size="16" />
          </button>
          <button
            :class="{ 'animate-icon-pop': growActionsIn }"
            style="animation-delay: 80ms"
            class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
            :title="files.selectedFolderId ? 'New web page in selected folder' : 'New web page'"
            @click="startNewWebPage"
          >
            <Globe :size="16" />
          </button>
        </span>
      </div>
    </div>

    <NewWebPageModal
      v-if="showWebModal"
      :parent-id="webModalParentId"
      @created="onWebPageCreated"
      @cancel="showWebModal = false"
    />

    <!-- Loading skeleton -->
    <div v-if="files.loading" class="px-3 space-y-2">
      <div v-for="i in 3" :key="i" class="h-6 bg-surface-elevated rounded animate-pulse" />
    </div>

    <div v-else class="text-sm select-none" @click.self="deselectAll">
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
      @click="deselectAll"
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

  <ContextMenu v-if="showEmptyContextMenu" :x="emptyContextMenuPos.x" :y="emptyContextMenuPos.y">
    <ContextMenuItem :icon="FilePlus" @click="emptyAreaNewFile">New file</ContextMenuItem>
    <ContextMenuItem :icon="FolderPlus" @click="emptyAreaNewFolder">New folder</ContextMenuItem>
  </ContextMenu>
</template>
