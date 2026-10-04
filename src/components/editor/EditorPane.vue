<!-- Editor area: tab bar, editor/preview split with a draggable divider, font size controls. -->
<script setup lang="ts">
import { ref, computed, useTemplateRef, onBeforeUnmount } from 'vue'
import { AArrowDown, AArrowUp } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import TextEditor from './TextEditor.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import ImageDetailPane from './ImageDetailPane.vue'
import AnnotatedDocPane from './AnnotatedDocPane.vue'
import EditorTabs from './EditorTabs.vue'
import BreadcrumbBar from './BreadcrumbBar.vue'
import LilypadIcon from '@/assets/icon.svg'

const store = useEditorStore()
const uiStore = useUiStore()
const hasTabs = computed(() => store.tabOrder.length > 0)

// Arriving via the Read/Edit switch, the tab bar grows into place (the reader mirrors this).
const slideTabsIn = ref(uiStore.arrivedViaModeSwitch('to-edit'))
const activeId = computed(() => store.activeDocumentId)
const activeDocType = computed(() => store.activeDocument?.type)
// Web pages and PDFs: a viewer beside single-pane notes, no font controls in the breadcrumb bar.
const isAnnotated = computed(() => activeDocType.value === 'web' || activeDocType.value === 'pdf')

const splitPane = useTemplateRef<HTMLDivElement[]>('splitPane')
// Share of the container taken by the first panel (editor or preview, depending on swap).
const splitPct = ref(50)
const MIN_PCT = 20
const MAX_PCT = 80

const isVertical = ref(false)
const isSwapped = ref(false)
const rotationClockwise = ref(true)
const isDragging = ref(false)

/** Absolutely positioned so size changes can be CSS transitions. `inFirst` = left/top slot. */
function slotStyle(inFirst: boolean) {
  if (!isVertical.value) {
    return inFirst
      ? { left: '0%', top: '0%', width: `${splitPct.value}%`, height: '100%' }
      : { left: `${splitPct.value}%`, top: '0%', width: `${100 - splitPct.value}%`, height: '100%' }
  } else {
    return inFirst
      ? { left: '0%', top: '0%', width: '100%', height: `${splitPct.value}%` }
      : { left: '0%', top: `${splitPct.value}%`, width: '100%', height: `${100 - splitPct.value}%` }
  }
}

const editorPanelStyle = computed(() => {
  if (!uiStore.previewVisible) return { left: '0', top: '0', width: '100%', height: '100%' }
  return slotStyle(!isSwapped.value)
})

/** A hidden preview collapses to zero size but stays mounted, so neither pane loses state. */
const previewPanelStyle = computed(() => {
  if (!uiStore.previewVisible) {
    if (isVertical.value) {
      const top = isSwapped.value ? '0%' : `${splitPct.value}%`
      return { left: '0%', top, width: '100%', height: '0%' }
    } else {
      const left = isSwapped.value ? '0%' : `${splitPct.value}%`
      return { left, top: '0%', width: '0%', height: '100%' }
    }
  }
  return slotStyle(isSwapped.value)
})

// A 12px grab area centred on the split line.
const dividerHitZoneStyle = computed(() => {
  if (!isVertical.value) {
    return { left: `calc(${splitPct.value}% - 6px)`, top: '0', width: '12px', height: '100%' }
  } else {
    return { top: `calc(${splitPct.value}% - 6px)`, left: '0', height: '12px', width: '100%' }
  }
})

const dividerLineClass = computed(() => {
  if (isDragging.value) {
    return isVertical.value
      ? 'top-1/2 -translate-y-1/2 inset-x-0 h-0.5 bg-accent'
      : 'left-1/2 -translate-x-1/2 inset-y-0 w-0.5 bg-accent'
  }
  return isVertical.value
    ? 'top-1/2 -translate-y-1/2 inset-x-0 h-px bg-border-subtle group-hover:bg-border'
    : 'left-1/2 -translate-x-1/2 inset-y-0 w-px bg-border-subtle group-hover:bg-border'
})

const showPreviewFontControls = computed(() => uiStore.previewVisible)

// Right edge of the editor panel (or of the container, in single-pane or vertical mode).
const editorFontControlsStyle = computed(() => {
  if (!uiStore.previewVisible || isVertical.value || isSwapped.value) return { right: '0' }
  return { right: `${100 - splitPct.value}%` }
})

// Right edge of the preview panel. Stacked vertically, both groups share the breadcrumb bar, so
// these sit just left of the editor's (62px = px-2 + w-5 + gap-1.5 + w-5 + px-2).
const previewFontControlsStyle = computed(() => {
  if (isVertical.value) return { right: '62px' }
  if (isSwapped.value) return { right: `${100 - splitPct.value}%` }
  return { right: '0' }
})

/** Resets to 50/50 so neither panel starts cramped. */
function toggleLayout() {
  isVertical.value = !isVertical.value
  rotationClockwise.value = !rotationClockwise.value
  splitPct.value = 50
}

function toggleSwap() {
  isSwapped.value = !isSwapped.value
}

/** Window listeners keep the drag going if the cursor outruns the divider. */
function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  document.body.style.cursor = isVertical.value ? 'row-resize' : 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  const pane = splitPane.value?.[0]
  if (!isDragging.value || !pane) return
  const rect = pane.getBoundingClientRect()
  if (isVertical.value) {
    const pct = ((e.clientY - rect.top) / rect.height) * 100
    splitPct.value = Math.min(MAX_PCT, Math.max(MIN_PCT, pct))
  } else {
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    splitPct.value = Math.min(MAX_PCT, Math.max(MIN_PCT, pct))
  }
}

function onMouseUp() {
  isDragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

// In case it unmounts mid-drag.
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <main class="flex-1 flex flex-col overflow-hidden bg-bg">
    <template v-if="hasTabs">
      <!-- Bottom-aligned in a growing box so the bar slides down from above. -->
      <div
        class="flex shrink-0 flex-col justify-end overflow-hidden"
        :class="{ 'animate-bar-expand': slideTabsIn }"
        @animationend="slideTabsIn = false"
      >
        <EditorTabs
          :is-vertical="isVertical"
          :is-swapped="isSwapped"
          :rotation-clockwise="rotationClockwise"
          :preview-visible="uiStore.previewVisible"
          @toggle-layout="toggleLayout"
          @toggle-swap="toggleSwap"
        />
      </div>

      <div class="relative shrink-0">
        <BreadcrumbBar />

        <div
          v-if="activeDocType !== 'image' && !isAnnotated"
          class="absolute inset-y-0 flex items-center gap-1.5 px-2 bg-surface border-b border-border-subtle"
          :style="editorFontControlsStyle"
        >
          <button
            class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-75 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Decrease editor font size"
            :disabled="uiStore.editorFontSize <= 12"
            @click="uiStore.setEditorFontSize(uiStore.editorFontSize - 1)"
          >
            <AArrowDown :size="18" />
          </button>
          <button
            class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-75 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Increase editor font size"
            :disabled="uiStore.editorFontSize >= 24"
            @click="uiStore.setEditorFontSize(uiStore.editorFontSize + 1)"
          >
            <AArrowUp :size="18" />
          </button>
        </div>

        <!-- Preview font size controls (left of the editor's when stacked) -->
        <div
          v-if="showPreviewFontControls && activeDocType !== 'image' && !isAnnotated"
          class="absolute inset-y-0 flex items-center gap-1.5 px-2 bg-surface border-b border-border-subtle"
          :class="isVertical ? 'border-r' : 'border-l'"
          :style="previewFontControlsStyle"
        >
          <button
            class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-75 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Decrease preview font size"
            :disabled="uiStore.previewFontSize <= 12"
            @click="uiStore.setPreviewFontSize(uiStore.previewFontSize - 1)"
          >
            <AArrowDown :size="18" />
          </button>
          <button
            class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-75 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Increase preview font size"
            :disabled="uiStore.previewFontSize >= 24"
            @click="uiStore.setPreviewFontSize(uiStore.previewFontSize + 1)"
          >
            <AArrowUp :size="18" />
          </button>
        </div>
      </div>

      <template v-for="id in store.tabOrder" :key="id">
        <div v-if="id === activeId" class="flex-1 min-h-0 overflow-hidden">
          <ImageDetailPane v-if="activeDocType === 'image'" :document-id="id" class="h-full" />

          <AnnotatedDocPane
            v-else-if="activeDocType === 'web' || activeDocType === 'pdf'"
            :document-id="id"
            :type="activeDocType"
            :is-active="id === activeId"
            :is-vertical="isVertical"
            :is-swapped="isSwapped"
            class="h-full"
          />

          <div v-else ref="splitPane" class="relative h-full bg-surface overflow-hidden">
            <div
              class="absolute overflow-hidden split-panel"
              :class="{ 'no-transition': isDragging }"
              :style="editorPanelStyle"
            >
              <TextEditor :document-id="id" :is-active="id === activeId" class="h-full" />
            </div>

            <div
              class="absolute overflow-hidden split-panel"
              :class="{ 'no-transition': isDragging }"
              :style="previewPanelStyle"
            >
              <MarkdownPreview :document-id="id" />
            </div>

            <div
              v-if="uiStore.previewVisible"
              class="absolute z-10 group"
              :class="isVertical ? 'cursor-row-resize' : 'cursor-col-resize'"
              :style="dividerHitZoneStyle"
              @mousedown="onDividerMouseDown"
              @dblclick="splitPct = 50"
            >
              <div :class="['absolute transition-all duration-150', dividerLineClass]" />
            </div>
          </div>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="flex-1 flex items-center justify-center">
        <div class="flex flex-col items-center gap-3 text-center">
          <LilypadIcon class="w-16 h-16 opacity-[0.08]" />
          <h2 class="font-display text-2xl font-normal text-text-secondary">
            Open a note to begin
          </h2>
          <p class="text-sm text-text-muted">Select a file from the sidebar</p>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
.split-panel {
  transition:
    left 250ms cubic-bezier(0.4, 0, 0.2, 1),
    top 250ms cubic-bezier(0.4, 0, 0.2, 1),
    width 250ms cubic-bezier(0.4, 0, 0.2, 1),
    height 250ms cubic-bezier(0.4, 0, 0.2, 1);
}

.split-panel.no-transition {
  transition: none;
}
</style>
