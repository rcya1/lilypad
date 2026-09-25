<!-- Image viewer: details, rename, and the notes that reference the image. -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Pencil, FileText } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'

const props = defineProps<{
  documentId: string
}>()

const filesStore = useFilesStore()
const editorStore = useEditorStore()

const imageUrl = computed(() => filesStore.getImageUrl(props.documentId))
const entry = computed(() => filesStore.getEntry(props.documentId))
const imageName = computed(() => entry.value?.name ?? 'Unknown')

const naturalWidth = ref<number | null>(null)
const naturalHeight = ref<number | null>(null)

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  naturalWidth.value = img.naturalWidth
  naturalHeight.value = img.naturalHeight
}

const isRenaming = ref(false)
const renameValue = ref('')

function startRename() {
  renameValue.value = imageName.value
  isRenaming.value = true
}

/** The editor tab keeps its own copy of the name, so update both. */
async function submitRename() {
  const newName = renameValue.value.trim()
  if (newName && newName !== imageName.value) {
    await filesStore.renameEntry(props.documentId, newName)
    const doc = editorStore.openDocuments.get(props.documentId)
    if (doc) doc.name = newName
  }
  isRenaming.value = false
}

// Notes whose cached text mentions `img:<id>` (no DB query).
const referencingDocs = computed(() => {
  const pattern = `img:${props.documentId}`
  const contentMap = filesStore.getContentMap()
  const results: { id: string; name: string }[] = []

  for (const [docId, content] of contentMap) {
    if (content.includes(pattern)) {
      const docEntry = filesStore.getEntry(docId)
      if (docEntry) {
        results.push({ id: docId, name: docEntry.name })
      }
    }
  }

  return results
})

function openReferencingDoc(docId: string) {
  editorStore.openEntry(docId)
}
</script>

<template>
  <div class="flex h-full bg-bg">
    <!-- Details -->
    <div class="w-72 shrink-0 border-r border-border-subtle bg-bg flex flex-col overflow-y-auto">
      <div class="p-4 space-y-4">
        <div>
          <div v-if="isRenaming" class="flex items-center gap-1">
            <input
              v-model="renameValue"
              class="flex-1 px-2 py-1 text-sm bg-bg border border-accent rounded outline-none text-text-primary font-ui"
              @keydown.enter="submitRename"
              @keydown.escape="isRenaming = false"
              @blur="submitRename"
              v-focus
            />
          </div>
          <div v-else class="flex items-center gap-2">
            <h2 class="text-sm font-medium text-text-primary truncate flex-1">
              {{ imageName }}
            </h2>
            <button
              class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer shrink-0"
              title="Rename"
              @click="startRename"
            >
              <Pencil :size="13" />
            </button>
          </div>
        </div>

        <div v-if="naturalWidth !== null && naturalHeight !== null">
          <span class="text-xs font-medium text-text-muted uppercase tracking-widest"
            >Dimensions</span
          >
          <p class="text-sm text-text-secondary mt-1">
            {{ naturalWidth }} &times; {{ naturalHeight }}px
          </p>
        </div>

        <div>
          <span class="text-xs font-medium text-text-muted uppercase tracking-widest"
            >Referenced in</span
          >
          <div v-if="referencingDocs.length === 0" class="mt-1">
            <p class="text-xs text-text-muted">Not referenced in any documents</p>
          </div>
          <div v-else class="mt-1 space-y-0.5">
            <button
              v-for="doc in referencingDocs"
              :key="doc.id"
              class="w-full flex items-center gap-1.5 px-2 py-1 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary rounded transition-colors cursor-pointer text-left"
              @click="openReferencingDoc(doc.id)"
            >
              <FileText :size="14" class="text-text-muted shrink-0" />
              <span class="truncate">{{ doc.name.replace(/\.md$/, '') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview -->
    <div class="flex-1 overflow-auto bg-surface">
      <div
        class="m-2 rounded-md bg-bg border border-border-subtle image-card inline-flex items-center justify-center p-3"
      >
        <img
          v-if="imageUrl"
          :src="imageUrl"
          class="max-w-full max-h-full object-contain rounded"
          @load="onImageLoad"
        />
        <div v-else class="text-text-muted text-sm">Loading image...</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-card {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.07),
    0 2px 10px rgba(0, 0, 0, 0.04);
}
</style>
