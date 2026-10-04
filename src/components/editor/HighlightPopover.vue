<!-- A highlight's popover in a web page or PDF: colour, inline note (view/edit), insert a reference
     into the notes, delete. The parent positions it (x = centre, y = top) and closes it. -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Pencil, Trash2, Link2, Check } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useAnnotationsStore, HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_KEYS } from '@/stores/annotations'
import type { HighlightColor } from '@/types/database'
import { parseMarkdown } from '@/lib/markdown'

const props = defineProps<{
  highlightId: string
  x: number
  y: number
  /** Opens in edit mode (it always does when there's no note yet). */
  startEditing?: boolean
}>()
const emit = defineEmits<{ close: []; 'insert-reference': [] }>()

const anno = useAnnotationsStore()
const editorStore = useEditorStore()

const highlight = computed(() => anno.getById(props.highlightId) ?? null)
const noteHtml = computed(() => (highlight.value?.note ? parseMarkdown(highlight.value.note) : ''))

const editing = ref(false)
const noteDraft = ref('')

watch(
  () => props.highlightId,
  () => {
    noteDraft.value = highlight.value?.note ?? ''
    editing.value = !!props.startEditing || !highlight.value?.note
  },
  { immediate: true },
)

const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
const saveHint = isMac ? '⌘↵ to save' : 'Ctrl+↵ to save'

function startEdit() {
  noteDraft.value = highlight.value?.note ?? ''
  editing.value = true
}

async function save() {
  await anno.updateNote(props.highlightId, noteDraft.value.trim())
  editing.value = false
}

function cancelEdit() {
  noteDraft.value = highlight.value?.note ?? ''
  editing.value = false
}

function setColor(color: HighlightColor) {
  void anno.updateColor(props.highlightId, color)
}

async function remove() {
  await anno.deleteHighlight(props.highlightId)
  emit('close')
}

/** Inserts `[quote](lily:hl-x)` at the notes cursor; the notes pane switches to code mode. */
function insertReference() {
  const h = highlight.value
  if (!h) return
  const quote = h.selectors.quote.exact.replace(/\s+/g, ' ').trim()
  const label = quote.length > 40 ? quote.slice(0, 40).trim() + '…' : quote
  editorStore.requestInsertText(h.entryId, `[${label}](lily:${h.localId})`)
  emit('insert-reference')
}
</script>

<template>
  <div
    class="overlay-pop absolute z-30 w-72 max-w-[90%] rounded-lg bg-surface border border-border shadow-xl -translate-x-1/2"
    :style="{ left: x + 'px', top: y + 'px' }"
  >
    <div class="flex items-center justify-between px-2.5 py-1.5 border-b border-border-subtle">
      <div class="flex items-center gap-1">
        <button
          v-for="key in HIGHLIGHT_COLOR_KEYS"
          :key="key"
          class="w-4 h-4 rounded-full border cursor-pointer transition-transform hover:scale-110"
          :class="highlight?.color === key ? 'border-text-primary' : 'border-black/10'"
          :style="{ backgroundColor: HIGHLIGHT_COLORS[key].swatch }"
          :title="`Set colour ${key}`"
          @click="setColor(key)"
        />
      </div>
      <div class="flex items-center gap-0.5">
        <button
          v-if="!editing"
          class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated cursor-pointer"
          title="Edit note"
          @click="startEdit"
        >
          <Pencil :size="13" />
        </button>
        <button
          class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated cursor-pointer"
          title="Insert reference into notes"
          @click="insertReference"
        >
          <Link2 :size="13" />
        </button>
        <button
          class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-red-500 hover:bg-surface-elevated cursor-pointer"
          title="Delete highlight"
          @click="remove"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <div class="p-2.5">
      <template v-if="editing">
        <textarea
          v-model="noteDraft"
          rows="3"
          placeholder="Write a note (markdown supported)…"
          class="w-full resize-y rounded border border-border-subtle bg-bg px-2 py-1.5 text-sm font-preview text-text-primary outline-none focus:border-accent"
          @keydown.enter.meta.prevent="save"
          @keydown.enter.ctrl.prevent="save"
          @keydown.esc.stop.prevent="cancelEdit"
          v-focus
        />
        <div class="flex items-center justify-between mt-1.5">
          <span class="text-[11px] text-text-muted font-ui">{{ saveHint }}</span>
          <button
            class="flex items-center gap-1 h-6 px-2 rounded bg-accent text-white text-xs font-ui cursor-pointer hover:bg-accent-hover"
            @click="save"
          >
            <Check :size="13" />
            Save
          </button>
        </div>
      </template>
      <template v-else>
        <div
          v-if="noteHtml"
          class="hl-note-body text-sm font-preview text-text-primary leading-snug"
          v-html="noteHtml"
        />
        <p v-else class="text-sm text-text-muted italic">No note yet.</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Fade only: positioned with translate utilities, which a transform animation would fight. */
.overlay-pop {
  animation: overlay-in 120ms ease-out;
}
@keyframes overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.hl-note-body :deep(p) {
  margin: 0.25em 0;
}
.hl-note-body :deep(p:first-child) {
  margin-top: 0;
}
.hl-note-body :deep(p:last-child) {
  margin-bottom: 0;
}
.hl-note-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}
.hl-note-body :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  background: var(--surface-elevated);
  border-radius: 3px;
  padding: 0.05em 0.3em;
}
</style>
