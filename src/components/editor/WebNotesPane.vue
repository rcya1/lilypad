<!-- Right pane of a web document: the user's markdown notes for the captured page.
     Per the design doc this is a single pane with one toggle between a rendered view and the
     raw source editor — deliberately NOT the side-by-side editor+preview split used for .md
     files, since the captured page already occupies the "other half" of the split. -->
<script setup lang="ts">
import { computed } from 'vue'
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

const store = useEditorStore()
const isDirty = computed(() => store.dirtyIds.has(props.documentId))
const isSaving = computed(() => store.savingIds.has(props.documentId))

// The editor only counts as "active" (drives focus + CodeMirror re-measure) when this tab is
// active AND we're showing the source view — otherwise a hidden editor would steal focus.
const editorActive = computed(() => props.isActive && props.mode === 'code')
</script>

<template>
  <div class="h-full w-full flex flex-col overflow-hidden bg-surface">
    <!-- Toggle header -->
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

      <div class="flex items-center gap-0.5 rounded-md bg-surface-elevated p-0.5">
        <button
          class="flex items-center gap-1 h-6 px-2 rounded text-xs font-ui transition-colors duration-75 cursor-pointer"
          :class="
            mode === 'rendered'
              ? 'bg-bg text-text-primary shadow-sm'
              : 'text-text-muted hover:text-text-primary'
          "
          title="Rendered notes"
          @click="setMode('rendered')"
        >
          <Eye :size="13" />
          Rendered
        </button>
        <button
          class="flex items-center gap-1 h-6 px-2 rounded text-xs font-ui transition-colors duration-75 cursor-pointer"
          :class="
            mode === 'code'
              ? 'bg-bg text-text-primary shadow-sm'
              : 'text-text-muted hover:text-text-primary'
          "
          title="Edit source"
          @click="setMode('code')"
        >
          <Code :size="13" />
          Code
        </button>
      </div>
    </div>

    <!-- Body. The editor stays mounted (v-show) so its CodeMirror state — cursor, undo history,
         scroll — survives toggling to the rendered view and back. The preview is mounted on
         demand (v-if) so it isn't re-parsing markdown on every keystroke while hidden. -->
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
