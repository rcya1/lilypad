<!-- Individual file or folder row in the tree: handles click, double-click, drag-drop, rename, delete, and context menu. -->
<script setup lang="ts">
import { ref, computed, watch, type WritableComputedRef } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import { Folder, FolderOpen, FileText, File, Globe } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useDragDrop, draggingEntry, PENDING_ID } from '@/composables/useDragDrop'
import { useConfirm } from '@/composables/useConfirm'
import { useContextMenu } from '@/composables/useContextMenu'
import PendingInputRow from './PendingInputRow.vue'

const props = defineProps<{
  entry: Entry
  depth: number
}>()

const editorStore = useEditorStore()
const filesStore = useFilesStore()
const { confirm } = useConfirm()

// Writable computed so useDragDrop can set isOpen.value = true (auto-expand on hover) while
// the source of truth stays in the files store's collapsedFolderIds set.
const isOpen: WritableComputedRef<boolean> = computed({
  get: () => !filesStore.isFolderCollapsed(props.entry.id),
  set: (val: boolean) => {
    if (val) filesStore.expandFolder(props.entry.id)
    else filesStore.collapseFolder(props.entry.id)
  },
})

const {
  visible: contextMenuVisible,
  position: contextMenuPos,
  open: openContextMenu,
  close: closeContextMenu,
} = useContextMenu()
const contextMenuInsertBefore = ref<string | null>(null)
const isRenaming = ref(false)
const renameValue = ref('')
const newChildName = ref('')

const entryRef = computed(() => props.entry)
const { dropRegion, isInvalidTarget, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop } =
  useDragDrop(entryRef, isOpen, filesStore)

// Active document receives accent-coloured icon in the tree.
const isActive = computed(
  () => !isDirectory(props.entry) && editorStore.activeDocumentId === props.entry.id,
)

// Folders get a subtler "selected folder" highlight (not part of the multi-select set).
const isSelectedFolder = computed(
  () => isDirectory(props.entry) && filesStore.selectedFolderId === props.entry.id,
)

const isSelected = computed(() => filesStore.selectedIds.has(props.entry.id))

/**
 * True when an ancestor of this entry is in the multi-select set.
 * Used to apply the same selection highlight without explicitly selecting every descendant,
 * and to prevent moving a subtree twice during a bulk drag.
 */
const isCoveredBySelection = computed(() => {
  if (filesStore.selectedIds.size === 0) return false
  let parentId: string | null = props.entry.parentId
  while (parentId) {
    if (filesStore.selectedIds.has(parentId)) return true
    parentId = filesStore.entries.find((e) => e.id === parentId)?.parent_id ?? null
  }
  return false
})

// Once ≥2 items are selected, single-clicking an entry adjusts the selection
// instead of opening the document (to avoid accidentally navigating away).
const inSelectionMode = computed(() => filesStore.selectedIds.size >= 2)

// True when this folder is the target of a pending child-creation operation.
const showNewInput = computed(
  () => isDirectory(props.entry) && filesStore.pendingCreate?.parentId === props.entry.id,
)

// When a child pending input appears, auto-expand this folder so the input is
// visible, and attach a click-away listener that cancels the creation.
watch(showNewInput, (val, _old, onCleanup) => {
  if (val) {
    newChildName.value = ''
    isOpen.value = true
    // Cancel when clicking outside the pending row
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('[data-pending-input]')) {
        filesStore.clearPendingCreate()
      }
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    onCleanup(() => document.removeEventListener('mousedown', handler))
  }
})

/**
 * Handles all click variants on a file or folder row.
 *
 * Modifier keys:
 *   Ctrl/Cmd — toggle this entry in the multi-select set (or explode folder selection)
 *   Shift    — range-select from the last-clicked entry to this one
 *   Plain    — open/navigate (with preview tab for documents); toggle folder
 *
 * For documents, single click opens as a preview tab (replaced by the next
 * single-clicked file). Double-click promotes to a permanent tab.
 */
async function handleClick(e: MouseEvent) {
  if (isDirectory(props.entry)) {
    if (e.ctrlKey || e.metaKey) {
      filesStore.toggleSelection(props.entry.id)
      return
    }
    if (e.shiftKey) {
      filesStore.rangeSelectTo(props.entry.id)
      return
    }
    // Plain click: expand/collapse + navigate + select
    isOpen.value = !isOpen.value
    filesStore.selectFolder(props.entry.id)
    filesStore.selectSingle(props.entry.id)
    return
  }

  // Document entry
  if (e.ctrlKey || e.metaKey) {
    filesStore.explodeAndToggle(props.entry.id)
    return
  }
  if (e.shiftKey) {
    filesStore.rangeSelectTo(props.entry.id)
    return
  }
  if (inSelectionMode.value) {
    filesStore.selectSingle(props.entry.id)
    return
  }

  filesStore.selectFolder(null)
  filesStore.selectSingle(props.entry.id)
  // .md and web docs both carry their notes in the DB `content` column, so they open
  // through the same preview flow (web docs load their snapshot separately, in WebView).
  if (props.entry.type === 'md' || props.entry.type === 'web') {
    await editorStore.openEntry(props.entry.id, { preview: true })
  }
}

/**
 * Double-click promotes a preview tab to a permanent tab so it won't be
 * replaced by the next single-clicked document.
 */
function handleDblClick() {
  if (!isDirectory(props.entry) && (props.entry.type === 'md' || props.entry.type === 'web')) {
    editorStore.promotePreview(props.entry.id)
  }
}

/**
 * Returns the ID of the next sibling in sort order, used to determine the
 * "insert after" position when the context menu is triggered in the lower half
 * of the row.
 */
function getNextSiblingId(): string | null {
  const parentId = props.entry.parentId
  const siblings = filesStore.entries
    .filter((e) => e.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const idx = siblings.findIndex((s) => s.id === props.entry.id)
  if (idx === -1 || idx >= siblings.length - 1) return null
  return siblings[idx + 1]!.id
}

/**
 * Opens the context menu and resolves insert position based on where within the
 * row the right-click landed: top half → before this entry, bottom half → after.
 */
function onContextMenu(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const relY = e.clientY - rect.top
  // Top half of the row → insert before this entry; bottom half → insert after.
  contextMenuInsertBefore.value = relY < rect.height / 2 ? props.entry.id : getNextSiblingId()

  openContextMenu(e)
}

function startRename() {
  closeContextMenu()
  renameValue.value = props.entry.name
  isRenaming.value = true
}

/**
 * Commits a rename if the new name is non-empty and different.
 * Called on Enter, blur, or clicking away from the rename input.
 */
async function submitRename() {
  const newName = renameValue.value.trim()
  if (newName && newName !== props.entry.name) {
    await filesStore.renameEntry(props.entry.id, newName)
  }
  isRenaming.value = false
}

/**
 * Deletes this entry (or the full multi-select set if active) after a confirm dialog.
 *
 * When operating in multi-select mode, closes all affected tabs before deleting
 * to avoid dangling references in the editor store.
 */
async function handleDelete() {
  closeContextMenu()

  const isInSelection = isSelected.value || isCoveredBySelection.value
  if (filesStore.selectedIds.size >= 2 && isInSelection) {
    const count = filesStore.selectedIds.size
    const ok = await confirm({
      title: `Delete ${count} items?`,
      message: 'These items will be permanently deleted.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    for (const id of filesStore.selectedIds) {
      await editorStore.closeDocument(id)
    }
    await filesStore.bulkDelete([...filesStore.selectedIds])
    return
  }

  const label = isDirectory(props.entry) ? props.entry.name : stripExtension(props.entry.name)
  const ok = await confirm({
    title: `Delete "${label}"?`,
    message: isDirectory(props.entry)
      ? 'This folder and all its contents will be permanently deleted.'
      : 'This file will be permanently deleted.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  await editorStore.closeDocument(props.entry.id)
  await filesStore.deleteEntry(props.entry.id)
}

function startNewChildFile() {
  closeContextMenu()
  filesStore.triggerCreate(props.entry.id, 'file')
}

function startNewChildFolder() {
  closeContextMenu()
  filesStore.triggerCreate(props.entry.id, 'folder')
}

/** Creates a sibling at the position recorded when the context menu was opened. */
function startNewSiblingFile() {
  closeContextMenu()
  filesStore.triggerCreate(props.entry.parentId, 'file', contextMenuInsertBefore.value)
}

function startNewSiblingFolder() {
  closeContextMenu()
  filesStore.triggerCreate(props.entry.parentId, 'folder', contextMenuInsertBefore.value)
}

/**
 * Commits the pending child creation under this folder.
 * Auto-appends ".md" if omitted; clears pendingCreate state when done.
 *
 * Precondition: filesStore.pendingCreate is non-null and targets this folder.
 */
async function submitNew() {
  const name = newChildName.value.trim()
  if (!name) {
    filesStore.clearPendingCreate()
    return
  }
  const pending = filesStore.pendingCreate!
  const sortOrder = filesStore.getPendingSortOrder()
  if (pending.type === 'file') {
    const finalName = name.endsWith('.md') ? name : `${name}.md`
    await filesStore.createDocument(finalName, 'md', pending.parentId, sortOrder)
  } else {
    await filesStore.createDirectory(name, pending.parentId, sortOrder)
  }
  newChildName.value = ''
  filesStore.clearPendingCreate()
}

function cancelNew() {
  filesStore.clearPendingCreate()
  newChildName.value = ''
}

/** Removes the file extension for display purposes (e.g. "notes.md" → "notes"). */
function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

/**
 * Marks the dragging entry as the PENDING_ID sentinel so drop zones know this
 * is a not-yet-committed entry being repositioned.
 */
function onPendingDragStart(e: DragEvent) {
  draggingEntry.value = {
    kind: 'document',
    id: PENDING_ID,
    name: '',
    parentId: filesStore.pendingCreate?.parentId ?? null,
    type: 'md',
  }
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onPendingDragEnd() {
  draggingEntry.value = null
}
</script>

<template>
  <div>
    <!-- Rename input -->
    <div v-if="isRenaming" class="py-0.5 px-2" :style="{ paddingLeft: depth * 20 + 12 + 'px' }">
      <input
        v-model="renameValue"
        class="w-full px-2 py-0.5 text-sm bg-bg border border-accent rounded outline-none text-text-primary font-ui"
        @keydown.enter="submitRename"
        @keydown.escape="isRenaming = false"
        @blur="submitRename"
        v-focus
      />
    </div>

    <!-- Normal display -->
    <div
      v-else
      class="relative rounded-sm"
      :class="isInvalidTarget && draggingEntry ? 'opacity-40' : ''"
    >
      <div
        v-if="isDirectory(entry) && dropRegion === 'into' && !isInvalidTarget"
        class="absolute inset-1 ring-1 ring-accent rounded-sm pointer-events-none z-10"
      />
      <div
        class="relative flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-sm transition-colors duration-100"
        :class="[
          isSelected || isCoveredBySelection
            ? 'bg-surface-overlay text-text-primary'
            : isSelectedFolder
              ? 'bg-surface-elevated text-text-primary'
              : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
          !isDirectory(entry) && dropRegion === 'into' && !isInvalidTarget
            ? 'ring-1 ring-inset ring-accent'
            : '',
        ]"
        :style="{ paddingLeft: depth * 20 + 12 + 'px' }"
        draggable="true"
        @dragstart="onDragStart"
        @dragend="onDragEnd"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @click="handleClick"
        @dblclick="handleDblClick"
        @contextmenu="onContextMenu"
      >
        <!-- Indent guides -->
        <div
          v-for="i in depth"
          :key="'guide-' + i"
          class="absolute top-0 bottom-0 w-px bg-border pointer-events-none"
          :style="{ left: (i - 1) * 20 + 22 + 'px' }"
        />

        <!-- Before drop indicator -->
        <div
          v-if="dropRegion === 'before' && !isInvalidTarget"
          class="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
        />

        <!-- Icon -->
        <span class="flex items-center shrink-0">
          <template v-if="isDirectory(entry)">
            <FolderOpen v-if="isOpen" :size="17" class="text-amber" />
            <Folder v-else :size="17" class="text-amber" />
          </template>
          <template v-else-if="!isDirectory(entry) && entry.type === 'pdf'">
            <File :size="17" class="text-amber" />
          </template>
          <template v-else-if="!isDirectory(entry) && entry.type === 'web'">
            <Globe :size="17" :class="isActive ? 'text-accent' : 'text-text-secondary'" />
          </template>
          <template v-else>
            <FileText :size="17" :class="isActive ? 'text-accent' : 'text-text-secondary'" />
          </template>
        </span>

        <!-- Name -->
        <span class="truncate">
          {{ isDirectory(entry) || entry.type === 'web' ? entry.name : stripExtension(entry.name) }}
        </span>

        <!-- After drop indicator -->
        <div
          v-if="dropRegion === 'after' && !isInvalidTarget"
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
        />
      </div>

      <!-- Children (inside wrapper so the drop ring encompasses them) -->
      <div
        v-if="isDirectory(entry)"
        class="grid transition-[grid-template-rows] duration-150 ease-in-out"
        :style="{ gridTemplateRows: isOpen ? '1fr' : '0fr' }"
      >
        <div class="overflow-hidden min-h-0">
          <template v-for="child in entry.children" :key="child.id">
            <PendingInputRow
              v-if="showNewInput && filesStore.pendingCreate?.insertBefore === child.id"
              v-model="newChildName"
              :type="filesStore.pendingCreate?.type ?? 'file'"
              :depth="depth + 1"
              @submit="submitNew"
              @cancel="cancelNew"
              @dragstart="onPendingDragStart"
              @dragend="onPendingDragEnd"
            />

            <FileExplorerNode :entry="child" :depth="depth + 1" />
          </template>

          <PendingInputRow
            v-if="showNewInput && filesStore.pendingCreate?.insertBefore === null"
            v-model="newChildName"
            :type="filesStore.pendingCreate?.type ?? 'file'"
            :depth="depth + 1"
            @submit="submitNew"
            @cancel="cancelNew"
            @dragstart="onPendingDragStart"
            @dragend="onPendingDragEnd"
          />
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenuVisible"
        class="fixed z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-36"
        :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
      >
        <!-- Multi-select mode: only Delete -->
        <template v-if="filesStore.selectedIds.size >= 2 && (isSelected || isCoveredBySelection)">
          <button
            class="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-surface-elevated transition-colors cursor-pointer"
            @click="handleDelete"
          >
            Delete {{ filesStore.selectedIds.size }} items
          </button>
        </template>

        <!-- Single-item menu -->
        <template v-else>
          <button
            class="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors cursor-pointer"
            @click="startRename"
          >
            Rename
          </button>
          <template v-if="isDirectory(entry)">
            <button
              class="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors cursor-pointer"
              @click="startNewChildFile"
            >
              New file
            </button>
            <button
              class="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors cursor-pointer"
              @click="startNewChildFolder"
            >
              New folder
            </button>
          </template>
          <template v-else>
            <button
              class="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors cursor-pointer"
              @click="startNewSiblingFile"
            >
              New file
            </button>
            <button
              class="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors cursor-pointer"
              @click="startNewSiblingFolder"
            >
              New folder
            </button>
          </template>
          <div class="border-t border-border-subtle my-1" />
          <button
            class="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-surface-elevated transition-colors cursor-pointer"
            @click="handleDelete"
          >
            Delete
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>
