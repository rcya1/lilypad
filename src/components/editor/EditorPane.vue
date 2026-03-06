<script setup lang="ts">
import { ref, computed, useTemplateRef, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '@/stores/editor'
import TextEditor from './TextEditor.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import EditorTabs from './EditorTabs.vue'
import LilypadIcon from '@/assets/icon-light.svg'

const store = useEditorStore()
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

function toggleLayout() {
  isVertical.value = !isVertical.value
  rotationClockwise.value = !rotationClockwise.value
  splitPct.value = 50
}

function toggleSwap() {
  isSwapped.value = !isSwapped.value
}

const dividerLineClass = computed(() => {
  if (isDragging.value) {
    return isVertical.value ? 'h-0.5 bg-accent' : 'w-0.5 bg-accent'
  }
  return isVertical.value
    ? 'h-px bg-border-subtle group-hover:bg-border'
    : 'w-px bg-border-subtle group-hover:bg-border'
})

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

function onKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    e.preventDefault()
    if (activeId.value) {
      store.closeDocument(activeId.value)
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <main class="flex-1 flex flex-col overflow-hidden bg-bg">
    <template v-if="hasTabs">
      <EditorTabs
        :is-vertical="isVertical"
        :is-swapped="isSwapped"
        :rotation-clockwise="rotationClockwise"
        @toggle-layout="toggleLayout"
        @toggle-swap="toggleSwap"
      />

      <!-- For each open tab, render stacked (only active is shown) -->
      <template v-for="id in store.tabOrder" :key="id">
        <div v-show="id === activeId" class="flex-1 min-h-0 overflow-hidden">
          <div
            v-if="id === activeId"
            ref="splitPane"
            :class="['flex h-full bg-surface', isVertical ? 'flex-col' : 'flex-row']"
          >
            <!-- First panel -->
            <div
              :style="isVertical ? { height: splitPct + '%' } : { width: splitPct + '%' }"
              class="overflow-hidden shrink-0"
            >
              <TextEditor
                v-if="!isSwapped"
                :document-id="id"
                :is-active="id === activeId"
                class="h-full"
              />
              <MarkdownPreview v-else :document-id="id" />
            </div>

            <!-- Resize divider — hit zone sits in the second panel so it never covers the first panel's scrollbar -->
            <div :class="['relative shrink-0 z-10', isVertical ? 'w-full h-0' : 'h-full w-0']">
              <div
                :class="[
                  'absolute group',
                  isVertical
                    ? 'inset-x-0 top-0 h-3 cursor-row-resize'
                    : 'inset-y-0 left-0 w-3 cursor-col-resize',
                ]"
                @mousedown="onDividerMouseDown"
                @dblclick="splitPct = 50"
              >
                <!-- Line sits at the edge that faces the first panel -->
                <div
                  :class="[
                    'absolute transition-all duration-150',
                    isVertical ? 'top-0 inset-x-0' : 'left-0 inset-y-0',
                    dividerLineClass,
                  ]"
                />
              </div>
            </div>

            <!-- Second panel -->
            <div class="flex-1 overflow-hidden">
              <MarkdownPreview v-if="!isSwapped" :document-id="id" />
              <TextEditor v-else :document-id="id" :is-active="id === activeId" class="h-full" />
            </div>
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
