<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, File } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'

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
const showNewFileInput = ref(false)
const showNewFolderInput = ref(false)
const newChildName = ref('')

async function handleClick() {
  if (isDirectory(props.entry)) {
    isOpen.value = !isOpen.value
  } else if (props.entry.type === 'md') {
    const content = await filesStore.downloadContent(props.entry.id)
    editorStore.openDocument(props.entry.id, props.entry.name, props.entry.type, content ?? '')
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
  isOpen.value = true
  showNewFolderInput.value = false
  showNewFileInput.value = true
  newChildName.value = ''
}

function startNewChildFolder() {
  showContextMenu.value = false
  isOpen.value = true
  showNewFileInput.value = false
  showNewFolderInput.value = true
  newChildName.value = ''
}

async function submitNewChildFile() {
  const name = newChildName.value.trim()
  if (!name) {
    showNewFileInput.value = false
    return
  }
  const finalName = name.endsWith('.md') ? name : `${name}.md`
  await filesStore.createDocument(finalName, 'md', props.entry.id)
  newChildName.value = ''
  showNewFileInput.value = false
}

function cancelNewChild() {
  showNewFileInput.value = false
  showNewFolderInput.value = false
}

async function submitNewChildFolder() {
  const name = newChildName.value.trim()
  if (!name) {
    showNewFolderInput.value = false
    return
  }
  await filesStore.createDirectory(name, props.entry.id)
  newChildName.value = ''
  showNewFolderInput.value = false
}

const isActive = computed(
  () => !isDirectory(props.entry) && editorStore.activeDocumentId === props.entry.id,
)
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
      class="flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-sm transition-colors duration-100"
      :class="
        isActive
          ? 'bg-surface-overlay text-text-primary'
          : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
      "
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="handleClick"
      @contextmenu="onContextMenu"
    >
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
        <!-- New child file/folder input -->
        <div
          v-if="showNewFileInput || showNewFolderInput"
          class="py-0.5 px-2"
          :style="{ paddingLeft: (depth + 1) * 14 + 8 + 'px' }"
        >
          <input
            v-model="newChildName"
            class="w-full px-2 py-0.5 text-sm bg-bg border border-accent rounded outline-none text-text-primary font-ui"
            :placeholder="showNewFileInput ? 'filename.md' : 'folder name'"
            @keydown.enter="showNewFileInput ? submitNewChildFile() : submitNewChildFolder()"
            @keydown.escape="cancelNewChild"
            @vue:mounted="($event as any).el.focus()"
          />
        </div>

        <FileExplorerNode
          v-for="child in entry.children"
          :key="child.id"
          :entry="child"
          :depth="depth + 1"
        />
      </div>
    </div>
  </div>
</template>
