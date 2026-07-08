<!-- Tab bar for open documents: supports drag-to-reorder, middle-click close, preview-tab italics, and layout/swap controls. -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  X,
  RotateCw,
  RotateCcw,
  ArrowLeftRight,
  ArrowUpDown,
  Loader2,
  FileText,
  File,
  PanelRight,
  PanelRightClose,
} from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'

defineProps<{
  isVertical: boolean
  isSwapped: boolean
  /** Controls which rotation icon direction to show on the layout toggle button. */
  rotationClockwise: boolean
  previewVisible: boolean
}>()

const emit = defineEmits<{
  'toggle-layout': []
  'toggle-swap': []
}>()

const store = useEditorStore()
const uiStore = useUiStore()
const filesStore = useFilesStore()

/**
 * Activate a tab and also sync the sidebar file selection so the active document
 * is highlighted in the file explorer.
 */
function switchToTab(id: string) {
  store.setActiveDocument(id)
  filesStore.selectSingle(id)
}

// Derived from tabOrder so the display order matches the user's drag-reordered sequence.
const tabs = computed(() => store.tabOrder.map((id) => store.openDocuments.get(id)!))

// Drag state: which tab is being dragged and where the insertion indicator should appear.
const draggedId = ref<string | null>(null)
const dropIndex = ref<number | null>(null)

function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

function onDragStart(e: DragEvent, id: string) {
  draggedId.value = id
  e.dataTransfer!.effectAllowed = 'move'
  // setData is required for Firefox to allow dragging; Chrome ignores its content.
  e.dataTransfer!.setData('text/plain', id)
}

/**
 * Determine whether the drop indicator should appear before or after this tab
 * by comparing the cursor's X position to the tab's horizontal midpoint.
 */
function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  dropIndex.value = e.clientX < rect.left + rect.width / 2 ? index : index + 1
}

// The empty trailing area after all tabs: dragging here targets the end of the list.
function onDragOverEnd(e: DragEvent) {
  e.preventDefault()
  dropIndex.value = tabs.value.length
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  if (draggedId.value !== null && dropIndex.value !== null) {
    store.moveTab(draggedId.value, dropIndex.value)
  }
  draggedId.value = null
  dropIndex.value = null
}

function onDragEnd() {
  draggedId.value = null
  dropIndex.value = null
}

function handleClose(id: string) {
  store.closeDocument(id)
}

// Middle-click closes the tab (standard tab-strip behavior).
function onTabMouseDown(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    handleClose(id)
  }
}
</script>

<template>
  <div
    class="flex items-stretch bg-surface border-b border-border-subtle shrink-0 overflow-x-auto h-10"
    @dragover.prevent
    @drop="onDrop"
  >
    <template v-for="(tab, i) in tabs" :key="tab.id">
      <div v-if="draggedId && dropIndex === i" class="w-0.5 bg-accent shrink-0 self-stretch" />

      <button
        :title="tab.name"
        class="group relative flex items-center gap-1.5 pl-3 pr-1 text-sm border-r border-border-subtle shrink-0 transition-colors duration-100 cursor-pointer select-none"
        :class="[
          tab.id === store.activeDocumentId
            ? 'bg-tab-active-bg text-text-primary'
            : 'bg-surface text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
          draggedId === tab.id ? 'opacity-40' : '',
        ]"
        draggable="true"
        @click="switchToTab(tab.id)"
        @dblclick="store.promotePreview(tab.id)"
        @mousedown="onTabMouseDown($event, tab.id)"
        @dragstart="onDragStart($event, tab.id)"
        @dragover="onDragOver($event, i)"
        @dragend="onDragEnd"
      >
        <span
          v-if="tab.id === store.activeDocumentId"
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
        />

        <FileText
          v-if="tab.type === 'md'"
          :size="16"
          class="shrink-0 text-text-muted"
          :class="tab.id === store.activeDocumentId ? 'text-accent' : ''"
        />
        <File v-else :size="16" class="shrink-0 text-amber" />

        <span
          class="truncate max-w-35 font-ui text-sm"
          :class="store.previewDocumentId === tab.id ? 'italic pr-0.5' : ''"
        >
          {{ stripExtension(tab.name) }}
        </span>

        <span
          class="group/close flex items-center justify-center w-5 h-5 rounded-sm text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors duration-100"
          :class="
            tab.id === store.activeDocumentId
              ? 'opacity-60 hover:opacity-100'
              : 'opacity-0 group-hover:opacity-70 hover:opacity-100!'
          "
          @click.stop="handleClose(tab.id)"
        >
          <Loader2 v-if="store.savingIds.has(tab.id)" :size="16" class="animate-spin" />
          <X v-else :size="16" />
        </span>
      </button>
    </template>

    <div
      v-if="draggedId && dropIndex === tabs.length"
      class="w-0.5 bg-accent shrink-0 self-stretch"
    />

    <div class="flex-1" @dragover="onDragOverEnd" @drop="onDrop" />

    <div class="flex items-center gap-0.5 px-2 shrink-0 border-l border-border-subtle">
      <template v-if="store.activeDocument?.type === 'md'">
        <button
          class="flex items-center justify-center w-7 h-7 rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :title="previewVisible ? 'Hide preview' : 'Show preview'"
          @click="uiStore.togglePreview()"
        >
          <PanelRight v-if="previewVisible" :size="16" />
          <PanelRightClose v-else :size="16" />
        </button>
      </template>
      <template v-if="previewVisible">
        <button
          class="rotate-btn flex items-center justify-center w-7 h-7 rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :class="rotationClockwise ? 'rotate-cw' : 'rotate-ccw'"
          :title="isVertical ? 'Switch to side-by-side' : 'Switch to top-bottom'"
          @click="emit('toggle-layout')"
        >
          <RotateCw v-if="rotationClockwise" :size="16" class="rotate-icon" />
          <RotateCcw v-else :size="16" class="rotate-icon" />
        </button>
        <button
          class="flex items-center justify-center w-7 h-7 rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
          :title="isSwapped ? 'Move editor to primary position' : 'Swap editor and preview'"
          @click="emit('toggle-swap')"
        >
          <ArrowLeftRight v-if="!isVertical" :size="16" />
          <ArrowUpDown v-else :size="16" />
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rotate-icon {
  transition: transform 280ms cubic-bezier(0.4, 0, 0.2, 1);
}

.rotate-cw:hover .rotate-icon {
  transform: rotate(90deg);
}

.rotate-ccw:hover .rotate-icon {
  transform: rotate(-90deg);
}
</style>
