<script setup lang="ts">
import { ref, computed, useTemplateRef, onBeforeUnmount } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import TextEditor from './TextEditor.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import EditorTabs from './EditorTabs.vue'
import LilypadIcon from '@/assets/icon.svg'

const store = useEditorStore()
const uiStore = useUiStore()
const hasTabs = computed(() => store.tabOrder.length > 0)
const activeId = computed(() => store.activeDocumentId)

const splitPane = useTemplateRef<HTMLDivElement[]>('splitPane')
const splitPct = ref(50)
const MIN_PCT = 20
const MAX_PCT = 80

const isVertical = ref(false)
const isSwapped = ref(false)
const rotationClockwise = ref(true)
const isDragging = ref(false)

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

function toggleLayout() {
  isVertical.value = !isVertical.value
  rotationClockwise.value = !rotationClockwise.value
  splitPct.value = 50
}

function toggleSwap() {
  isSwapped.value = !isSwapped.value
}

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

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <main class="flex-1 flex flex-col overflow-hidden bg-bg">
    <template v-if="hasTabs">
      <EditorTabs
        :is-vertical="isVertical"
        :is-swapped="isSwapped"
        :rotation-clockwise="rotationClockwise"
        :preview-visible="uiStore.previewVisible"
        @toggle-layout="toggleLayout"
        @toggle-swap="toggleSwap"
      />

      <template v-for="id in store.tabOrder" :key="id">
        <div v-show="id === activeId" class="flex-1 min-h-0 overflow-hidden">
          <div
            v-if="id === activeId"
            ref="splitPane"
            class="relative h-full bg-surface overflow-hidden"
          >
            <!-- Loading skeleton -->
            <div
              v-if="store.loadingIds.has(id)"
              class="absolute inset-0 bg-bg flex flex-col gap-3 p-10 animate-pulse"
            >
              <div class="h-5 bg-surface-elevated rounded w-2/5" />
              <div class="h-3 bg-surface-elevated rounded w-full mt-2" />
              <div class="h-3 bg-surface-elevated rounded w-11/12" />
              <div class="h-3 bg-surface-elevated rounded w-4/5" />
              <div class="h-3 bg-surface-elevated rounded w-full" />
              <div class="h-3 bg-surface-elevated rounded w-3/4 mt-4" />
              <div class="h-3 bg-surface-elevated rounded w-full" />
              <div class="h-3 bg-surface-elevated rounded w-5/6" />
            </div>

            <template v-else>
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
            </template>
          </div>
        </div>
      </template>
    </template>

    <!-- Empty state -->
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
