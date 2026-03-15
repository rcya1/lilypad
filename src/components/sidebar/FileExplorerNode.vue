<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
const isOpen = ref(true)

const showContextMenu = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })
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

async function handleClick() {
  if (isDirectory(props.entry)) {
    const wasOpen = isOpen.value
    isOpen.value = !isOpen.value
    filesStore.selectFolder(props.entry.id)
    // Prefetch direct md children when a folder is expanded
    if (!wasOpen) {
      props.entry.children
        .filter((c) => !isDirectory(c) && c.type === 'md')
        .forEach((c) => filesStore.prefetchContent(c.id))
    }
  } else {
    filesStore.selectFolder(null)
    if (props.entry.type === 'md') {
      const id = props.entry.id
      // Already open as a permanent tab — just switch to it
      if (editorStore.openDocuments.has(id) && editorStore.previewDocumentId !== id) {
        editorStore.setActiveDocument(id)
        return
      }
      // Cache hit: open as preview instantly
      const cached = filesStore.getCached(id)
      if (cached !== undefined) {
        editorStore.openDocumentAsPreview(id, props.entry.name, props.entry.type, cached)
        return
      }
      // Cache miss: show tab + skeleton immediately, fetch in background
      editorStore.openDocumentOptimisticAsPreview(id, props.entry.name, props.entry.type)
      const content = await filesStore.downloadContent(id)
      editorStore.finishLoadingDocument(id, content ?? '')
    }
  }
}

function handleDblClick() {
  if (!isDirectory(props.entry) && props.entry.type === 'md') {
    editorStore.promotePreview(props.entry.id)
  }
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  contextMenuPos.value = { x: e.clientX, y: e.clientY }
  showContextMenu.value = true

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
        isActive
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

      <!-- Chevron -->
      <span class="w-3 flex items-center justify-center text-text-muted shrink-0">
        <template v-if="isDirectory(entry)">
          <ChevronDown v-if="isOpen" :size="12" />
          <ChevronRight v-else :size="12" />
        </template>
      </span>

      <!-- Icon -->
      <span class="flex items-center shrink-0">
        <template v-if="isDirectory(entry)">
          <FolderOpen v-if="isOpen" :size="15" class="text-amber" />
          <Folder v-else :size="15" class="text-amber" />
        </template>
        <template v-else-if="!isDirectory(entry) && entry.type === 'pdf'">
          <File :size="15" class="text-amber" />
        </template>
        <template v-else>
          <FileText :size="15" :class="isActive ? 'text-accent' : 'text-text-secondary'" />
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
        <div class="border-t border-border-subtle my-1" />
        <button
          class="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-surface-elevated transition-colors cursor-pointer"
          @click="handleDelete"
        >
          Delete
        </button>
      </div>
    </Teleport>
  </div>
</template>
