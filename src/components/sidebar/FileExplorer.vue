<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { FilePlus, FolderPlus } from 'lucide-vue-next'
import FileExplorerNode from './FileExplorerNode.vue'
import { useFilesStore } from '@/stores/files'

const files = useFilesStore()
const showNewFileInput = ref(false)
const showNewFolderInput = ref(false)
const newName = ref('')

onMounted(async () => {
  await files.fetchEntries()
  await files.seedWelcomeFile()
})

async function submitNewFile() {
  const name = newName.value.trim()
  if (!name) {
    showNewFileInput.value = false
    return
  }
  const finalName = name.endsWith('.md') ? name : `${name}.md`
  await files.createDocument(finalName, 'md')
  newName.value = ''
  showNewFileInput.value = false
}

async function submitNewFolder() {
  const name = newName.value.trim()
  if (!name) {
    showNewFolderInput.value = false
    return
  }
  await files.createDirectory(name)
  newName.value = ''
  showNewFolderInput.value = false
}

function startNewFile() {
  showNewFolderInput.value = false
  showNewFileInput.value = true
  newName.value = ''
}

function startNewFolder() {
  showNewFileInput.value = false
  showNewFolderInput.value = true
  newName.value = ''
}

function cancelNew() {
  showNewFileInput.value = false
  showNewFolderInput.value = false
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="flex items-center justify-between px-3 pt-1 pb-2">
      <span class="text-xs font-medium text-text-muted uppercase tracking-widest">Files</span>
      <div class="flex items-center gap-0.5">
        <button
          class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          title="New file"
          @click="startNewFile"
        >
          <FilePlus :size="14" />
        </button>
        <button
          class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          title="New folder"
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

    <div v-else class="text-sm select-none">
      <!-- New file/folder input at root level -->
      <div v-if="showNewFileInput || showNewFolderInput" class="px-2 py-1">
        <input
          v-model="newName"
          class="w-full px-2 py-0.5 text-sm bg-bg border border-accent rounded outline-none text-text-primary font-ui"
          :placeholder="showNewFileInput ? 'filename.md' : 'folder name'"
          @keydown.enter="showNewFileInput ? submitNewFile() : submitNewFolder()"
          @keydown.escape="cancelNew"
          @vue:mounted="($event as any).el.focus()"
        />
      </div>

      <FileExplorerNode v-for="entry in files.tree" :key="entry.id" :entry="entry" :depth="0" />

      <!-- Empty state -->
      <div
        v-if="files.tree.length === 0 && !showNewFileInput && !showNewFolderInput"
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
