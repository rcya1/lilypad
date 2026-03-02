<script setup lang="ts">
import { ref, computed, useTemplateRef, onBeforeUnmount } from 'vue'
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

let dragging = false

function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  dragging = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  const pane = splitPane.value?.[0]
  if (!dragging || !pane) return
  const rect = pane.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  splitPct.value = Math.min(MAX_PCT, Math.max(MIN_PCT, pct))
}

function onMouseUp() {
  dragging = false
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
      <EditorTabs />

      <!-- For each open tab, render stacked (only active is shown) -->
      <template v-for="id in store.tabOrder" :key="id">
        <div v-show="id === activeId" class="flex-1 overflow-hidden">
          <div v-if="id === activeId" ref="splitPane" class="flex flex-row h-full">
            <!-- Editor side -->
            <div :style="{ width: splitPct + '%' }" class="h-full overflow-hidden">
              <TextEditor :document-id="id" :is-active="id === activeId" class="h-full" />
            </div>

            <!-- Resize divider -->
            <div
              class="relative w-2 shrink-0 cursor-col-resize group"
              @mousedown="onDividerMouseDown"
            >
              <div
                class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border-subtle group-hover:bg-accent transition-colors duration-100"
              />
            </div>

            <!-- Preview side -->
            <div class="flex-1 h-full overflow-hidden">
              <MarkdownPreview :document-id="id" />
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
