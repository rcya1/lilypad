<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  File,
  Check,
  GripVertical,
} from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useDragDrop, draggingEntry, PENDING_ID } from '@/composables/useDragDrop'

const props = defineProps<{
  entry: Entry
  depth: number
}>()

const editorStore = useEditorStore()
const filesStore = useFilesStore()
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
    isOpen.value = !isOpen.value
    filesStore.selectFolder(props.entry.id)
  } else {
    filesStore.selectFolder(null)
    if (props.entry.type === 'md') {
      const content = await filesStore.downloadContent(props.entry.id)
      editorStore.openDocument(props.entry.id, props.entry.name, props.entry.type, content ?? '')
    }
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
  if (!confirm(`Delete "${props.entry.name}"?`)) return
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
      class="relative flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-sm transition-colors duration-100"
      :class="[
        isActive
          ? 'bg-surface-overlay text-text-primary'
          : isSelectedFolder
            ? 'bg-surface-elevated text-text-primary'
            : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
        dropRegion === 'into' && !isInvalidTarget ? 'ring-1 ring-inset ring-accent' : '',
        isInvalidTarget && draggingEntry ? 'opacity-40' : '',
      ]"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      draggable="true"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="handleClick"
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
        {{ entry.name }}
      </span>

      <!-- After drop indicator -->
      <div
        v-if="dropRegion === 'after' && !isInvalidTarget"
        class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
      />
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

    <!-- Children -->
    <div
      v-if="isDirectory(entry)"
      class="grid transition-[grid-template-rows] duration-150 ease-in-out"
      :style="{ gridTemplateRows: isOpen ? '1fr' : '0fr' }"
    >
      <div class="overflow-hidden min-h-0">
        <template v-for="child in entry.children" :key="child.id">
          <!-- Pending input row: appears before the child whose ID matches insertBefore -->
          <div
            v-if="showNewInput && filesStore.pendingCreate?.insertBefore === child.id"
            data-pending-input
            class="flex items-center gap-1.5 py-1 px-2 rounded-sm bg-surface-elevated"
            :style="{ paddingLeft: (depth + 1) * 14 + 8 + 'px' }"
            draggable="true"
            @dragstart="onPendingDragStart"
            @dragend="onPendingDragEnd"
          >
            <span
              class="w-3 flex items-center justify-center text-text-muted shrink-0 cursor-grab active:cursor-grabbing"
            >
              <GripVertical :size="12" />
            </span>
            <span class="flex items-center shrink-0">
              <FileText
                v-if="filesStore.pendingCreate?.type === 'file'"
                :size="15"
                class="text-text-secondary"
              />
              <Folder v-else :size="15" class="text-amber" />
            </span>
            <input
              v-model="newChildName"
              class="flex-1 min-w-0 bg-transparent outline-none text-sm text-text-primary font-ui"
              :placeholder="filesStore.pendingCreate?.type === 'file' ? 'filename.md' : 'folder name'"
              @keydown.enter="submitNew"
              @keydown.escape="cancelNew"
              @vue:mounted="($event as any).el.focus()"
            />
            <button
              class="flex items-center justify-center w-4 h-4 rounded text-accent hover:bg-surface-overlay transition-colors cursor-pointer shrink-0"
              @mousedown.prevent
              @click="submitNew"
            >
              <Check :size="12" />
            </button>
          </div>

          <FileExplorerNode :entry="child" :depth="depth + 1" />
        </template>

        <!-- Pending input row at end (insertBefore = null) -->
        <div
          v-if="showNewInput && filesStore.pendingCreate?.insertBefore === null"
          data-pending-input
          class="flex items-center gap-1.5 py-1 px-2 rounded-sm bg-surface-elevated"
          :style="{ paddingLeft: (depth + 1) * 14 + 8 + 'px' }"
          draggable="true"
          @dragstart="onPendingDragStart"
          @dragend="onPendingDragEnd"
        >
          <span
            class="w-3 flex items-center justify-center text-text-muted shrink-0 cursor-grab active:cursor-grabbing"
          >
            <GripVertical :size="12" />
          </span>
          <span class="flex items-center shrink-0">
            <FileText
              v-if="filesStore.pendingCreate?.type === 'file'"
              :size="15"
              class="text-text-secondary"
            />
            <Folder v-else :size="15" class="text-amber" />
          </span>
          <input
            v-model="newChildName"
            class="flex-1 min-w-0 bg-transparent outline-none text-sm text-text-primary font-ui"
            :placeholder="filesStore.pendingCreate?.type === 'file' ? 'filename.md' : 'folder name'"
            @keydown.enter="submitNew"
            @keydown.escape="cancelNew"
            @vue:mounted="($event as any).el.focus()"
          />
          <button
            class="flex items-center justify-center w-4 h-4 rounded text-accent hover:bg-surface-overlay transition-colors cursor-pointer shrink-0"
            @mousedown.prevent
            @click="submitNew"
          >
            <Check :size="12" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
