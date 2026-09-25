<!-- A web document's notes: one pane that toggles between rendered and source (not the md split,
     since the captured page already takes the other half). -->
<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { Eye, Code } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import TextEditor from './TextEditor.vue'
import MarkdownPreview from './MarkdownPreview.vue'

type Mode = 'code' | 'rendered'

const props = defineProps<{ documentId: string; isActive: boolean; mode: Mode }>()
const emit = defineEmits<{ 'update:mode': [Mode] }>()

function setMode(m: Mode) {
  emit('update:mode', m)
}

// The toggle buttons are content-sized, so the sliding pill measures the active one.
const codeBtn = ref<HTMLButtonElement | null>(null)
const renderedBtn = ref<HTMLButtonElement | null>(null)
const pillStyle = ref({ left: '0px', width: '0px' })

function updatePill() {
  const btn = props.mode === 'code' ? codeBtn.value : renderedBtn.value
  if (!btn) return
  pillStyle.value = { left: `${btn.offsetLeft}px`, width: `${btn.offsetWidth}px` }
}

watch(
  () => props.mode,
  () => nextTick(updatePill),
)
onMounted(() => {
  nextTick(updatePill)
  // Label widths shift once Inter loads, so re-measure when fonts settle.
  document.fonts?.ready.then(() => nextTick(updatePill))
})

const store = useEditorStore()
const isDirty = computed(() => store.dirtyIds.has(props.documentId))
const isSaving = computed(() => store.savingIds.has(props.documentId))

// Only "active" (focus, CodeMirror re-measure) when this tab is active and showing the source, or a
// hidden editor would steal focus.
const editorActive = computed(() => props.isActive && props.mode === 'code')
</script>

<template>
  <div class="h-full w-full flex flex-col overflow-hidden bg-surface">
    <div
      class="flex items-center justify-between h-9 shrink-0 pl-3 pr-2 border-b border-border-subtle bg-surface"
    >
      <div class="flex items-center gap-2">
        <span class="text-xs font-ui font-medium text-text-secondary">Notes</span>
        <span v-if="isSaving" class="text-[11px] font-ui text-text-muted" title="Saving changes">
          Saving…
        </span>
        <span
          v-else-if="isDirty"
          class="w-1.5 h-1.5 rounded-full bg-text-muted"
          title="Unsaved changes"
        />
      </div>

      <div
        class="relative inline-flex items-center rounded-md bg-surface-elevated p-0.5 text-xs font-ui"
      >
        <div
          class="absolute top-0.5 bottom-0.5 rounded bg-bg shadow-sm transition-all duration-200 ease-out"
          :style="pillStyle"
        />
        <button
          ref="codeBtn"
          class="relative z-10 flex h-6 items-center gap-1 rounded px-2.5 transition-colors duration-100 cursor-pointer"
          :class="mode === 'code' ? 'text-text-primary' : 'text-text-muted hover:text-text-primary'"
          title="Edit source (Ctrl+E)"
          @click="setMode('code')"
        >
          <Code :size="13" />
          Code
        </button>
        <button
          ref="renderedBtn"
          class="relative z-10 flex h-6 items-center gap-1 rounded px-2.5 transition-colors duration-100 cursor-pointer"
          :class="
            mode === 'rendered' ? 'text-text-primary' : 'text-text-muted hover:text-text-primary'
          "
          title="Rendered notes (Ctrl+E)"
          @click="setMode('rendered')"
        >
          <Eye :size="13" />
          Rendered
        </button>
      </div>
    </div>

    <!-- The editor stays mounted (v-show) so cursor, undo history and scroll survive toggling; the
         preview mounts on demand so it isn't re-parsing on every keystroke while hidden. -->
    <div class="flex-1 min-h-0 relative">
      <div v-show="mode === 'code'" class="absolute inset-0">
        <TextEditor :document-id="documentId" :is-active="editorActive" class="h-full" />
      </div>
      <div v-if="mode === 'rendered'" class="absolute inset-0">
        <MarkdownPreview :document-id="documentId" />
      </div>
    </div>
  </div>
</template>
