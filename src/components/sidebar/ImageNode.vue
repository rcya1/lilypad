<!-- Individual image or folder node in the images gallery with thumbnail, rename, drag-drop, and context menu. -->
<script setup lang="ts">
import { computed, ref, type WritableComputedRef } from 'vue'
import { Folder, FolderOpen, Image, Pencil, Trash2 } from 'lucide-vue-next'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useContextMenu } from '@/composables/useContextMenu'
import { useDragDrop, draggingEntry } from '@/composables/useDragDrop'
import { useEntrySelection } from '@/composables/useEntrySelection'
import { useEntryDelete } from '@/composables/useEntryDelete'
import ContextMenu from '@/components/ui/ContextMenu.vue'
import ContextMenuItem from '@/components/ui/ContextMenuItem.vue'

const props = defineProps<{
  entry: Entry
  depth: number
  expandedFolders: Set<string>
}>()

const emit = defineEmits<{
  toggleFolder: [id: string]
}>()

const filesStore = useFilesStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()

const isRenaming = ref(false)
const renameValue = ref('')
const {
  visible: contextMenuVisible,
  position: contextMenuPos,
  open: openContextMenu,
  close: closeContextMenu,
} = useContextMenu()

const paddingLeft = computed(() => `${12 + props.depth * 24}px`)
const isDir = computed(() => isDirectory(props.entry))
// Resolved public URL from Supabase Storage; null for folders.
const url = computed(() => (isDir.value ? null : filesStore.getImageUrl(props.entry.id)))
// Highlighted when the editor just inserted this image (e.g. via paste).
const isHighlighted = computed(() => uiStore.highlightedImageId === props.entry.id)
const children = computed(() => (isDirectory(props.entry) ? props.entry.children : []))

// Writable computed so useDragDrop can expand folders on hover (auto-expand
// during a drag) while the actual expanded state lives in the parent ImagesTab.
const isOpen: WritableComputedRef<boolean> = computed({
  get: () => props.expandedFolders.has(props.entry.id),
  set: (val: boolean) => {
    // Only emit toggle when state actually changes to avoid redundant re-renders.
    if (val !== props.expandedFolders.has(props.entry.id)) {
      emit('toggleFolder', props.entry.id)
    }
  },
})

const entryRef = computed(() => props.entry)
const {
  dropRegion,
  isInvalidTarget,
  onDragStart: dndDragStart,
  onDragEnd: dndDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
} = useDragDrop(entryRef, isOpen, filesStore)

const { isSelected, isCoveredBySelection, inSelectionMode } = useEntrySelection(entryRef)

/**
 * Handles click interactions on an image or folder node.
 *
 * Modifier keys:
 *   Ctrl/Cmd — toggle in multi-select set (or explode folder for images)
 *   Shift    — range-select from last-clicked to this entry
 *   Plain    — open image in editor pane / toggle folder
 */
function handleClick(e: MouseEvent) {
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
    filesStore.selectSingle(props.entry.id)
    return
  }

  // Image entry
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

  filesStore.selectSingle(props.entry.id)
  if (!isDirectory(props.entry) && props.entry.type === 'image') {
    const id = props.entry.id
    if (editorStore.openDocuments.has(id)) {
      editorStore.setActiveDocument(id)
    } else {
      editorStore.openDocument(id, props.entry.name, 'image', '')
    }
  }
}

/**
 * Extends the composable's drag-start to also set text/plain with the markdown
 * image syntax (`![](img:<id>)`), so dragging from the gallery into the editor
 * inserts the image reference inline.
 */
function onDragStart(e: DragEvent) {
  dndDragStart(e)
  if (!isDir.value && e.dataTransfer) {
    e.dataTransfer.setData('text/plain', `![](img:${props.entry.id})`)
  }
}

function onDragEnd() {
  dndDragEnd()
}

function startRename() {
  closeContextMenu()
  renameValue.value = props.entry.name
  isRenaming.value = true
}

/** Commits a rename if the value changed; exits rename mode regardless. */
async function submitRename() {
  const newName = renameValue.value.trim()
  if (newName && newName !== props.entry.name) {
    await filesStore.renameEntry(props.entry.id, newName)
  }
  isRenaming.value = false
}

const { handleDelete } = useEntryDelete(
  entryRef,
  { isSelected, isCoveredBySelection },
  { noun: 'image', closeContextMenu },
)
</script>

<template>
  <div>
    <!-- Rename input -->
    <div v-if="isRenaming" class="py-0.5 px-2" :style="{ paddingLeft }">
      <input
        v-model="renameValue"
        class="w-full px-2 py-0.5 text-sm bg-bg border border-accent rounded outline-none text-text-primary font-ui"
        @keydown.enter="submitRename"
        @keydown.escape="isRenaming = false"
        @blur="submitRename"
        v-focus
      />
    </div>

    <!-- Folder -->
    <template v-else-if="isDir">
      <div
        class="relative rounded-sm"
        :class="isInvalidTarget && draggingEntry ? 'opacity-40' : ''"
      >
        <div
          v-if="isDirectory(entry) && dropRegion === 'into' && !isInvalidTarget"
          class="absolute inset-1 ring-1 ring-accent rounded-sm pointer-events-none z-10"
        />
        <div
          class="relative flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-sm transition-colors duration-100"
          :class="
            isSelected
              ? 'bg-surface-overlay text-text-primary'
              : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
          "
          :style="{ paddingLeft }"
          draggable="true"
          @dragstart="onDragStart"
          @dragend="onDragEnd"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
          @click="handleClick"
          @contextmenu="openContextMenu"
        >
          <!-- Indent guides -->
          <div
            v-for="i in depth"
            :key="i"
            class="absolute top-0 bottom-0 w-px bg-border pointer-events-none"
            :style="{ left: (i - 1) * 24 + 22 + 'px' }"
          />

          <!-- Before drop indicator -->
          <div
            v-if="dropRegion === 'before' && !isInvalidTarget"
            class="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
          />

          <span class="flex items-center shrink-0">
            <FolderOpen v-if="isOpen" :size="17" class="text-amber" />
            <Folder v-else :size="17" class="text-amber" />
          </span>
          <span class="truncate">{{ entry.name }}</span>

          <!-- After drop indicator -->
          <div
            v-if="dropRegion === 'after' && !isInvalidTarget"
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
          />
        </div>

        <!-- Children with grid animation -->
        <div
          class="grid transition-[grid-template-rows] duration-100 ease-in-out"
          :style="{ gridTemplateRows: isOpen ? '1fr' : '0fr' }"
        >
          <div class="overflow-hidden min-h-0">
            <ImageNode
              v-for="child in children"
              :key="child.id"
              :entry="child"
              :depth="depth + 1"
              :expanded-folders="expandedFolders"
              @toggle-folder="emit('toggleFolder', $event)"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- Image -->
    <div
      v-else
      class="relative rounded-sm"
      :class="isInvalidTarget && draggingEntry ? 'opacity-40' : ''"
    >
      <div
        class="relative flex items-center gap-2 py-1 px-2 cursor-grab rounded-sm transition-colors duration-100"
        :class="[
          isSelected
            ? 'bg-surface-overlay text-text-primary'
            : isHighlighted
              ? 'bg-accent/15 ring-1 ring-accent/30'
              : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
        ]"
        :style="{ paddingLeft }"
        draggable="true"
        :data-image-id="entry.id"
        @dragstart="onDragStart"
        @dragend="onDragEnd"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @click="handleClick"
        @contextmenu="openContextMenu"
      >
        <!-- Indent guides -->
        <div
          v-for="i in depth"
          :key="i"
          class="absolute top-0 bottom-0 w-px bg-border pointer-events-none"
          :style="{ left: (i - 1) * 24 + 22 + 'px' }"
        />

        <!-- Before drop indicator -->
        <div
          v-if="dropRegion === 'before' && !isInvalidTarget"
          class="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
        />

        <img
          v-if="url"
          :src="url"
          class="w-8 h-8 object-cover rounded shrink-0 bg-surface-elevated"
          loading="lazy"
        />
        <Image v-else :size="15" class="text-text-muted shrink-0" />
        <span class="truncate">{{ entry.name }}</span>

        <!-- After drop indicator -->
        <div
          v-if="dropRegion === 'after' && !isInvalidTarget"
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full z-10 pointer-events-none"
        />
      </div>
    </div>

    <!-- Context menu -->
    <ContextMenu v-if="contextMenuVisible" :x="contextMenuPos.x" :y="contextMenuPos.y">
      <!-- Multi-select mode: only Delete -->
      <template v-if="filesStore.selectedIds.size >= 2 && (isSelected || isCoveredBySelection)">
        <ContextMenuItem :icon="Trash2" danger @click="handleDelete">
          Delete {{ filesStore.selectedIds.size }} items
        </ContextMenuItem>
      </template>

      <!-- Single-item menu -->
      <template v-else>
        <ContextMenuItem :icon="Pencil" @click="startRename">Rename</ContextMenuItem>
        <div class="border-t border-border-subtle my-1" />
        <ContextMenuItem :icon="Trash2" danger @click="handleDelete">Delete</ContextMenuItem>
      </template>
    </ContextMenu>
  </div>
</template>
