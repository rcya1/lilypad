<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { FilePlus, FolderPlus, FileText, Folder, Check, GripVertical } from 'lucide-vue-next'
import FileExplorerNode from './FileExplorerNode.vue'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { draggingEntry, PENDING_ID } from '@/composables/useDragDrop'

const files = useFilesStore()
const editorStore = useEditorStore()
const newName = ref('')

onMounted(async () => {
  await files.fetchEntries()
  await files.seedWelcomeFile()
})

// Pending input at root level
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
  <div class="flex-1 overflow-y-auto" @click.self="files.selectFolder(null)">
    <div class="flex items-center justify-between px-3 pt-1 pb-2">
      <span class="text-xs font-medium text-text-muted uppercase tracking-widest">Files</span>
      <div class="flex items-center gap-0.5">
        <button
          class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :title="files.selectedFolderId ? 'New file in selected folder' : 'New file'"
          @click="startNewFile"
        >
          <FilePlus :size="14" />
        </button>
        <button
          class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :title="files.selectedFolderId ? 'New folder in selected folder' : 'New folder'"
          @click="startNewFolder"
        >
          <FolderPlus :size="14" />
        </button>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="files.loading" class="px-3 space-y-2">
      <div v-for="i in 3" :key="i" class="h-6 bg-surface-elevated rounded animate-pulse" />
    </div>

    <div v-else class="text-sm select-none" @click.self="files.selectFolder(null)">
      <template v-for="entry in files.tree" :key="entry.id">
        <!-- Pending row before the entry whose ID matches insertBefore -->
        <div
          v-if="showRootInput && files.pendingCreate?.insertBefore === entry.id"
          data-pending-input
          class="flex items-center gap-1.5 py-1 px-2 rounded-sm bg-surface-elevated"
          style="padding-left: 8px"
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
              v-if="files.pendingCreate?.type === 'file'"
              :size="15"
              class="text-text-secondary"
            />
            <Folder v-else :size="15" class="text-amber" />
          </span>
          <input
            v-model="newName"
            class="flex-1 min-w-0 bg-transparent outline-none text-sm text-text-primary font-ui"
            :placeholder="files.pendingCreate?.type === 'file' ? 'filename.md' : 'folder name'"
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

        <FileExplorerNode :entry="entry" :depth="0" />
      </template>

      <!-- Pending row at end (insertBefore = null) -->
      <div
        v-if="showRootInput && files.pendingCreate?.insertBefore === null"
        data-pending-input
        class="flex items-center gap-1.5 py-1 px-2 rounded-sm bg-surface-elevated"
        style="padding-left: 8px"
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
            v-if="files.pendingCreate?.type === 'file'"
            :size="15"
            class="text-text-secondary"
          />
          <Folder v-else :size="15" class="text-amber" />
        </span>
        <input
          v-model="newName"
          class="flex-1 min-w-0 bg-transparent outline-none text-sm text-text-primary font-ui"
          :placeholder="files.pendingCreate?.type === 'file' ? 'filename.md' : 'folder name'"
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

      <!-- Empty state -->
      <div
        v-if="files.tree.length === 0 && !showRootInput"
        class="px-3 py-4"
      >
        <p class="text-xs text-text-muted text-center">No files yet</p>
      </div>
    </div>

    <!-- Error message -->
    <div v-if="files.error" class="px-3 py-2">
      <p class="text-xs text-red-600">{{ files.error }}</p>
    </div>
  </div>
</template>
