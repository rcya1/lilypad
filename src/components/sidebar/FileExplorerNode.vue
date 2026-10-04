<!-- A file or folder row: open, multi-select, drag-drop, rename, delete, context menu. -->
<script setup lang="ts">
import { ref, computed, watch, type WritableComputedRef } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory, hasNoteContent } from '@/types/file-explorer'
import {
  Folder,
  FolderOpen,
  FileText,
  File,
  Globe,
  Pencil,
  FilePlus,
  FolderPlus,
  Trash2,
  AlertTriangle,
} from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useSyncStore } from '@/stores/sync'
import { useDragDrop, draggingEntry, PENDING_ID } from '@/composables/useDragDrop'
import { useContextMenu } from '@/composables/useContextMenu'
import { useEntrySelection } from '@/composables/useEntrySelection'
import { useEntryDelete } from '@/composables/useEntryDelete'
import { splitExtension, joinExtension } from '@/lib/fileName'
import PendingInputRow from './PendingInputRow.vue'
import ContextMenu from '@/components/ui/ContextMenu.vue'
import ContextMenuItem from '@/components/ui/ContextMenuItem.vue'

const props = defineProps<{
  entry: Entry
  depth: number
}>()

const editorStore = useEditorStore()
const filesStore = useFilesStore()
const syncStore = useSyncStore()

// Writable so useDragDrop can expand it on hover; the files store still owns the state.
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

const isActive = computed(
  () => !isDirectory(props.entry) && editorStore.activeDocumentId === props.entry.id,
)

// A subtler highlight than multi-select, which it isn't part of.
const isSelectedFolder = computed(
  () => isDirectory(props.entry) && filesStore.selectedFolderId === props.entry.id,
)

const { isSelected, isCoveredBySelection, inSelectionMode } = useEntrySelection(entryRef)

const showNewInput = computed(
  () => isDirectory(props.entry) && filesStore.pendingCreate?.parentId === props.entry.id,
)

// Expand so a pending child input is visible, and cancel it on click-away.
watch(showNewInput, (val, _old, onCleanup) => {
  if (val) {
    newChildName.value = ''
    isOpen.value = true
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
 * Ctrl/Cmd toggles multi-select, Shift selects a range. A plain click toggles a folder, or opens a
 * document as a preview tab (double-click makes it permanent).
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
    isOpen.value = !isOpen.value
    filesStore.selectFolder(props.entry.id)
    filesStore.selectSingle(props.entry.id)
    return
  }

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
  // md, web and pdf docs all keep their notes in `content`, so all open through the preview flow
  // (a web page or PDF loads separately, in its viewer).
  if (hasNoteContent(props.entry.type)) {
    await editorStore.openEntry(props.entry.id, { preview: true })
  }
}

function handleDblClick() {
  if (!isDirectory(props.entry) && hasNoteContent(props.entry.type)) {
    editorStore.promotePreview(props.entry.id)
  }
}

/** For "insert after" when the context menu opens on the row's lower half. */
function getNextSiblingId(): string | null {
  const parentId = props.entry.parentId
  const siblings = filesStore.entries
    .filter((e) => e.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const idx = siblings.findIndex((s) => s.id === props.entry.id)
  if (idx === -1 || idx >= siblings.length - 1) return null
  return siblings[idx + 1]!.id
}

function onContextMenu(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const relY = e.clientY - rect.top
  // Top half of the row → insert before this entry; bottom half → insert after.
  contextMenuInsertBefore.value = relY < rect.height / 2 ? props.entry.id : getNextSiblingId()

  openContextMenu(e)
}

/** Folders and web pages have no real extension; anything else keeps its extension locked. */
const lockedExtension = computed(() => {
  const entry = props.entry
  if (isDirectory(entry) || entry.type === 'web') return ''
  return splitExtension(entry.name).ext
})

function startRename() {
  closeContextMenu()
  renameValue.value = lockedExtension.value
    ? splitExtension(props.entry.name).stem
    : props.entry.name
  isRenaming.value = true
}

/** On Enter, blur or click-away. Ignores empty or unchanged names. */
async function submitRename() {
  const stem = renameValue.value.trim()
  const newName = stem && joinExtension(stem, lockedExtension.value)
  if (newName && newName !== props.entry.name) {
    await filesStore.renameEntry(props.entry.id, newName)
  }
  isRenaming.value = false
}

const { handleDelete } = useEntryDelete(
  entryRef,
  { isSelected, isCoveredBySelection },
  {
    noun: 'file',
    closeContextMenu,
    label: (entry) => (isDirectory(entry) ? entry.name : stripExtension(entry.name)),
  },
)

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

/** Appends ".md" if it's missing. */
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

function stripExtension(name: string) {
  return splitExtension(name).stem
}

/** PENDING_ID marks a not-yet-created entry being repositioned. */
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
    <div v-if="isRenaming" class="py-0.5 px-2" :style="{ paddingLeft: depth * 24 + 12 + 'px' }">
      <input
        v-model="renameValue"
        class="w-full px-2 py-0.5 text-sm bg-bg border border-accent rounded outline-none text-text-primary font-ui"
        @keydown.enter="submitRename"
        @keydown.escape="isRenaming = false"
        @blur="submitRename"
        v-focus
      />
    </div>

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
          isSelected
            ? 'bg-surface-overlay text-text-primary'
            : isSelectedFolder
              ? 'bg-surface-elevated text-text-primary'
              : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
          !isDirectory(entry) && dropRegion === 'into' && !isInvalidTarget
            ? 'ring-1 ring-inset ring-accent'
            : '',
        ]"
        :style="{ paddingLeft: depth * 24 + 12 + 'px' }"
        :data-entry-id="entry.id"
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
          :style="{ left: (i - 1) * 24 + 22 + 'px' }"
        />

        <div
          v-if="dropRegion === 'before' && !isInvalidTarget"
          class="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
        />

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

        <span class="truncate">
          {{ isDirectory(entry) || entry.type === 'web' ? entry.name : stripExtension(entry.name) }}
        </span>
        <span
          v-if="syncStore.conflictIds.has(entry.id)"
          class="ml-auto flex shrink-0 items-center text-amber"
          title="Merge conflicts: open to resolve"
        >
          <AlertTriangle :size="13" />
        </span>

        <div
          v-if="dropRegion === 'after' && !isInvalidTarget"
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
        />
      </div>

      <!-- Children inside the wrapper so the drop ring covers them -->
      <div
        v-if="isDirectory(entry)"
        class="grid transition-[grid-template-rows] duration-100 ease-in-out"
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

    <ContextMenu v-if="contextMenuVisible" :x="contextMenuPos.x" :y="contextMenuPos.y">
      <!-- Multi-select: only Delete -->
      <template v-if="filesStore.selectedIds.size >= 2 && (isSelected || isCoveredBySelection)">
        <ContextMenuItem :icon="Trash2" danger @click="handleDelete">
          Delete {{ filesStore.selectedIds.size }} items
        </ContextMenuItem>
      </template>

      <template v-else>
        <ContextMenuItem :icon="Pencil" @click="startRename">Rename</ContextMenuItem>
        <template v-if="isDirectory(entry)">
          <ContextMenuItem :icon="FilePlus" @click="startNewChildFile">New file</ContextMenuItem>
          <ContextMenuItem :icon="FolderPlus" @click="startNewChildFolder"
            >New folder</ContextMenuItem
          >
        </template>
        <template v-else>
          <ContextMenuItem :icon="FilePlus" @click="startNewSiblingFile">New file</ContextMenuItem>
          <ContextMenuItem :icon="FolderPlus" @click="startNewSiblingFolder"
            >New folder</ContextMenuItem
          >
        </template>
        <div class="border-t border-border-subtle my-1" />
        <ContextMenuItem :icon="Trash2" danger @click="handleDelete">Delete</ContextMenuItem>
      </template>
    </ContextMenu>
  </div>
</template>
