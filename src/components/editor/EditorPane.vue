<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { useEditorStore } from '@/stores/editor'
import TextEditor from './TextEditor.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import EditorTabs from './EditorTabs.vue'
import LilypadIcon from '@/assets/icon-light.svg'

const store = useEditorStore()
const hasTabs = computed(() => store.tabOrder.length > 0)
const activeId = computed(() => store.activeDocumentId)
const isMarkdown = computed(() => store.activeDocument?.type === 'md')

// Split pane state — percentage given to the editor side
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
  if (!dragging) return
  const pane = document.getElementById('editor-split-pane')
  if (!pane) return
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
          <!-- Markdown: split editor + preview -->
          <div
            v-if="isMarkdown && id === activeId"
            id="editor-split-pane"
            class="flex flex-row h-full"
          >
            <!-- Editor side -->
            <div :style="{ width: splitPct + '%' }" class="h-full overflow-hidden">
              <TextEditor :document-id="id" :is-active="id === activeId" class="h-full" />
            </div>

            <!-- Resize divider -->
            <div
              class="w-px shrink-0 bg-border-subtle hover:bg-accent cursor-col-resize transition-colors duration-100"
              @mousedown="onDividerMouseDown"
            />

            <!-- Preview side -->
            <div class="flex-1 h-full overflow-hidden border-l border-border-subtle">
              <MarkdownPreview :document-id="id" />
            </div>
          </div>

          <!-- Non-markdown: full-width editor -->
          <TextEditor v-else :document-id="id" :is-active="id === activeId" class="h-full w-full" />
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
