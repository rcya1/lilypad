<!-- Sidebar file tree: create files and folders, import (web pages or PDFs from a link, or PDFs from
     the computer, also by dropping them on the tree); top-level drop zone; expand all. -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, useTemplateRef } from 'vue'
import {
  FilePlus,
  FolderPlus,
  Download,
  Loader2,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-vue-next'
import FileExplorerNode from './FileExplorerNode.vue'
import PendingInputRow from './PendingInputRow.vue'
import ImportModal from './ImportModal.vue'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { draggingEntry, PENDING_ID } from '@/composables/useDragDrop'
import { useToastStore } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import type { EntryRow } from '@/types/database'
import type { DocumentType } from '@/types/file-explorer'
import ContextMenu from '@/components/ui/ContextMenu.vue'
import ContextMenuItem from '@/components/ui/ContextMenuItem.vue'

const files = useFilesStore()
const editorStore = useEditorStore()
const toast = useToastStore()
const uiStore = useUiStore()
const growActionsIn = uiStore.arrivedViaModeSwitch('to-edit')

// Shared with the reader's sidebar so flipping Read/Edit keeps the same rows on screen.
const scroller = useTemplateRef<HTMLDivElement>('scroller')
function onScroll() {
  if (scroller.value) uiStore.sidebarScrollTop = scroller.value.scrollTop
}
onMounted(() => {
  if (scroller.value) scroller.value.scrollTop = uiStore.sidebarScrollTop
})

const totalFolderCount = computed(() => files.entries.filter((e) => e.kind === 'directory').length)
const anyExpanded = computed(() => files.collapsedFolderIds.size < totalFolderCount.value)
const newName = ref('')

const isRootDropTarget = ref(false)

/** Clicking empty explorer space clears both the active folder and any selection. */
function deselectAll() {
  files.selectFolder(null)
  files.clearSelection()
}

/** After every top-level entry, with a 1000 gap. */
function getRootAppendOrder(): number {
  const roots = files.entries
    .filter((e) => e.parent_id === null)
    .sort((a, b) => a.sort_order - b.sort_order)
  return roots.length === 0 ? 1000 : Math.max(...roots.map((e) => e.sort_order)) + 1000
}

/** Drop on the empty space below the tree: move to the top level (selected subtrees once each). */
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
      // One aggregate toast below instead of one per entry.
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
 * Right-click on the empty space. The click-away listener is attached after this event finishes,
 * or it would close the menu straight away.
 */
function onEmptyAreaContextMenu(e: MouseEvent) {
  // Only the empty space itself, not a row.
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
  // Already loaded (e.g. the sidebar remounted).
  if (files.entries.length > 0) return
  await files.fetchEntries()
  await files.seedWelcomeFile()
})

const showRootInput = computed(() => files.pendingCreate?.parentId === null)

// Cancel a top-level pending input on click-away.
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

/** Just below the active document, so toolbar-created files land next to it. */
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

/** Into the selected folder, else just below the open document. */
function startNewFile() {
  const folderId = files.selectedFolderId
  if (folderId) {
    files.triggerCreate(folderId, 'file')
  } else {
    const below = getInsertBelowActive()
    files.triggerCreate(below?.parentId ?? null, 'file', below?.insertBefore ?? null)
  }
}

/** Into the selected folder, else below the active document, else the top level. */
function startNewFolder() {
  const folderId = files.selectedFolderId
  if (folderId) {
    files.triggerCreate(folderId, 'folder')
  } else {
    const below = getInsertBelowActive()
    files.triggerCreate(below?.parentId ?? null, 'folder', below?.insertBefore ?? null)
  }
}

const showImportModal = ref(false)
const importModalParentId = ref<string | null>(null)

/** Parent chosen as in startNewFile. */
function defaultParentId(): string | null {
  return files.selectedFolderId ?? getInsertBelowActive()?.parentId ?? null
}

function startImport() {
  importModalParentId.value = defaultParentId()
  showImportModal.value = true
}

function openCreated(entry: EntryRow) {
  const type = (entry.document_type ?? 'md') as DocumentType
  editorStore.openDocument(entry.id, entry.name, type, entry.content ?? '')
}

function onLinkAdded(entry: EntryRow) {
  showImportModal.value = false
  openCreated(entry)
}

function onImportUpload(list: File[]) {
  showImportModal.value = false
  void uploadPdfs(list, importModalParentId.value)
}

// PDF uploads: from the import modal, or files dropped from the computer onto the tree.
const uploadingCount = ref(0)
const isFileDropTarget = ref(false)

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

/** One at a time; opens the last one that made it. */
async function uploadPdfs(list: File[], parentId: string | null) {
  const pdfs = list.filter(isPdfFile)
  const skipped = list.length - pdfs.length
  if (skipped) toast.addToast(`Only PDFs can be uploaded here (skipped ${skipped}).`, 'info')
  let last: EntryRow | null = null
  for (const file of pdfs) {
    uploadingCount.value++
    try {
      last = (await files.uploadPdf(file, parentId)) ?? last
    } catch (err) {
      toast.addToast(err instanceof Error ? err.message : `Couldn't upload "${file.name}".`)
    } finally {
      uploadingCount.value--
    }
  }
  if (last) openCreated(last)
}

/** Only drags of files from the computer; tree rows use their own drag and drop. */
function isExternalFileDrag(e: DragEvent): boolean {
  return !draggingEntry.value && !!e.dataTransfer?.types.includes('Files')
}

function onExternalDragOver(e: DragEvent) {
  if (!isExternalFileDrag(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  isFileDropTarget.value = true
}

function onExternalDragLeave(e: DragEvent) {
  const current = e.currentTarget as HTMLElement
  if (e.relatedTarget && current.contains(e.relatedTarget as Node)) return
  isFileDropTarget.value = false
}

/**
 * Into the folder dropped on (or the dropped-on file's folder); the empty space below the tree is
 * the top level; anywhere else, the default parent.
 */
function onExternalDrop(e: DragEvent) {
  if (!isExternalFileDrag(e)) return
  e.preventDefault()
  isFileDropTarget.value = false
  isRootDropTarget.value = false
  const target = e.target as Element | null
  const row = target?.closest?.<HTMLElement>('[data-entry-id]')
  const rowEntry = row ? files.getEntry(row.dataset.entryId!) : undefined
  let parentId: string | null
  if (rowEntry) parentId = rowEntry.kind === 'directory' ? rowEntry.id : rowEntry.parent_id
  else if (target?.closest?.('[data-root-drop]')) parentId = null
  else parentId = defaultParentId()
  void uploadPdfs(Array.from(e.dataTransfer?.files ?? []), parentId)
}

/** Appends ".md" if missing; clears the pending state either way. */
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

/** PENDING_ID marks the not-yet-created entry so it can be repositioned before it's named. */
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
    :class="{ 'ring-2 ring-inset ring-accent/60': isFileDropTarget }"
    @scroll.passive="onScroll"
    @click.self="deselectAll"
    @contextmenu="onEmptyAreaContextMenu"
    @dragover="onExternalDragOver"
    @dragleave="onExternalDragLeave"
    @drop="onExternalDrop"
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
            :title="
              uploadingCount
                ? 'Uploading…'
                : files.selectedFolderId
                  ? 'Import a web page or PDF into selected folder'
                  : 'Import a web page or PDF'
            "
            @click="startImport"
          >
            <Loader2 v-if="uploadingCount" :size="16" class="animate-spin" />
            <Download v-else :size="16" />
          </button>
        </span>
      </div>
    </div>

    <ImportModal
      v-if="showImportModal"
      :parent-id="importModalParentId"
      @created="onLinkAdded"
      @upload="onImportUpload"
      @cancel="showImportModal = false"
    />

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

      <div v-if="files.tree.length === 0 && !showRootInput" class="px-3 py-4">
        <p class="text-xs text-text-muted text-center">No files yet</p>
      </div>
    </div>

    <!-- Empty space below the tree: a top-level drop zone -->
    <div
      class="flex-1 min-h-4 relative"
      data-root-drop
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
