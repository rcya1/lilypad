<!-- Inline text input row shown in the file tree when creating a new file or folder; supports v-model, drag reorder, and keyboard confirm/cancel. -->
<script setup lang="ts">
import { FileText, Folder, Check, GripVertical } from 'lucide-vue-next'

defineProps<{
  modelValue: string
  /** Determines the icon shown and the placeholder text. */
  type: 'file' | 'folder'
  /** Nesting depth, used to compute left padding matching the tree indentation. */
  depth: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  cancel: []
  dragstart: [e: DragEvent]
  dragend: []
}>()
</script>

<template>
  <div
    data-pending-input
    class="flex items-center gap-1.5 py-1 px-2 rounded-sm bg-surface-elevated"
    :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
    draggable="true"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
  >
    <span
      class="w-3 flex items-center justify-center text-text-muted shrink-0 cursor-grab active:cursor-grabbing"
    >
      <GripVertical :size="13" />
    </span>
    <span class="flex items-center shrink-0">
      <FileText v-if="type === 'file'" :size="16" class="text-text-secondary" />
      <Folder v-else :size="16" class="text-amber" />
    </span>
    <input
      :value="modelValue"
      class="flex-1 min-w-0 bg-transparent outline-none text-sm text-text-primary font-ui"
      :placeholder="type === 'file' ? 'filename.md' : 'folder name'"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('submit')"
      @keydown.escape="emit('cancel')"
      @vue:mounted="($event as any).el.focus()"
    />
    <!-- @mousedown.prevent stops the input from losing focus before @click fires, so the
         confirm button reliably commits the name instead of triggering the blur-cancel. -->
    <button
      class="flex items-center justify-center w-4 h-4 rounded text-accent hover:bg-surface-overlay transition-colors cursor-pointer shrink-0"
      @mousedown.prevent
      @click="emit('submit')"
    >
      <Check :size="13" />
    </button>
  </div>
</template>
