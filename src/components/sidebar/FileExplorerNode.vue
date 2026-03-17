<script setup lang="ts">
import { ref, computed, watch, type WritableComputedRef } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, File } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useDragDrop, draggingEntry, PENDING_ID } from '@/composables/useDragDrop'
import { useConfirm } from '@/composables/useConfirm'
import PendingInputRow from './PendingInputRow.vue'

const props = defineProps<{
  entry: Entry
  depth: number
}>()

const editorStore = useEditorStore()
const filesStore = useFilesStore()
const { confirm } = useConfirm()

// Writable computed so useDragDrop can set isOpen.value = true while state stays in store
const isOpen: WritableComputedRef<boolean> = computed({
  get: () => !filesStore.isFolderCollapsed(props.entry.id),
  set: (val: boolean) => {
    if (val) filesStore.expandFolder(props.entry.id)
    else filesStore.collapseFolder(props.entry.id)
  },
})

const showContextMenu = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })
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

const isSelectedFolder = computed(
  () => isDirectory(props.entry) && filesStore.selectedFolderId === props.entry.id,
)

const isSelected = computed(() => filesStore.selectedIds.has(props.entry.id))

const isCoveredBySelection = computed(() => {
  if (filesStore.selectedIds.size === 0) return false
  let parentId: string | null = props.entry.parentId
  while (parentId) {
    if (filesStore.selectedIds.has(parentId)) return true
    parentId = filesStore.entries.find((e) => e.id === parentId)?.parent_id ?? null
  }
  return false
})

const inSelectionMode = computed(() => filesStore.selectedIds.size >= 2)

const showNewInput = computed(
  () => isDirectory(props.entry) && filesStore.pendingCreate?.parentId === props.entry.id,
)

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

function handleChevronClick() {
  if (!isDirectory(props.entry)) return
  const wasOpen = isOpen.value
  isOpen.value = !isOpen.value
  if (!wasOpen) {
    props.entry.children
      .filter((c) => !isDirectory(c) && c.type === 'md')
      .forEach((c) => filesStore.prefetchContent(c.id))
  }
}

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
    const wasOpen = isOpen.value
    isOpen.value = !isOpen.value
    filesStore.selectFolder(props.entry.id)
    filesStore.selectSingle(props.entry.id)
    if (!wasOpen) {
      props.entry.children
        .filter((c) => !isDirectory(c) && c.type === 'md')
        .forEach((c) => filesStore.prefetchContent(c.id))
    }
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
  if (props.entry.type === 'md') {
    const id = props.entry.id
    if (editorStore.openDocuments.has(id) && editorStore.previewDocumentId !== id) {
      editorStore.setActiveDocument(id)
      return
    }
    const cached = filesStore.getCached(id)
    if (cached !== undefined) {
      editorStore.openDocumentAsPreview(id, props.entry.name, props.entry.type, cached)
      return
    }
    editorStore.openDocumentOptimisticAsPreview(id, props.entry.name, props.entry.type)
    const content = await filesStore.downloadContent(id)
    editorStore.finishLoadingDocument(id, content ?? '')
  }
}

function handleDblClick() {
  if (!isDirectory(props.entry) && props.entry.type === 'md') {
    editorStore.promotePreview(props.entry.id)
  }
}

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
  e.preventDefault()
  contextMenuPos.value = { x: e.clientX, y: e.clientY }
  showContextMenu.value = true

  // Determine insert position: top half → before this entry, bottom half → after
  const rowEl = e.currentTarget as HTMLElement
  const rect = rowEl.getBoundingClientRect()
  const relY = e.clientY - rect.top
  contextMenuInsertBefore.value =
    relY < rect.height / 2 ? props.entry.id : getNextSiblingId()

  const close = () => {
    showContextMenu.value = false
    window.removeEventListener('click', close)
  }
  setTimeout(() => window.addEventListener('click', close), 0)
}

function startRename() {
  showContextMenu.value = false
  renameValue.value = props.entry.name
  isRenaming.value = true
}

async function submitRename() {
  const newName = renameValue.value.trim()
  if (newName && newName !== props.entry.name) {
    await filesStore.renameEntry(props.entry.id, newName)
  }
  isRenaming.value = false
}

async function handleDelete() {
  showContextMenu.value = false

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
      editorStore.closeDocument(id)
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
  editorStore.closeDocument(props.entry.id)
  await filesStore.deleteEntry(props.entry.id)
}

function startNewChildFile() {
  showContextMenu.value = false
  filesStore.triggerCreate(props.entry.id, 'file')
}

function startNewChildFolder() {
  showContextMenu.value = false
  filesStore.triggerCreate(props.entry.id, 'folder')
}

function startNewSiblingFile() {
  showContextMenu.value = false
  filesStore.triggerCreate(props.entry.parentId, 'file', contextMenuInsertBefore.value)
}

function startNewSiblingFolder() {
  showContextMenu.value = false
  filesStore.triggerCreate(props.entry.parentId, 'folder', contextMenuInsertBefore.value)
}

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
  return name.replace(/\.[^.]+$/, '')
}

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
    <div v-if="isRenaming" class="py-0.5 px-2" :style="{ paddingLeft: depth * 14 + 8 + 'px' }">
      <input
        v-model="renameValue"
        class="w-full px-2 py-0.5 text-sm bg-bg border border-accent rounded outline-none text-text-primary font-ui"
        @keydown.enter="submitRename"
        @keydown.escape="isRenaming = false"
        @blur="submitRename"
        @vue:mounted="($event as any).el.focus()"
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
        !isDirectory(entry) && dropRegion === 'into' && !isInvalidTarget ? 'ring-1 ring-inset ring-accent' : '',
      ]"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
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
      <!-- Before drop indicator -->
      <div
        v-if="dropRegion === 'before' && !isInvalidTarget"
        class="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
      />

      <!-- Chevron (expand/collapse only — stops click propagation) -->
      <span
        class="w-3 flex items-center justify-center text-text-muted shrink-0"
        @click.stop="handleChevronClick"
      >
        <template v-if="isDirectory(entry)">
          <ChevronDown v-if="isOpen" :size="14" />
          <ChevronRight v-else :size="14" />
        </template>
      </span>

      <!-- Icon -->
      <span class="flex items-center shrink-0">
        <template v-if="isDirectory(entry)">
          <FolderOpen v-if="isOpen" :size="17" class="text-amber" />
          <Folder v-else :size="17" class="text-amber" />
        </template>
        <template v-else-if="!isDirectory(entry) && entry.type === 'pdf'">
          <File :size="17" class="text-amber" />
        </template>
        <template v-else>
          <FileText :size="17" :class="isActive ? 'text-accent' : 'text-text-secondary'" />
        </template>
      </span>

      <!-- Name -->
      <span class="truncate">
        {{ isDirectory(entry) ? entry.name : stripExtension(entry.name) }}
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
        v-if="showContextMenu"
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
